import fs from "fs/promises";
import { ToolDefinition } from "../types/index.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
    deployObjectFromTempProject,
    downloadSdfObjectInTempProject,
    getSaveToProjectSchemaProperty
} from "../utils/objects.js";
import { getProjectRoot } from "../utils/mcp.js";
import { getProjectConfig } from "../utils/project.js";
import { withTempSdfProject } from "../utils/tempSdfProject.js";
import { applyDefaults } from "../defaults/index.js";
import { ObjectDefaultType } from "../defaults/types.js";
import {
    CUSTOM_FIELD_TYPES,
    CustomRecordAccessType,
    CustomRecordField,
    buildNewCustomRecordFieldObject,
    extractCustomObjectDependency,
    mapCustomRecordFields,
    mergeExistingCustomRecordFieldObject,
    normalizeCustomRecordFieldScriptId,
    normalizeCustomRecordScriptId
} from "../utils/customRecords.js";
import { create } from "xmlbuilder2";

type RecordUpsertCustomRecord = {
    scriptId: string;
    name?: string;
    description?: string;
    aiDescription?: string;
    includeNameField?: boolean;
    accessType?: CustomRecordAccessType;
    isHierarchy?: boolean;
    allowInlineEditing?: boolean;
    enableNumbering?: boolean;
    numberingPrefix?: string;
    numberingMinDigits?: number;
    showId?: boolean;
    showOwner?: boolean;
    isOrdered?: boolean;
    fields?: CustomRecordField[];
    saveToProject?: boolean;
};

const fileExists = async (targetPath: string): Promise<boolean> => {
    try {
        await fs.access(targetPath);
        return true;
    } catch {
        return false;
    }
};

const setNodeTextPreservingAttrs = (existingNode: any, newText: string): any => {
    if (existingNode && typeof existingNode === "object" && !Array.isArray(existingNode)) {
        return {
            ...existingNode,
            "#": newText
        };
    }
    return newText;
};

const extractRefText = (node: any): string | undefined => {
    if (typeof node === "string") return node;
    if (node && typeof node === "object" && typeof node["#"] === "string") return node["#"];
    return undefined;
};

const collectDependenciesFromCustomRecordFields = (
    allFieldsRaw: any,
    selfScriptId: string
): { objects: string[] } | undefined => {
    if (!allFieldsRaw) return undefined;

    const allFields = Array.isArray(allFieldsRaw) ? allFieldsRaw : [allFieldsRaw];
    const selfLower = selfScriptId.toLowerCase();
    const deps = new Set<string>();

    const checkNode = (node: any) => {
        const dep = extractCustomObjectDependency(extractRefText(node));
        if (dep && dep !== selfLower) {
            deps.add(dep);
        }
    };

    for (const f of allFields) {
        if (!f || typeof f !== "object") continue;
        checkNode(f.selectrecordtype);
        checkNode(f.subtab);
        checkNode(f.parentsubtab);
    }

    return deps.size > 0 ? { objects: Array.from(deps) } : undefined;
};

export const upsertCustomRecordTool: ToolDefinition = {
    name: "netsuite_upsert_custom_record",
    description:
        "Creates or updates a Custom Record Type (customrecord_*) and its custom fields (custrecord_*) in NetSuite via an isolated temporary SDF project. If the custom record already exists in NetSuite, its current XML definition is downloaded and merged: any provided header properties are updated, incoming fields matching an existing field's scriptId update that field in-place (preserving unexposed XML properties), and new fields are appended with configured field defaults applied. If the custom record does not exist yet, a new Custom Record Type is created ('name', 'description', and 'aiDescription' are strictly required on creation for semantic table discovery) with configured record and field defaults applied. Automatically resolves manifest.xml dependencies and optionally copies the deployed XML into the local project.",
    meta: {
        isDestructive: true,
        requiresSdf: true
    },
    inputSchema: {
        type: "object",
        properties: {
            scriptId: {
                type: "string",
                description:
                    "The internal ID of the custom record to create or update. Must start with 'customrecord_' (auto-prepended if omitted). Maximum length is 38 characters."
            },
            name: {
                type: "string",
                description:
                    "The name/label of the custom record (maximum length is 30 characters). REQUIRED when creating a new custom record; optional when updating an existing custom record."
            },
            description: {
                type: "string",
                description:
                    "The description of the custom record. REQUIRED when creating a new custom record (used for semantic table discovery); optional when updating an existing custom record."
            },
            aiDescription: {
                type: "string",
                description:
                    "The AI description (aidescription) of the custom record. REQUIRED when creating a new custom record (used for semantic table discovery); optional when updating an existing custom record."
            },
            includeNameField: {
                type: "boolean",
                description:
                    "(Optional) Indicate if the native Name field should be included (includename). Defaults to true when creating a new custom record."
            },
            accessType: {
                type: "string",
                enum: ["CUSTRECORDENTRYPERM", "NONENEEDED", "USEPERMISSIONLIST"],
                description:
                    "(Optional) Permission access model for the custom record (accesstype): 'CUSTRECORDENTRYPERM' (Require Custom Record Entries Permission), 'NONENEEDED' (No Permission Required), or 'USEPERMISSIONLIST' (Use Permission List)."
            },
            isHierarchy: {
                type: "boolean",
                description:
                    "(Optional) Enable built-in parent-child hierarchy on the custom record itself (hierarchical)."
            },
            allowInlineEditing: {
                type: "boolean",
                description:
                    "(Optional) Allow inline editing of records in list and sublist views (allowinlineediting)."
            },
            enableNumbering: {
                type: "boolean",
                description:
                    "(Optional) Enable automatic record numbering (enablenumbering)."
            },
            numberingPrefix: {
                type: "string",
                description:
                    "(Optional) Prefix used when automatic record numbering is enabled (numberingprefix, e.g. 'REQ-')."
            },
            numberingMinDigits: {
                type: "integer",
                description:
                    "(Optional) Minimum number of digits for automatic record numbering (numberingmindigits, e.g. 4)."
            },
            showId: {
                type: "boolean",
                description:
                    "(Optional) Display the internal ID / numbered ID on the record form and list (showid)."
            },
            showOwner: {
                type: "boolean",
                description:
                    "(Optional) Display the Owner field on the custom record (showowner)."
            },
            isOrdered: {
                type: "boolean",
                description:
                    "(Optional) Keep instances of this custom record ordered in lists (isordered)."
            },
            fields: {
                type: "array",
                description:
                    "(Optional) An array of custom fields (custrecord_*) to add or update on the custom record. When updating an existing custom record: if a field's 'scriptId' matches an existing field on the record, that field is updated in-place; otherwise it is appended as a new field.",
                items: {
                    type: "object",
                    properties: {
                        scriptId: {
                            type: "string",
                            description:
                                "Internal ID of the field. Must start with 'custrecord_' (auto-prepended if omitted). Maximum length is 38 characters."
                        },
                        label: {
                            type: "string",
                            description: "The label displayed in the UI for this field (maximum 40 characters)."
                        },
                        type: {
                            type: "string",
                            description:
                                "Field type (e.g., 'TEXT', 'INTEGER', 'SELECT', 'DATE', 'CHECKBOX', 'CURRENCY').",
                            enum: CUSTOM_FIELD_TYPES
                        },
                        selectRecordType: {
                            type: "string",
                            description:
                                "Required ONLY if type is 'SELECT' or 'MULTISELECT'. The scriptId of the custom record or custom list (e.g., 'customrecord_my_rec' or 'customlist_my_list'), or a standard NetSuite record name (e.g., 'customer', 'vendor', 'employee', 'item', 'transaction', 'account', 'department', 'location', 'subsidiary', 'class')."
                        },
                        description: {
                            type: "string",
                            description:
                                "Description of the field (required for schema documentation and semantic table discovery)."
                        },
                        helpText: {
                            type: "string",
                            description:
                                "Help text displayed when clicking the field label in the NetSuite UI."
                        },
                        isMandatory: {
                            type: "boolean",
                            description: "(Optional) Whether the field is mandatory (ismandatory)."
                        },
                        storeValue: {
                            type: "boolean",
                            description:
                                "(Optional) Whether the field value is stored in the database (storevalue). Defaults to true."
                        },
                        showInList: {
                            type: "boolean",
                            description:
                                "(Optional) Whether the field is shown as a column in the custom record's list view (showinlist)."
                        },
                        globalSearch: {
                            type: "boolean",
                            description:
                                "(Optional) Whether the field is indexed for global search (globalsearch)."
                        },
                        displayType: {
                            type: "string",
                            enum: ["NORMAL", "LOCKED", "STATICTEXT", "HIDDEN", "DISABLED", "INLINE"],
                            description:
                                "(Optional) UI display type (<displaytype>). Valid SDF values are 'NORMAL', 'LOCKED' (UI Disabled), 'STATICTEXT' (UI Inline Text), and 'HIDDEN'. Aliases 'DISABLED' (-> 'LOCKED') and 'INLINE' (-> 'STATICTEXT') are also accepted."
                        },
                        defaultValue: {
                            type: "string",
                            description: "(Optional) Static or formula default value (defaultvalue)."
                        },
                        defaultChecked: {
                            type: "boolean",
                            description:
                                "(Optional) For CHECKBOX fields, whether the box is checked by default (defaultchecked)."
                        },
                        dynamicDefault: {
                            type: "string",
                            description:
                                "(Optional) Dynamic default constant (e.g., 'NOW', 'ME', 'CURRENTUSERSUBSIDIARY', 'CURRENTUSERDEPARTMENT', 'CURRENTUSERLOCATION')."
                        },
                        isFormula: {
                            type: "boolean",
                            description:
                                "(Optional) Whether defaultValue is evaluated as a formula (isformula)."
                        },
                        isParent: {
                            type: "boolean",
                            description:
                                "(Optional) For SELECT fields, whether the referenced record is the parent record in a parent-child sublist relationship (isparent)."
                        },
                        parentSubtab: {
                            type: "string",
                            description:
                                "(Optional) Subtab on the parent record where child records appear when isParent is true (parentsubtab, e.g. 'ENTITYMAIN', 'TRANSACTIONMAIN', or 'custtab_custom')."
                        },
                        onParentDelete: {
                            type: "string",
                            enum: ["SET_NULL", "STOP_DELETE", "DELETE_THIS_CHILD"],
                            description:
                                "(Optional) Action taken on child records when the parent record is deleted (onparentdelete): 'SET_NULL', 'STOP_DELETE', or 'DELETE_THIS_CHILD'."
                        },
                        subtab: {
                            type: "string",
                            description:
                                "(Optional) Subtab on this custom record where the field is placed (subtab)."
                        }
                    },
                    required: ["scriptId", "label", "type", "description", "helpText"]
                }
            },
            saveToProject: getSaveToProjectSchemaProperty()
        },
        required: ["scriptId"]
    },
    execute: async (args: RecordUpsertCustomRecord, server: Server) => {
        try {
            const scriptId = normalizeCustomRecordScriptId(args.scriptId);
            const {
                name,
                description,
                aiDescription,
                includeNameField,
                accessType,
                isHierarchy,
                allowInlineEditing,
                enableNumbering,
                numberingPrefix,
                numberingMinDigits,
                showId,
                showOwner,
                isOrdered,
                fields = [],
                saveToProject
            } = args;

            if (name !== undefined && name.trim().length > 30) {
                throw new Error(
                    `'name' is ${name.trim().length} characters long, exceeding the NetSuite SDF limit of 30 characters.`
                );
            }

            if (
                numberingMinDigits !== undefined &&
                (!Number.isInteger(numberingMinDigits) || numberingMinDigits < 1)
            ) {
                throw new Error(`'numberingMinDigits' must be a positive integer.`);
            }

            // Normalize field scriptIds and deduplicate incoming fields by scriptId (last wins)
            const deduplicatedFieldsMap = new Map<string, CustomRecordField>();
            for (const f of fields ?? []) {
                if (!f || typeof f !== "object") continue;
                const normalizedFieldId = normalizeCustomRecordFieldScriptId(f.scriptId);
                deduplicatedFieldsMap.set(normalizedFieldId, {
                    ...f,
                    scriptId: normalizedFieldId
                });
            }
            const normalizedFields = Array.from(deduplicatedFieldsMap.values());

            const projectRoot = await getProjectRoot(server);
            const projectConfig = await getProjectConfig(projectRoot);

            return await withTempSdfProject(
                {
                    projectRoot,
                    projectConfig,
                    tempDirPrefix: "netsuite-mcp-rec-upsert-"
                },
                async (tempProject) => {
                    // 1. Attempt to download the existing custom record from NetSuite
                    let existingFilePath: string | null = null;
                    try {
                        const downloadedPath = await downloadSdfObjectInTempProject(tempProject, scriptId, "ALL");
                        if (await fileExists(downloadedPath)) {
                            existingFilePath = downloadedPath;
                        }
                    } catch {
                        existingFilePath = null;
                    }

                    // 2. UPDATE FLOW: custom record already exists in NetSuite
                    if (existingFilePath) {
                        const xmlContent = await fs.readFile(existingFilePath, "utf-8");
                        const obj = create(xmlContent).toObject() as any;

                        if (!obj.customrecordtype || typeof obj.customrecordtype !== "object") {
                            return {
                                content: [
                                    {
                                        type: "text",
                                        text: `Error: Could not parse <customrecordtype> from the downloaded object '${scriptId}'.`
                                    }
                                ]
                            };
                        }

                        const rec = obj.customrecordtype;

                        if (name !== undefined && name.trim() !== "") {
                            rec.recordname = setNodeTextPreservingAttrs(rec.recordname, name.trim());
                        }
                        if (description !== undefined) {
                            rec.description = setNodeTextPreservingAttrs(rec.description, description);
                        }
                        if (aiDescription !== undefined) {
                            rec.aidescription = setNodeTextPreservingAttrs(rec.aidescription, aiDescription);
                        }
                        if (includeNameField !== undefined) {
                            rec.includename = setNodeTextPreservingAttrs(
                                rec.includename,
                                includeNameField ? "T" : "F"
                            );
                        }
                        if (accessType !== undefined) {
                            rec.accesstype = setNodeTextPreservingAttrs(rec.accesstype, accessType);
                        }
                        if (isHierarchy !== undefined) {
                            rec.hierarchical = setNodeTextPreservingAttrs(
                                rec.hierarchical,
                                isHierarchy ? "T" : "F"
                            );
                        }
                        if (allowInlineEditing !== undefined) {
                            rec.allowinlineediting = setNodeTextPreservingAttrs(
                                rec.allowinlineediting,
                                allowInlineEditing ? "T" : "F"
                            );
                        }
                        if (enableNumbering !== undefined) {
                            rec.enablenumbering = setNodeTextPreservingAttrs(
                                rec.enablenumbering,
                                enableNumbering ? "T" : "F"
                            );
                        }
                        if (numberingPrefix !== undefined) {
                            rec.numberingprefix = setNodeTextPreservingAttrs(
                                rec.numberingprefix,
                                numberingPrefix
                            );
                        }
                        if (numberingMinDigits !== undefined) {
                            rec.numberingmindigits = setNodeTextPreservingAttrs(
                                rec.numberingmindigits,
                                String(numberingMinDigits)
                            );
                        }
                        if (showId !== undefined) {
                            rec.showid = setNodeTextPreservingAttrs(rec.showid, showId ? "T" : "F");
                        }
                        if (showOwner !== undefined) {
                            rec.showowner = setNodeTextPreservingAttrs(rec.showowner, showOwner ? "T" : "F");
                        }
                        if (isOrdered !== undefined) {
                            rec.isordered = setNodeTextPreservingAttrs(rec.isordered, isOrdered ? "T" : "F");
                        }

                        const addedFields: string[] = [];
                        const updatedFields: string[] = [];

                        if (normalizedFields.length > 0) {
                            if (
                                !rec.customrecordcustomfields ||
                                typeof rec.customrecordcustomfields !== "object"
                            ) {
                                rec.customrecordcustomfields = {};
                            }

                            let existingFields: any[] = [];
                            if (rec.customrecordcustomfields.customrecordcustomfield) {
                                existingFields = Array.isArray(
                                    rec.customrecordcustomfields.customrecordcustomfield
                                )
                                    ? rec.customrecordcustomfields.customrecordcustomfield
                                    : [rec.customrecordcustomfields.customrecordcustomfield];
                            }

                            for (const incomingField of normalizedFields) {
                                const incomingIdLower = incomingField.scriptId.toLowerCase();
                                const matchById = existingFields.find(
                                    (ef) =>
                                        ef &&
                                        typeof ef === "object" &&
                                        String(ef["@scriptid"] || "")
                                            .trim()
                                            .toLowerCase() === incomingIdLower
                                );

                                if (matchById) {
                                    mergeExistingCustomRecordFieldObject(matchById, incomingField);
                                    updatedFields.push(`${incomingField.scriptId} ("${incomingField.label}")`);
                                } else {
                                    const builtNewField = await buildNewCustomRecordFieldObject(incomingField);
                                    existingFields.push(builtNewField);
                                    addedFields.push(`${incomingField.scriptId} ("${incomingField.label}")`);
                                }
                            }

                            if (existingFields.length > 0) {
                                rec.customrecordcustomfields.customrecordcustomfield = existingFields;
                            }
                        }

                        const manifestDependencies = collectDependenciesFromCustomRecordFields(
                            rec.customrecordcustomfields?.customrecordcustomfield,
                            scriptId
                        );

                        const updatedXml = create({ version: "1.0", encoding: "UTF-8" }, obj).end({
                            prettyPrint: true
                        });

                        const output = await deployObjectFromTempProject({
                            tempProject,
                            projectRoot,
                            scriptId,
                            xmlContent: updatedXml,
                            manifestDependencies,
                            options: {
                                saveToProject,
                                rootElement: "customrecordtype",
                                projectConfig
                            }
                        });

                        const summaryParts: string[] = [];
                        if (addedFields.length > 0) {
                            summaryParts.push(`Added ${addedFields.length} field(s): ${addedFields.join(", ")}`);
                        }
                        if (updatedFields.length > 0) {
                            summaryParts.push(
                                `Updated ${updatedFields.length} field(s): ${updatedFields.join(", ")}`
                            );
                        }
                        const summaryNote =
                            summaryParts.length > 0
                                ? `\n[Upsert Summary (updated '${scriptId}'): ${summaryParts.join(" | ")}]`
                                : `\n[Upsert Summary (updated '${scriptId}'): Updated record header properties]`;

                        return { content: [{ type: "text", text: `${output}${summaryNote}` }] };
                    }

                    // 3. CREATE FLOW: custom record does not exist yet in NetSuite
                    const missingCreateFields: string[] = [];
                    if (!name || !name.trim()) {
                        missingCreateFields.push("'name'");
                    }
                    if (!description || !description.trim()) {
                        missingCreateFields.push("'description'");
                    }
                    if (!aiDescription || !aiDescription.trim()) {
                        missingCreateFields.push("'aiDescription'");
                    }

                    if (missingCreateFields.length > 0) {
                        throw new Error(
                            `${missingCreateFields.join(", ")} ${
                                missingCreateFields.length === 1 ? "is" : "are"
                            } required when creating a new Custom Record Type ('${scriptId}' does not exist in NetSuite yet). Both 'description' and 'aiDescription' must be populated for semantic table discovery.`
                        );
                    }

                    const mappedFields =
                        normalizedFields.length > 0 ? await mapCustomRecordFields(normalizedFields) : [];

                    const baseRecordData: Record<string, any> = {
                        recordname: name!.trim(),
                        description: description!,
                        aidescription: aiDescription!,
                        includename: (includeNameField ?? true) ? "T" : "F",
                        ...(accessType !== undefined ? { accesstype: accessType } : {}),
                        ...(isHierarchy !== undefined ? { hierarchical: isHierarchy ? "T" : "F" } : {}),
                        ...(allowInlineEditing !== undefined
                            ? { allowinlineediting: allowInlineEditing ? "T" : "F" }
                            : {}),
                        ...(enableNumbering !== undefined
                            ? { enablenumbering: enableNumbering ? "T" : "F" }
                            : {}),
                        ...(numberingPrefix !== undefined ? { numberingprefix: numberingPrefix } : {}),
                        ...(numberingMinDigits !== undefined
                            ? { numberingmindigits: String(numberingMinDigits) }
                            : {}),
                        ...(showId !== undefined ? { showid: showId ? "T" : "F" } : {}),
                        ...(showOwner !== undefined ? { showowner: showOwner ? "T" : "F" } : {}),
                        ...(isOrdered !== undefined ? { isordered: isOrdered ? "T" : "F" } : {}),
                        ...(mappedFields.length > 0 && {
                            customrecordcustomfields: {
                                customrecordcustomfield: mappedFields
                            }
                        })
                    };

                    const sdfData = await applyDefaults(baseRecordData, ObjectDefaultType.RECORD);
                    const xmlObject = {
                        customrecordtype: {
                            "@scriptid": scriptId,
                            ...sdfData
                        }
                    };
                    const createdXml = create({ version: "1.0", encoding: "UTF-8" }, xmlObject).end({
                        prettyPrint: true
                    });

                    const manifestDependencies = collectDependenciesFromCustomRecordFields(
                        mappedFields,
                        scriptId
                    );

                    const output = await deployObjectFromTempProject({
                        tempProject,
                        projectRoot,
                        scriptId,
                        xmlContent: createdXml,
                        manifestDependencies,
                        options: {
                            saveToProject,
                            rootElement: "customrecordtype",
                            projectConfig
                        }
                    });

                    const createdSummary = `\n[Upsert Summary (created '${scriptId}'): Created custom record with ${mappedFields.length} custom field(s)]`;

                    return { content: [{ type: "text", text: `${output}${createdSummary}` }] };
                }
            );
        } catch (error: any) {
            return { content: [{ type: "text", text: `Unexpected Tool Error: ${error.message}` }] };
        }
    }
};
