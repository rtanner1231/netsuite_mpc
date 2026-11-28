import fs from "fs/promises";
import path from "path";
import util from "util";
import { exec } from "child_process";
import { create } from "xmlbuilder2";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { ToolDefinition } from "../types/index.js";
import { getProjectRoot } from "../utils/mcp.js";
import { getProjectConfig, getSdfSrcDir } from "../utils/project.js";
import { withTempSdfProject } from "../utils/tempSdfProject.js";
import { downloadSdfObjectInTempProject, findExistingObjectFile } from "../utils/objects.js";
import {
    CUSTOM_FIELD_CATEGORIES,
    CUSTOM_FIELD_CATEGORY_SPECS,
    CustomFieldCategory
} from "../utils/customFields.js";
import { standardRecordSdfIds } from "../utils/customRecords.js";

const execAsync = util.promisify(exec);

export type ViewCustomObjectTypeFilter =
    | "auto"
    | "all"
    | "custom_record_type"
    | "custom_list"
    | "custom_field"
    | CustomFieldCategory;

export interface ViewCustomObjectArgs {
    scriptId?: string;
    objectType?: ViewCustomObjectTypeFilter;
    searchTerm?: string;
    limit?: number;
    includeRawXml?: boolean;
}

const fileExists = async (targetPath: string): Promise<boolean> => {
    try {
        await fs.access(targetPath);
        return true;
    } catch {
        return false;
    }
};

const extractNodeText = (node: any): string | undefined => {
    if (node === undefined || node === null) return undefined;
    if (typeof node === "string" || typeof node === "number" || typeof node === "boolean") {
        return String(node);
    }
    if (typeof node === "object") {
        if (node["#"] !== undefined && node["#"] !== null) {
            return String(node["#"]);
        }
        return "";
    }
    return undefined;
};

const parseSdfBool = (node: any): boolean | undefined => {
    const text = extractNodeText(node);
    if (text === undefined) return undefined;
    const upper = text.trim().toUpperCase();
    if (upper === "T" || upper === "TRUE") return true;
    if (upper === "F" || upper === "FALSE") return false;
    return undefined;
};

const parseSdfInt = (node: any): number | undefined => {
    const text = extractNodeText(node);
    if (text === undefined || !text.trim()) return undefined;
    const num = Number(text.trim());
    return Number.isFinite(num) ? Math.trunc(num) : undefined;
};

// Build reverse map from negative NetSuite internal record type ID (e.g. "-2") -> canonical name (e.g. "customer")
const STANDARD_RECORD_NAME_BY_SDF_ID: Record<string, string> = (() => {
    const map: Record<string, string> = {};
    for (const [name, numId] of Object.entries(standardRecordSdfIds)) {
        const key = String(numId);
        // Prefer the first canonical lowercase entry registered in standardRecordSdfIds
        if (!map[key] && name === name.toLowerCase()) {
            map[key] = name;
        }
    }
    return map;
})();

const formatSelectRecordTypeForOutput = (rawNode: any): {
    selectRecordType?: string;
    rawSelectRecordType?: string;
} => {
    const text = extractNodeText(rawNode)?.trim();
    if (!text) return {};

    const bracketMatch = text.match(/^\[scriptid=([^\]]+)\]$/i);
    if (bracketMatch && bracketMatch[1]) {
        return {
            selectRecordType: bracketMatch[1].trim().toLowerCase(),
            rawSelectRecordType: text
        };
    }

    if (STANDARD_RECORD_NAME_BY_SDF_ID[text]) {
        return {
            selectRecordType: STANDARD_RECORD_NAME_BY_SDF_ID[text],
            rawSelectRecordType: text
        };
    }

    return {
        selectRecordType: text
    };
};

const formatSubtabForOutput = (rawNode: any): string | undefined => {
    const text = extractNodeText(rawNode)?.trim();
    if (!text) return undefined;
    const bracketMatch = text.match(/^\[scriptid=([^\]]+)\]$/i);
    if (bracketMatch && bracketMatch[1]) {
        return bracketMatch[1].trim().toLowerCase();
    }
    return text;
};

/**
 * Parses a `<customrecordcustomfield>` node from `<customrecordtype>` into the exact field structure
 * accepted by `netsuite_upsert_custom_record_type`.
 */
const parseCustomRecordFieldNode = (fieldNode: Record<string, any>): Record<string, any> => {
    const scriptId = String(fieldNode["@scriptid"] || "").trim().toLowerCase();
    const label = extractNodeText(fieldNode.label);
    const type = extractNodeText(fieldNode.fieldtype);
    const description = extractNodeText(fieldNode.description);
    const helpText = extractNodeText(fieldNode.help);
    const { selectRecordType, rawSelectRecordType } = formatSelectRecordTypeForOutput(
        fieldNode.selectrecordtype
    );
    const isMandatory = parseSdfBool(fieldNode.ismandatory);
    const storeValue = parseSdfBool(fieldNode.storevalue);
    const showInList = parseSdfBool(fieldNode.showinlist);
    const globalSearch = parseSdfBool(fieldNode.globalsearch);
    const displayType = extractNodeText(fieldNode.displaytype);
    const defaultValue = extractNodeText(fieldNode.defaultvalue);
    const defaultChecked = parseSdfBool(fieldNode.defaultchecked);
    const dynamicDefault = extractNodeText(fieldNode.dynamicdefault);
    const isFormula = parseSdfBool(fieldNode.isformula);
    const isParent = parseSdfBool(fieldNode.isparent);
    const parentSubtab = formatSubtabForOutput(fieldNode.parentsubtab);
    const onParentDelete = extractNodeText(fieldNode.onparentdelete);
    const subtab = formatSubtabForOutput(fieldNode.subtab);

    return {
        scriptId,
        ...(label !== undefined ? { label } : {}),
        ...(type !== undefined ? { type } : {}),
        ...(selectRecordType !== undefined && selectRecordType !== "" ? { selectRecordType } : {}),
        ...(rawSelectRecordType && rawSelectRecordType !== selectRecordType
            ? { rawSelectRecordType }
            : {}),
        ...(description !== undefined ? { description } : {}),
        ...(helpText !== undefined ? { helpText } : {}),
        ...(isMandatory !== undefined ? { isMandatory } : {}),
        ...(storeValue !== undefined ? { storeValue } : {}),
        ...(showInList !== undefined ? { showInList } : {}),
        ...(globalSearch !== undefined ? { globalSearch } : {}),
        ...(displayType !== undefined && displayType !== "" ? { displayType } : {}),
        ...(defaultValue !== undefined && defaultValue !== "" ? { defaultValue } : {}),
        ...(defaultChecked !== undefined ? { defaultChecked } : {}),
        ...(dynamicDefault !== undefined && dynamicDefault !== "" ? { dynamicDefault } : {}),
        ...(isFormula !== undefined ? { isFormula } : {}),
        ...(isParent !== undefined ? { isParent } : {}),
        ...(parentSubtab !== undefined && parentSubtab !== "" ? { parentSubtab } : {}),
        ...(onParentDelete !== undefined && onParentDelete !== "" ? { onParentDelete } : {}),
        ...(subtab !== undefined && subtab !== "" ? { subtab } : {})
    };
};

/**
 * Parses a `<customrecordtype>` XML object into the structure accepted by `netsuite_upsert_custom_record_type`.
 */
const parseCustomRecordTypeObject = (
    rootObj: Record<string, any>,
    fallbackScriptId: string
): Record<string, any> => {
    const scriptId = String(rootObj["@scriptid"] || fallbackScriptId).trim().toLowerCase();
    const name = extractNodeText(rootObj.recordname);
    const description = extractNodeText(rootObj.description);
    const aiDescription = extractNodeText(rootObj.aidescription);
    const includeNameField = parseSdfBool(rootObj.includename);
    const accessType = extractNodeText(rootObj.accesstype);
    const isHierarchy = parseSdfBool(rootObj.hierarchical);
    const allowInlineEditing = parseSdfBool(rootObj.allowinlineEditing ?? rootObj.allowinlineediting);
    const enableNumbering = parseSdfBool(rootObj.enablenumbering);
    const numberingPrefix = extractNodeText(rootObj.numberingprefix);
    const numberingMinDigits = parseSdfInt(rootObj.numberingmindigits);
    const showId = parseSdfBool(rootObj.showid);
    const showOwner = parseSdfBool(rootObj.showowner);
    const isOrdered = parseSdfBool(rootObj.isordered);
    const isInactive = parseSdfBool(rootObj.isinactive);

    const rawFields = rootObj.customrecordcustomfields?.customrecordcustomfield;
    const fieldNodes: Record<string, any>[] = rawFields
        ? Array.isArray(rawFields)
            ? rawFields
            : [rawFields]
        : [];
    const fields = fieldNodes
        .filter((f) => f && typeof f === "object")
        .map((f) => parseCustomRecordFieldNode(f));

    return {
        objectType: "custom_record_type",
        rootElement: "customrecordtype",
        scriptId,
        ...(name !== undefined ? { name } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(aiDescription !== undefined ? { aiDescription } : {}),
        ...(includeNameField !== undefined ? { includeNameField } : {}),
        ...(accessType !== undefined && accessType !== "" ? { accessType } : {}),
        ...(isHierarchy !== undefined ? { isHierarchy } : {}),
        ...(allowInlineEditing !== undefined ? { allowInlineEditing } : {}),
        ...(enableNumbering !== undefined ? { enableNumbering } : {}),
        ...(numberingPrefix !== undefined && numberingPrefix !== "" ? { numberingPrefix } : {}),
        ...(numberingMinDigits !== undefined ? { numberingMinDigits } : {}),
        ...(showId !== undefined ? { showId } : {}),
        ...(showOwner !== undefined ? { showOwner } : {}),
        ...(isOrdered !== undefined ? { isOrdered } : {}),
        ...(isInactive !== undefined ? { isInactive } : {}),
        fieldsCount: fields.length,
        fields
    };
};

/**
 * Parses a `<customlist>` XML object into the structure accepted by `netsuite_upsert_custom_list`.
 */
const parseCustomListObject = (
    rootObj: Record<string, any>,
    fallbackScriptId: string
): Record<string, any> => {
    const scriptId = String(rootObj["@scriptid"] || fallbackScriptId).trim().toLowerCase();
    const name = extractNodeText(rootObj.name);
    const description = extractNodeText(rootObj.description);
    const isOrdered = parseSdfBool(rootObj.isordered);
    const isMatrixOption = parseSdfBool(rootObj.ismatrixoption);
    const isInactive = parseSdfBool(rootObj.isinactive);

    const rawValues = rootObj.customvalues?.customvalue;
    const valueNodes: Record<string, any>[] = rawValues
        ? Array.isArray(rawValues)
            ? rawValues
            : [rawValues]
        : [];

    const values = valueNodes
        .filter((v) => v && typeof v === "object")
        .map((v) => {
            const valScriptId = String(v["@scriptid"] || "").trim();
            const valLabel = extractNodeText(v.value) ?? "";
            const valInactive = parseSdfBool(v.isinactive);
            const abbreviation = extractNodeText(v.abbreviation);
            return {
                scriptId: valScriptId,
                value: valLabel,
                ...(valInactive !== undefined ? { isInactive: valInactive } : {}),
                ...(abbreviation !== undefined && abbreviation !== "" ? { abbreviation } : {})
            };
        });

    return {
        objectType: "custom_list",
        rootElement: "customlist",
        scriptId,
        ...(name !== undefined ? { name } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(isOrdered !== undefined ? { isOrdered } : {}),
        ...(isMatrixOption !== undefined ? { isMatrixOption } : {}),
        ...(isInactive !== undefined ? { isInactive } : {}),
        valuesCount: values.length,
        values
    };
};

const FIELD_CATEGORY_BY_ROOT_ELEMENT: Record<string, CustomFieldCategory> = (() => {
    const map: Record<string, CustomFieldCategory> = {};
    for (const [cat, spec] of Object.entries(CUSTOM_FIELD_CATEGORY_SPECS)) {
        map[spec.rootElement] = cat as CustomFieldCategory;
    }
    return map;
})();

/**
 * Parses a standalone `<*customfield>` XML object into the structure accepted by `netsuite_upsert_custom_field`.
 */
const parseStandaloneCustomFieldObject = (
    rootElement: string,
    rootObj: Record<string, any>,
    fallbackScriptId: string
): Record<string, any> => {
    const fieldCategory = FIELD_CATEGORY_BY_ROOT_ELEMENT[rootElement];
    const spec = fieldCategory ? CUSTOM_FIELD_CATEGORY_SPECS[fieldCategory] : undefined;
    const scriptId = String(rootObj["@scriptid"] || fallbackScriptId).trim().toLowerCase();
    const label = extractNodeText(rootObj.label);
    const type = extractNodeText(rootObj.fieldtype);
    const description = extractNodeText(rootObj.description);
    const helpText = extractNodeText(rootObj.help);
    const { selectRecordType, rawSelectRecordType } = formatSelectRecordTypeForOutput(
        rootObj.selectrecordtype
    );
    const { selectRecordType: recordType, rawSelectRecordType: rawRecordType } =
        formatSelectRecordTypeForOutput(rootObj.rectype);

    const isMandatory = parseSdfBool(rootObj.ismandatory);
    const storeValue = parseSdfBool(rootObj.storevalue);
    const showInList = parseSdfBool(rootObj.showinlist);
    const globalSearch = parseSdfBool(rootObj.globalsearch);
    const displayType = extractNodeText(rootObj.displaytype);
    const defaultValue = extractNodeText(rootObj.defaultvalue);
    const defaultChecked = parseSdfBool(rootObj.defaultchecked);
    const dynamicDefault = extractNodeText(rootObj.dynamicdefault);
    const isFormula = parseSdfBool(rootObj.isformula);
    const subtab = formatSubtabForOutput(rootObj.subtab);
    const isParent = parseSdfBool(rootObj.isparent);
    const parentSubtab = formatSubtabForOutput(rootObj.parentsubtab);
    const itemSubType = extractNodeText(rootObj.itemsubtype);
    const itemsRaw = extractNodeText(rootObj.items);
    const items = itemsRaw
        ? itemsRaw
              .split("|")
              .map((s) => s.trim())
              .filter(Boolean)
        : undefined;

    // Extract active appliesTo targets (where SDF tag === 'T')
    const appliesTo: string[] = [];
    const activeAppliesToSdfTags: string[] = [];
    if (spec && spec.appliesToMap) {
        // Build reverse map from sdfTag -> canonical friendly name
        const canonicalBySdfTag = new Map<string, string>();
        for (const canonical of spec.canonicalAppliesToNames) {
            const lower = canonical.toLowerCase();
            const sdfTag = spec.appliesToMap[lower];
            if (sdfTag && !canonicalBySdfTag.has(sdfTag)) {
                canonicalBySdfTag.set(sdfTag, canonical);
            }
        }

        const uniqueSdfTags = new Set(Object.values(spec.appliesToMap));
        for (const sdfTag of uniqueSdfTags) {
            if (parseSdfBool(rootObj[sdfTag]) === true) {
                activeAppliesToSdfTags.push(sdfTag);
                appliesTo.push(canonicalBySdfTag.get(sdfTag) || sdfTag);
            }
        }
    }

    return {
        objectType: "custom_field",
        fieldCategory: fieldCategory ?? rootElement,
        rootElement,
        scriptId,
        ...(label !== undefined ? { label } : {}),
        ...(type !== undefined ? { type } : {}),
        ...(selectRecordType !== undefined && selectRecordType !== "" ? { selectRecordType } : {}),
        ...(rawSelectRecordType && rawSelectRecordType !== selectRecordType
            ? { rawSelectRecordType }
            : {}),
        ...(appliesTo.length > 0 ? { appliesTo, activeAppliesToSdfTags } : {}),
        ...(recordType !== undefined && recordType !== "" ? { recordType } : {}),
        ...(rawRecordType && rawRecordType !== recordType ? { rawRecordType } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(helpText !== undefined ? { helpText } : {}),
        ...(isMandatory !== undefined ? { isMandatory } : {}),
        ...(storeValue !== undefined ? { storeValue } : {}),
        ...(showInList !== undefined ? { showInList } : {}),
        ...(globalSearch !== undefined ? { globalSearch } : {}),
        ...(displayType !== undefined && displayType !== "" ? { displayType } : {}),
        ...(defaultValue !== undefined && defaultValue !== "" ? { defaultValue } : {}),
        ...(defaultChecked !== undefined ? { defaultChecked } : {}),
        ...(dynamicDefault !== undefined && dynamicDefault !== "" ? { dynamicDefault } : {}),
        ...(isFormula !== undefined ? { isFormula } : {}),
        ...(subtab !== undefined && subtab !== "" ? { subtab } : {}),
        ...(isParent !== undefined ? { isParent } : {}),
        ...(parentSubtab !== undefined && parentSubtab !== "" ? { parentSubtab } : {}),
        ...(itemSubType !== undefined && itemSubType !== "" ? { itemSubType } : {}),
        ...(items && items.length > 0 ? { items } : {})
    };
};

/**
 * Parses any supported custom object SDF XML (`<customrecordtype>`, `<customlist>`, or `<*customfield>`)
 * into a structured JSON object matching the upsert tools.
 */
export const parseCustomObjectSdfXml = (
    xmlContent: string,
    fallbackScriptId: string
): Record<string, any> => {
    const parsed = create(xmlContent).toObject() as Record<string, any>;
    const rootElement = Object.keys(parsed).find((k) => !k.startsWith("?") && !k.startsWith("@"));

    if (!rootElement || !parsed[rootElement] || typeof parsed[rootElement] !== "object") {
        throw new Error(`Could not parse SDF root element from XML for '${fallbackScriptId}'.`);
    }

    const rootObj = parsed[rootElement] as Record<string, any>;

    if (rootElement === "customrecordtype") {
        return parseCustomRecordTypeObject(rootObj, fallbackScriptId);
    }

    if (rootElement === "customlist") {
        return parseCustomListObject(rootObj, fallbackScriptId);
    }

    if (FIELD_CATEGORY_BY_ROOT_ELEMENT[rootElement]) {
        return parseStandaloneCustomFieldObject(rootElement, rootObj, fallbackScriptId);
    }

    return {
        objectType: rootElement,
        rootElement,
        scriptId: String(rootObj["@scriptid"] || fallbackScriptId).trim().toLowerCase(),
        parsedObject: rootObj
    };
};

const KNOWN_PREFIXES = [
    "customrecord_",
    "customlist_",
    "custitemnumber_",
    "custrecord_",
    "custentity_",
    "custevent_",
    "custbody_",
    "custitem_",
    "custcol_"
];

/**
 * Resolves the target scriptId and SDF object type hint from user input (`scriptId` + optional `objectType`).
 */
const resolveRequestedScriptIdAndSdfType = (
    rawScriptId: string,
    rawObjectType?: ViewCustomObjectTypeFilter
): { scriptId: string; sdfType: string } => {
    let id = rawScriptId.trim();
    if (id.toLowerCase().endsWith(".xml")) {
        id = id.slice(0, -".xml".length);
    }
    const bracketMatch = id.match(/^\[scriptid=([^\]]+)\]$/i);
    if (bracketMatch && bracketMatch[1]) {
        id = bracketMatch[1].trim();
    }
    id = id.toLowerCase().split(".")[0].trim();

    if (!id) {
        throw new Error("'scriptId' cannot be empty.");
    }

    const cleanType = (rawObjectType || "auto").trim().toLowerCase();
    const hasKnownPrefix = KNOWN_PREFIXES.some((p) => id.startsWith(p));

    if (!hasKnownPrefix) {
        if (cleanType === "custom_record_type") {
            id = `customrecord_${id.replace(/^_+/, "")}`;
        } else if (cleanType === "custom_list") {
            id = `customlist_${id.replace(/^_+/, "")}`;
        } else if (CUSTOM_FIELD_CATEGORIES.includes(cleanType as CustomFieldCategory)) {
            const spec = CUSTOM_FIELD_CATEGORY_SPECS[cleanType as CustomFieldCategory];
            id = `${spec.prefix}${id.replace(/^_+/, "")}`;
        } else {
            throw new Error(
                `ScriptId '${id}' does not start with a known NetSuite custom object prefix (${KNOWN_PREFIXES.join(", ")}). Please include the prefix or specify 'objectType' (e.g., 'custom_record_type', 'custom_list', 'transaction_body', 'transaction_line', 'entity', 'item', 'crm', 'other_record', 'item_option', 'item_number').`
            );
        }
    }

    let sdfType = "ALL";
    if (id.startsWith("customrecord_")) {
        sdfType = "customrecordtype";
    } else if (id.startsWith("customlist_")) {
        sdfType = "customlist";
    } else if (id.startsWith("custbody_")) {
        sdfType = "transactionbodycustomfield";
    } else if (id.startsWith("custevent_")) {
        sdfType = "crmcustomfield";
    } else if (id.startsWith("custitem_")) {
        sdfType = "itemcustomfield";
    } else if (id.startsWith("custentity_")) {
        sdfType = "entitycustomfield";
    } else if (id.startsWith("custitemnumber_")) {
        sdfType = "itemnumbercustomfield";
    } else if (id.startsWith("custrecord_")) {
        sdfType = "othercustomfield";
    } else if (id.startsWith("custcol_")) {
        if (cleanType === "transaction_line") {
            sdfType = "transactioncolumncustomfield";
        } else if (cleanType === "item_option") {
            sdfType = "itemoptioncustomfield";
        } else {
            sdfType = "ALL";
        }
    }

    return { scriptId: id, sdfType };
};

/**
 * Resolves the list of SDF `--type` values to pass to `suitecloud object:list` when `scriptId` is omitted.
 */
const resolveSdfListTypes = (rawObjectType?: ViewCustomObjectTypeFilter): string[] => {
    const clean = (rawObjectType || "all").trim().toLowerCase();

    if (clean === "custom_record_type") {
        return ["customrecordtype"];
    }
    if (clean === "custom_list") {
        return ["customlist"];
    }
    if (clean === "custom_field") {
        return CUSTOM_FIELD_CATEGORIES.map((c) => CUSTOM_FIELD_CATEGORY_SPECS[c].rootElement);
    }
    if (CUSTOM_FIELD_CATEGORIES.includes(clean as CustomFieldCategory)) {
        return [CUSTOM_FIELD_CATEGORY_SPECS[clean as CustomFieldCategory].rootElement];
    }

    // Default ("all" or "auto"): list custom lists, custom record types, and standalone custom fields
    return [
        "customlist",
        "customrecordtype",
        ...CUSTOM_FIELD_CATEGORIES.map((c) => CUSTOM_FIELD_CATEGORY_SPECS[c].rootElement)
    ];
};

export const viewCustomObjectTool: ToolDefinition = {
    name: "netsuite_view_custom_object",
    description:
        "Inspects an existing NetSuite Custom Record Type (`customrecord_*`), Custom List (`customlist_*`), or Standalone Custom Field (`custbody_*`, `custcol_*`, `custevent_*`, `custitem_*`, `custentity_*`, `custrecord_*`, `custitemnumber_*`) via SDF in an isolated temporary SDF project, OR lists/searches existing custom objects when `scriptId` is omitted.\n\n" +
        "HOW TO USE (TWO MODES):\n" +
        "1. Inspect a Specific Custom Object (`scriptId` provided):\n" +
        "   - Pass `scriptId` (e.g., `'customrecord_my_rec'`, `'customlist_my_list'`, or `'custbody_delivery_notes'`) to download and parse its full SDF XML definition.\n" +
        "   - Returns the object's current properties in the exact JSON format accepted by `netsuite_upsert_custom_record_type`, `netsuite_upsert_custom_list` (including each list value's `scriptId` and `value`), or `netsuite_upsert_custom_field` (including `fieldCategory`, `appliesTo`, `displayType`, `selectRecordType`, `defaultValue`, etc.).\n" +
        "   - Always call this tool before updating an existing Custom Record Type, Custom List, or Custom Field in a new session so you know its current properties, field definitions, or list value `scriptId`s.\n" +
        "2. List / Search Custom Objects (`scriptId` omitted):\n" +
        "   - If you do not know the exact `scriptId` (for example, to find a `customlist_*` or standalone custom field), omit `scriptId` and pass an optional `objectType` filter (`'custom_list'`, `'custom_record_type'`, `'custom_field'`, or a specific field category like `'transaction_body'`) and/or `searchTerm`.",
    meta: {
        isDestructive: false,
        requiresSdf: true,
        category: "custom_objects"
    },
    inputSchema: {
        type: "object",
        properties: {
            scriptId: {
                type: "string",
                description:
                    "(Optional) The script ID of the Custom Record Type (`customrecord_*`), Custom List (`customlist_*`), or Standalone Custom Field (`custbody_*`, `custcol_*`, `custevent_*`, `custitem_*`, `custentity_*`, `custrecord_*`, `custitemnumber_*`) to download and inspect. Note: To inspect a `custrecord_*` field that belongs to a `customrecord_*` table, pass the parent `customrecord_*` scriptId. Omit `scriptId` to list/search custom objects."
            },
            objectType: {
                type: "string",
                enum: [
                    "auto",
                    "all",
                    "custom_record_type",
                    "custom_list",
                    "custom_field",
                    ...CUSTOM_FIELD_CATEGORIES
                ],
                description:
                    "(Optional) When `scriptId` is provided, acts as an optional type hint (or auto-prepends the matching prefix if `scriptId` was passed without a prefix). When `scriptId` is omitted (list mode), filters which custom object types to list: `'custom_list'`, `'custom_record_type'`, `'custom_field'`, a specific field category (`'transaction_body'`, `'transaction_line'`, `'crm'`, `'item'`, `'entity'`, `'other_record'`, `'item_option'`, `'item_number'`), or `'all'` (default)."
            },
            searchTerm: {
                type: "string",
                description:
                    "(Optional, used when `scriptId` is omitted) Case-insensitive partial search term to filter listed custom object script IDs."
            },
            limit: {
                type: "number",
                description:
                    "(Optional, used when `scriptId` is omitted) Maximum number of matching custom object script IDs to return (1 to 1000, default: 100)."
            },
            includeRawXml: {
                type: "boolean",
                description:
                    "(Optional, used when `scriptId` is provided) Whether to include the raw SDF XML string (`rawXml`) in the response alongside the parsed JSON definition. Defaults to false."
            }
        }
    },
    execute: async (args: ViewCustomObjectArgs, server: Server) => {
        try {
            const rawScriptId = typeof args?.scriptId === "string" ? args.scriptId.trim() : "";
            const projectRoot = await getProjectRoot(server);
            const projectConfig = await getProjectConfig(projectRoot);
            const sdfSrcDir = await getSdfSrcDir(projectRoot, projectConfig);
            const objectsDir = path.join(sdfSrcDir, "Objects");

            // =================================================================
            // MODE 1: INSPECT A SPECIFIC CUSTOM OBJECT BY SCRIPT ID
            // =================================================================
            if (rawScriptId) {
                const { scriptId, sdfType } = resolveRequestedScriptIdAndSdfType(
                    rawScriptId,
                    args.objectType
                );

                const localXmlPath = (await fileExists(objectsDir))
                    ? await findExistingObjectFile(objectsDir, scriptId)
                    : null;

                return await withTempSdfProject(
                    {
                        projectRoot,
                        projectConfig,
                        tempDirPrefix: "netsuite-mcp-obj-view-"
                    },
                    async (tempProject) => {
                        let xmlContent: string | null = null;
                        let source: "netsuite_sdf" | "local_sdf_only" = "netsuite_sdf";
                        let importError: string | undefined;

                        try {
                            const downloadedPath = await downloadSdfObjectInTempProject(
                                tempProject,
                                scriptId,
                                sdfType
                            );
                            if (await fileExists(downloadedPath)) {
                                xmlContent = await fs.readFile(downloadedPath, "utf-8");
                            }
                        } catch (err: any) {
                            importError = err?.stdout || err?.stderr || err?.message || String(err);
                            if (sdfType !== "ALL") {
                                try {
                                    const fallbackPath = await downloadSdfObjectInTempProject(
                                        tempProject,
                                        scriptId,
                                        "ALL"
                                    );
                                    if (await fileExists(fallbackPath)) {
                                        xmlContent = await fs.readFile(fallbackPath, "utf-8");
                                        importError = undefined;
                                    }
                                } catch {
                                    // Keep original importError
                                }
                            }
                        }

                        if (!xmlContent && localXmlPath && (await fileExists(localXmlPath))) {
                            xmlContent = await fs.readFile(localXmlPath, "utf-8");
                            source = "local_sdf_only";
                        }

                        if (!xmlContent) {
                            const customRecordFieldHint = scriptId.startsWith("custrecord_")
                                ? " Note: If this 'custrecord_*' field belongs to a Custom Record Type ('customrecord_*') rather than a standalone Other Record Field (<othercustomfield>), pass the parent 'customrecord_*' scriptId to netsuite_view_custom_object instead."
                                : "";
                            return {
                                content: [
                                    {
                                        type: "text",
                                        text: JSON.stringify(
                                            {
                                                success: false,
                                                scriptId,
                                                foundInNetsuite: false,
                                                foundLocally: false,
                                                errorMessage: `Custom object '${scriptId}' was not found in the active NetSuite environment via SDF or in the local project.${customRecordFieldHint}`,
                                                ...(importError ? { sdfDetails: importError.trim() } : {})
                                            },
                                            null,
                                            2
                                        )
                                    }
                                ],
                                isError: true
                            };
                        }

                        const parsedObject = parseCustomObjectSdfXml(xmlContent, scriptId);
                        const payload: Record<string, any> = {
                            success: true,
                            mode: "view",
                            source,
                            foundInNetsuite: source === "netsuite_sdf",
                            localSdfObjectXml: localXmlPath
                                ? {
                                      exists: true,
                                      path: (
                                          path.relative(projectRoot, localXmlPath) || localXmlPath
                                      ).replace(/\\/g, "/")
                                  }
                                : { exists: false },
                            ...parsedObject,
                            ...(args.includeRawXml ? { rawXml: xmlContent } : {})
                        };

                        return {
                            content: [
                                {
                                    type: "text",
                                    text: JSON.stringify(payload, null, 2)
                                }
                            ]
                        };
                    }
                );
            }

            // =================================================================
            // MODE 2: LIST / SEARCH CUSTOM OBJECTS WHEN SCRIPT ID IS OMITTED
            // =================================================================
            const sdfTypesToList = resolveSdfListTypes(args.objectType);
            const searchTerm = typeof args?.searchTerm === "string" ? args.searchTerm.trim() : "";
            const lowerTerm = searchTerm.toLowerCase();
            const rawLimit = args?.limit != null ? Number(args.limit) : 100;
            const limit =
                !Number.isNaN(rawLimit) && rawLimit > 0
                    ? Math.min(Math.floor(rawLimit), 1000)
                    : 100;

            return await withTempSdfProject(
                {
                    projectRoot,
                    projectConfig,
                    tempDirPrefix: "netsuite-mcp-obj-list-"
                },
                async (tempProject) => {
                    const typesArg = sdfTypesToList.join(" ");
                    const { stdout } = await execAsync(
                        `suitecloud object:list --type ${typesArg}`,
                        { cwd: tempProject.tempDir }
                    );

                    const objectsByType: Record<string, string[]> = {};
                    const allMatched: { type: string; scriptId: string }[] = [];
                    const seen = new Set<string>();

                    for (const rawLine of stdout.split(/\r?\n/)) {
                        const line = rawLine.trim();
                        if (!line) continue;

                        // SuiteCloud CLI outputs `type:scriptid` (or `scriptid` when a single type is queried)
                        const match = line.match(
                            /^(?:([a-z]+):)?((?:customrecord|customlist|custbody|custcol|custevent|custitem|custentity|custrecord|custitemnumber)_[a-zA-Z0-9_]+)$/i
                        );
                        if (!match || !match[2]) continue;

                        const scriptId = match[2].toLowerCase();
                        const rawType = (match[1] || (sdfTypesToList.length === 1 ? sdfTypesToList[0] : "customobject")).toLowerCase();

                        if (seen.has(`${rawType}:${scriptId}`)) continue;
                        seen.add(`${rawType}:${scriptId}`);

                        if (lowerTerm && !scriptId.includes(lowerTerm) && !rawType.includes(lowerTerm)) {
                            continue;
                        }

                        allMatched.push({ type: rawType, scriptId });
                    }

                    const limitedItems = allMatched.slice(0, limit);
                    for (const item of limitedItems) {
                        if (!objectsByType[item.type]) {
                            objectsByType[item.type] = [];
                        }
                        objectsByType[item.type].push(item.scriptId);
                    }

                    const payload: Record<string, any> = {
                        success: true,
                        mode: "list",
                        objectTypesQueried: sdfTypesToList,
                        ...(searchTerm ? { searchTerm } : {}),
                        totalMatchingCount: allMatched.length,
                        count: limitedItems.length,
                        objectsByType,
                        objects: limitedItems
                    };

                    return {
                        content: [
                            {
                                type: "text",
                                text: JSON.stringify(payload, null, 2)
                            }
                        ]
                    };
                }
            );
        } catch (error: any) {
            return {
                content: [
                    {
                        type: "text",
                        text: `Error viewing custom object: ${error.message}`
                    }
                ],
                isError: true
            };
        }
    }
};
