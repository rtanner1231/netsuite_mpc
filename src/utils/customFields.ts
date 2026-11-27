import { create } from "xmlbuilder2";
import { applyDefaults } from "../defaults/index.js";
import { ObjectDefaultType } from "../defaults/types.js";
import {
    CustomFieldType,
    extractCustomObjectDependency,
    getSelectRecordType
} from "./customRecords.js";

export type CustomFieldCategory =
    | "transaction_body"
    | "transaction_line"
    | "crm"
    | "item"
    | "entity"
    | "other_record"
    | "item_option"
    | "item_number";

export const CUSTOM_FIELD_CATEGORIES: CustomFieldCategory[] = [
    "transaction_body",
    "transaction_line",
    "crm",
    "item",
    "entity",
    "other_record",
    "item_option",
    "item_number"
];

export type CustomFieldDisplayTypeInput =
    | "NORMAL"
    | "LOCKED"
    | "STATICTEXT"
    | "HIDDEN"
    | "DISABLED"
    | "INLINE";

export type CustomFieldSdfDisplayType = "NORMAL" | "LOCKED" | "STATICTEXT" | "HIDDEN";

export type CustomFieldItemSubType = "BOTH" | "PURCHASE" | "SALE";

export interface UpsertCustomFieldInput {
    fieldCategory: CustomFieldCategory;
    scriptId: string;
    label?: string;
    type?: CustomFieldType;
    selectRecordType?: string;
    appliesTo?: string[];
    recordType?: string;
    description?: string;
    helpText?: string;
    isMandatory?: boolean;
    storeValue?: boolean;
    showInList?: boolean;
    globalSearch?: boolean;
    displayType?: CustomFieldDisplayTypeInput;
    defaultValue?: string;
    defaultChecked?: boolean;
    dynamicDefault?: string;
    isFormula?: boolean;
    subtab?: string;
    isParent?: boolean;
    parentSubtab?: string;
    itemSubType?: CustomFieldItemSubType;
    items?: string[];
}

export interface CustomFieldCategorySpec {
    category: CustomFieldCategory;
    rootElement: string;
    prefix: string;
    maxScriptIdLength: number;
    appliesToMap: Record<string, string>;
    canonicalAppliesToNames: string[];
    unsupportedDefaultTags: Set<string>;
    requiredFeatures?: string[];
}

/**
 * Normalizes a displayType input to a valid NetSuite SDF `<displaytype>` value.
 * In NetSuite SDF XML:
 * - UI "Disabled" corresponds to `LOCKED` (`DISABLED` is rejected by SDF).
 * - UI "Inline Text" corresponds to `STATICTEXT` (`INLINE` is rejected by SDF).
 */
export const normalizeDisplayType = (rawDisplayType: string): CustomFieldSdfDisplayType => {
    const upper = (rawDisplayType || "").trim().toUpperCase();
    switch (upper) {
        case "NORMAL":
            return "NORMAL";
        case "LOCKED":
        case "DISABLED":
            return "LOCKED";
        case "STATICTEXT":
        case "INLINE":
        case "INLINETEXT":
        case "INLINE_TEXT":
            return "STATICTEXT";
        case "HIDDEN":
            return "HIDDEN";
        default:
            throw new Error(
                `Invalid displayType '${rawDisplayType}'. Must be one of: NORMAL, LOCKED (or alias DISABLED), STATICTEXT (or alias INLINE), HIDDEN.`
            );
    }
};

const buildAliasMap = (entries: Array<[string, string[]]>): {
    map: Record<string, string>;
    canonicalNames: string[];
} => {
    const map: Record<string, string> = {};
    const canonicalNames: string[] = [];

    for (const [sdfTag, aliases] of entries) {
        if (aliases.length > 0) {
            canonicalNames.push(aliases[0]);
        }
        const normalizedTag = sdfTag.toLowerCase().replace(/[\s_-]+/g, "");
        map[normalizedTag] = sdfTag;
        map[sdfTag.toLowerCase()] = sdfTag;

        for (const alias of aliases) {
            const lower = alias.toLowerCase().trim();
            const compact = lower.replace(/[\s_-]+/g, "");
            map[lower] = sdfTag;
            map[compact] = sdfTag;
        }
    }

    return { map, canonicalNames };
};

const TRANSACTION_BODY_APPLIES = buildAliasMap([
    ["bodysale", ["SALE", "SALES", "SALES_ORDER", "INVOICE", "CASH_SALE", "ESTIMATE", "QUOTE", "CREDIT_MEMO", "RETURN_AUTHORIZATION"]],
    ["bodypurchase", ["PURCHASE", "PURCHASES", "PURCHASE_ORDER", "VENDOR_BILL", "VENDOR_CREDIT", "VENDOR_RETURN_AUTHORIZATION"]],
    ["bodyitemreceipt", ["ITEM_RECEIPT", "RECEIPT"]],
    ["bodyitemfulfillment", ["ITEM_FULFILLMENT", "FULFILLMENT"]],
    ["bodyjournal", ["JOURNAL", "JOURNAL_ENTRY"]],
    ["bodyexpense", ["EXPENSE_REPORT", "EXPENSE"]],
    ["bodyopportunity", ["OPPORTUNITY"]],
    ["bodycustomerpayment", ["CUSTOMER_PAYMENT"]],
    ["bodyvendorpayment", ["VENDOR_PAYMENT", "BILL_PAYMENT"]],
    ["bodydeposit", ["DEPOSIT", "CUSTOMER_DEPOSIT"]],
    ["bodydepositapplication", ["DEPOSIT_APPLICATION"]],
    ["bodytransferorder", ["TRANSFER_ORDER"]],
    ["bodyinventoryadjustment", ["INVENTORY_ADJUSTMENT"]],
    ["bodyassemblybuild", ["ASSEMBLY_BUILD", "BUILD"]],
    ["bodyworkorder", ["WORK_ORDER"]],
    ["bodystore", ["WEB_STORE", "STORE"]],
    ["bodyprintflag", ["PRINT", "PRINT_FLAG"]],
    ["bodypickingticket", ["PICKING_TICKET"]],
    ["bodybilloflading", ["BILL_OF_LADING"]],
    ["bodyitemhipment", ["INBOUND_SHIPMENT"]],
    ["bodyperiodendjournal", ["PERIOD_END_JOURNAL"]],
    ["bodypaycheck", ["PAYCHECK"]],
    ["bodyothertransaction", ["OTHER_TRANSACTION"]]
]);

const TRANSACTION_LINE_APPLIES = buildAliasMap([
    ["colsale", ["SALE", "SALES", "SALES_ORDER", "INVOICE", "CASH_SALE", "ESTIMATE", "QUOTE", "CREDIT_MEMO", "RETURN_AUTHORIZATION"]],
    ["colpurchase", ["PURCHASE", "PURCHASES", "PURCHASE_ORDER", "VENDOR_BILL", "VENDOR_CREDIT", "VENDOR_RETURN_AUTHORIZATION"]],
    ["colitemreceipt", ["ITEM_RECEIPT", "RECEIPT"]],
    ["colitemfulfillment", ["ITEM_FULFILLMENT", "FULFILLMENT"]],
    ["coljournal", ["JOURNAL", "JOURNAL_ENTRY"]],
    ["colexpense", ["EXPENSE", "VENDOR_EXPENSE"]],
    ["colexpensereport", ["EXPENSE_REPORT"]],
    ["colopportunity", ["OPPORTUNITY"]],
    ["coltime", ["TIME", "TIME_BILL", "TIME_ENTRY"]],
    ["coltransferorder", ["TRANSFER_ORDER"]],
    ["colbuild", ["ASSEMBLY_BUILD", "BUILD"]],
    ["colworkorder", ["WORK_ORDER"]],
    ["colstore", ["WEB_STORE", "STORE"]],
    ["colpickingticket", ["PICKING_TICKET"]],
    ["colprintflag", ["PRINT", "PRINT_FLAG"]],
    ["colallareas", ["ALL_AREAS"]],
    ["colperiodendjournal", ["PERIOD_END_JOURNAL"]],
    ["colreturnform", ["RETURN_FORM"]],
    ["colstorewithgroups", ["STORE_WITH_GROUPS"]]
]);

const CRM_APPLIES = buildAliasMap([
    ["appliestocase", ["CASE", "SUPPORT_CASE"]],
    ["appliestotask", ["TASK", "PROJECT_TASK"]],
    ["appliestophonecall", ["PHONE_CALL", "CALL"]],
    ["appliestoevent", ["EVENT", "CALENDAR_EVENT"]],
    ["appliestocampaign", ["CAMPAIGN"]],
    ["appliestoissue", ["ISSUE"]],
    ["appliestosolution", ["SOLUTION"]]
]);

const ITEM_APPLIES = buildAliasMap([
    ["appliestoinventory", ["INVENTORY", "INVENTORY_ITEM"]],
    ["appliestononinventory", ["NON_INVENTORY", "NON_INVENTORY_ITEM"]],
    ["appliestoservice", ["SERVICE", "SERVICE_ITEM"]],
    ["appliestoothercharge", ["OTHER_CHARGE", "OTHER_CHARGE_ITEM"]],
    ["appliestokit", ["KIT", "KIT_ITEM", "PACKAGE"]],
    ["appliestoitemassembly", ["ASSEMBLY", "ASSEMBLY_ITEM", "BOM", "ITEM_ASSEMBLY", "APPLIESTOASSEMBLY"]],
    ["appliestogroup", ["ITEM_GROUP", "GROUP"]],
    ["appliestodiscount", ["DISCOUNT", "DISCOUNT_ITEM"]],
    ["appliestomarkup", ["MARKUP", "MARKUP_ITEM"]],
    ["appliestosubtotal", ["SUBTOTAL", "SUBTOTAL_ITEM"]],
    ["appliestopayment", ["PAYMENT", "PAYMENT_ITEM"]],
    ["appliestogiftcert", ["GIFT_CERTIFICATE", "GIFT_CERT"]],
    ["appliestodownload", ["DOWNLOAD", "DOWNLOAD_ITEM"]],
    ["appliestopricelist", ["PRICE_LIST", "DESCRIPTION", "DESCRIPTION_ITEM"]],
    ["appliestoexpense", ["EXPENSE"]]
]);

const ENTITY_APPLIES = buildAliasMap([
    ["appliestocustomer", ["CUSTOMER"]],
    ["appliestovendor", ["VENDOR"]],
    ["appliestoemployee", ["EMPLOYEE"]],
    ["appliestocontact", ["CONTACT"]],
    ["appliestopartner", ["PARTNER"]],
    ["appliestoproject", ["PROJECT", "JOB"]],
    ["appliestogroup", ["GROUP", "ENTITY_GROUP"]],
    ["appliestogenericrsrc", ["GENERIC_RESOURCE"]],
    ["appliestopricelist", ["OTHER_NAME", "PRICE_LIST"]],
    ["appliestostatement", ["STATEMENT"]],
    ["appliestowebsite", ["WEBSITE"]]
]);

const ITEM_OPTION_APPLIES = buildAliasMap([
    ["colallitems", ["ALL_ITEMS", "ALL"]],
    ["colpurchase", ["PURCHASE", "PURCHASES"]],
    ["colsale", ["SALE", "SALES"]],
    ["colopportunity", ["OPPORTUNITY"]],
    ["colstore", ["WEB_STORE", "STORE"]],
    ["colstorehidden", ["STORE_HIDDEN"]],
    ["coltransferorder", ["TRANSFER_ORDER"]],
    ["colkititem", ["KIT", "KIT_ITEM"]]
]);

const ITEM_NUMBER_APPLIES = buildAliasMap([
    ["appliestoallitems", ["ALL_ITEMS", "ALL"]],
    ["appliestoserialized", ["SERIAL", "SERIALIZED", "SERIAL_NUMBER"]],
    ["appliestolots", ["LOT", "LOTS", "LOT_NUMBER", "LOT_NUMBERED"]],
    ["appliestogiftcerts", ["GIFT_CERTIFICATE", "GIFT_CERT", "GIFT_CERTIFICATES", "GIFT_CERTS"]]
]);

export const CUSTOM_FIELD_CATEGORY_SPECS: Record<CustomFieldCategory, CustomFieldCategorySpec> = {
    transaction_body: {
        category: "transaction_body",
        rootElement: "transactionbodycustomfield",
        prefix: "custbody_",
        maxScriptIdLength: 38,
        appliesToMap: TRANSACTION_BODY_APPLIES.map,
        canonicalAppliesToNames: TRANSACTION_BODY_APPLIES.canonicalNames,
        unsupportedDefaultTags: new Set(["allowquickadd", "rolerestrict"])
    },
    transaction_line: {
        category: "transaction_line",
        rootElement: "transactioncolumncustomfield",
        prefix: "custcol_",
        maxScriptIdLength: 38,
        appliesToMap: TRANSACTION_LINE_APPLIES.map,
        canonicalAppliesToNames: TRANSACTION_LINE_APPLIES.canonicalNames,
        unsupportedDefaultTags: new Set([
            "allowquickadd",
            "checkspelling",
            "globalsearch",
            "isparent",
            "onparentdelete",
            "rolerestrict",
            "searchlevel",
            "showinlist"
        ])
    },
    crm: {
        category: "crm",
        rootElement: "crmcustomfield",
        prefix: "custevent_",
        maxScriptIdLength: 38,
        appliesToMap: CRM_APPLIES.map,
        canonicalAppliesToNames: CRM_APPLIES.canonicalNames,
        unsupportedDefaultTags: new Set(["allowquickadd", "rolerestrict"])
    },
    item: {
        category: "item",
        rootElement: "itemcustomfield",
        prefix: "custitem_",
        maxScriptIdLength: 38,
        appliesToMap: ITEM_APPLIES.map,
        canonicalAppliesToNames: ITEM_APPLIES.canonicalNames,
        unsupportedDefaultTags: new Set(["allowquickadd", "rolerestrict"])
    },
    entity: {
        category: "entity",
        rootElement: "entitycustomfield",
        prefix: "custentity_",
        maxScriptIdLength: 38,
        appliesToMap: ENTITY_APPLIES.map,
        canonicalAppliesToNames: ENTITY_APPLIES.canonicalNames,
        unsupportedDefaultTags: new Set(["allowquickadd", "rolerestrict"])
    },
    other_record: {
        category: "other_record",
        rootElement: "othercustomfield",
        prefix: "custrecord_",
        maxScriptIdLength: 38,
        appliesToMap: {},
        canonicalAppliesToNames: [],
        unsupportedDefaultTags: new Set([
            "allowquickadd",
            "globalsearch",
            "isparent",
            "onparentdelete",
            "rolerestrict"
        ])
    },
    item_option: {
        category: "item_option",
        rootElement: "itemoptioncustomfield",
        prefix: "custcol_",
        maxScriptIdLength: 40,
        appliesToMap: ITEM_OPTION_APPLIES.map,
        canonicalAppliesToNames: ITEM_OPTION_APPLIES.canonicalNames,
        unsupportedDefaultTags: new Set([
            "allowquickadd",
            "checkspelling",
            "encryptatrest",
            "globalsearch",
            "isparent",
            "onparentdelete",
            "rolerestrict",
            "searchlevel",
            "showinlist"
        ]),
        requiredFeatures: ["ITEMOPTIONS"]
    },
    item_number: {
        category: "item_number",
        rootElement: "itemnumbercustomfield",
        prefix: "custitemnumber_",
        maxScriptIdLength: 38,
        appliesToMap: ITEM_NUMBER_APPLIES.map,
        canonicalAppliesToNames: ITEM_NUMBER_APPLIES.canonicalNames,
        unsupportedDefaultTags: new Set([
            "allowquickadd",
            "globalsearch",
            "isparent",
            "onparentdelete",
            "rolerestrict"
        ])
    }
};

const ALL_KNOWN_PREFIXES = [
    "custitemnumber_",
    "custsublist_",
    "custrecord_",
    "custentity_",
    "custevent_",
    "custbody_",
    "custitem_",
    "custcol_"
];

/**
 * Normalizes a custom field category string (supporting common aliases like 'transaction_column')
 */
export const normalizeCustomFieldCategory = (rawCategory: string): CustomFieldCategory => {
    const clean = (rawCategory || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
    const aliasMap: Record<string, CustomFieldCategory> = {
        transaction_body: "transaction_body",
        transactionbody: "transaction_body",
        transactionbodycustomfield: "transaction_body",
        body: "transaction_body",
        custbody: "transaction_body",

        transaction_line: "transaction_line",
        transaction_column: "transaction_line",
        transactionline: "transaction_line",
        transactioncolumn: "transaction_line",
        transactioncolumncustomfield: "transaction_line",
        line: "transaction_line",
        column: "transaction_line",
        custcol: "transaction_line",

        crm: "crm",
        crmcustomfield: "crm",
        custevent: "crm",

        item: "item",
        itemcustomfield: "item",
        custitem: "item",

        entity: "entity",
        entitycustomfield: "entity",
        custentity: "entity",

        other_record: "other_record",
        otherrecord: "other_record",
        other: "other_record",
        othercustomfield: "other_record",
        custrecord: "other_record",

        item_option: "item_option",
        itemoption: "item_option",
        itemoptioncustomfield: "item_option",
        transaction_item_option: "item_option",

        item_number: "item_number",
        itemnumber: "item_number",
        itemnumbercustomfield: "item_number",
        custitemnumber: "item_number"
    };

    const resolved = aliasMap[clean];
    if (!resolved) {
        throw new Error(
            `Invalid fieldCategory '${rawCategory}'. Must be one of: ${CUSTOM_FIELD_CATEGORIES.join(", ")}.`
        );
    }
    return resolved;
};

/**
 * Normalizes and validates a custom field scriptId for its category.
 * Auto-prepends the category's required prefix (e.g. 'custbody_') if omitted,
 * and rejects mismatched prefixes or scriptIds exceeding NetSuite's SDF limit.
 */
export const normalizeCustomFieldScriptId = (
    rawScriptId: string,
    category: CustomFieldCategory
): string => {
    const spec = CUSTOM_FIELD_CATEGORY_SPECS[category];
    let id = (rawScriptId || "").trim();
    if (!id) {
        throw new Error("'scriptId' is required for each custom field.");
    }

    if (id.toLowerCase().endsWith(".xml")) {
        id = id.slice(0, -".xml".length);
    }

    id = id.trim().toLowerCase();
    if (!id) {
        throw new Error("'scriptId' cannot be empty.");
    }

    if (!/^[a-z0-9_]+$/.test(id)) {
        throw new Error(
            `Invalid custom field scriptId '${id}'. Only lowercase letters, numbers, and underscores are allowed.`
        );
    }

    if (!id.startsWith(spec.prefix)) {
        const mismatchedPrefix = ALL_KNOWN_PREFIXES.find((p) => id.startsWith(p));
        if (mismatchedPrefix) {
            throw new Error(
                `ScriptId '${id}' starts with '${mismatchedPrefix}', which does not match category '${category}' (expected prefix '${spec.prefix}').`
            );
        }
        id = `${spec.prefix}${id.replace(/^_+/, "")}`;
    }

    if (id === spec.prefix) {
        throw new Error(`ScriptId '${id}' must include an identifier after prefix '${spec.prefix}'.`);
    }

    if (id.length > spec.maxScriptIdLength) {
        throw new Error(
            `Custom field scriptId '${id}' is ${id.length} characters long, exceeding the NetSuite SDF limit of ${spec.maxScriptIdLength} characters for '${spec.rootElement}'.`
        );
    }

    return id;
};

/**
 * Resolves an array of friendly or raw `appliesTo` strings into a map of SDF XML tags -> 'T'.
 */
export const resolveAppliesToTags = (
    category: CustomFieldCategory,
    appliesTo?: string[]
): Record<string, "T"> => {
    if (!appliesTo || appliesTo.length === 0) {
        return {};
    }

    const spec = CUSTOM_FIELD_CATEGORY_SPECS[category];
    if (category === "other_record") {
        throw new Error(
            `Category 'other_record' (<othercustomfield>) uses 'recordType' (e.g. 'account', 'department', 'location', 'subsidiary', 'class') instead of 'appliesTo'.`
        );
    }

    const resolvedTags: Record<string, "T"> = {};
    for (const rawTarget of appliesTo) {
        const target = (rawTarget || "").trim();
        if (!target) continue;

        const lower = target.toLowerCase();
        const compact = lower.replace(/[\s_-]+/g, "");
        const sdfTag = spec.appliesToMap[lower] ?? spec.appliesToMap[compact];

        if (!sdfTag) {
            throw new Error(
                `Invalid appliesTo target '${rawTarget}' for category '${category}' (<${spec.rootElement}>). Valid targets include: ${spec.canonicalAppliesToNames.join(", ")}.`
            );
        }
        resolvedTags[sdfTag] = "T";
    }

    return resolvedTags;
};

/**
 * Formats a subtab reference: if a custom subtab (`custtab_*`) is passed without `[scriptid=...]`,
 * wraps it in `[scriptid=custtab_*]`. Standard subtab constants (e.g. `ENTITYMAIN`, `TRANSACTIONMAIN`) are uppercased.
 */
export const formatSubtabReference = (rawSubtab: string): string => {
    const trimmed = rawSubtab.trim();
    if (!trimmed) return "";

    if (/^\[scriptid=.+\]$/i.test(trimmed)) {
        return trimmed;
    }

    if (trimmed.toLowerCase().startsWith("custtab_")) {
        return `[scriptid=${trimmed.toLowerCase()}]`;
    }

    return trimmed.toUpperCase();
};

const setNodeTextPreservingAttrs = (existingNode: any, newText: string | null): any => {
    if (newText === null) {
        return null;
    }
    if (existingNode && typeof existingNode === "object" && !Array.isArray(existingNode)) {
        return {
            ...existingNode,
            "#": newText
        };
    }
    return newText;
};

/**
 * Extracts all custom object dependencies (`customrecord_*`, `customlist_*`, `custtab_*`, etc.)
 * from a parsed or constructed custom field SDF object.
 */
export const collectFieldObjectDependencies = (fieldRootObj: Record<string, any>): string[] => {
    const deps = new Set<string>();

    const checkRef = (val: any) => {
        if (!val) return;
        const text =
            typeof val === "string"
                ? val
                : typeof val === "object" && typeof val["#"] === "string"
                ? val["#"]
                : "";
        const dep = extractCustomObjectDependency(text);
        if (dep) {
            deps.add(dep);
        }
    };

    checkRef(fieldRootObj.selectrecordtype);
    checkRef(fieldRootObj.rectype);
    checkRef(fieldRootObj.subtab);
    checkRef(fieldRootObj.parentsubtab);

    return Array.from(deps);
};

/**
 * Builds or updates the XML content and dependencies for a standalone custom field.
 */
export const buildOrMergeCustomFieldXml = async (args: {
    input: UpsertCustomFieldInput;
    existingXmlContent?: string | null;
}): Promise<{
    scriptId: string;
    rootElement: string;
    xmlContent: string;
    isUpdate: boolean;
    dependencies: string[];
    features: string[];
    appliedTargets: string[];
}> => {
    const { input, existingXmlContent } = args;
    const category = normalizeCustomFieldCategory(input.fieldCategory);
    const spec = CUSTOM_FIELD_CATEGORY_SPECS[category];
    const scriptId = normalizeCustomFieldScriptId(input.scriptId, category);
    const requiredFeatures = spec.requiredFeatures ? [...spec.requiredFeatures] : [];

    if (input.label !== undefined && input.label.trim().length > 40) {
        throw new Error(
            `Custom field '${scriptId}' label '${input.label.trim()}' is ${input.label.trim().length} characters long, exceeding the NetSuite SDF limit of 40 characters.`
        );
    }

    if (
        (input.type === "SELECT" || input.type === "MULTISELECT") &&
        !existingXmlContent &&
        (!input.selectRecordType || !input.selectRecordType.trim())
    ) {
        throw new Error(
            `'selectRecordType' is required for field '${scriptId}' when 'type' is '${input.type}'.`
        );
    }

    const normalizedDisplayType =
        input.displayType !== undefined ? normalizeDisplayType(input.displayType) : undefined;

    const appliesToTags = resolveAppliesToTags(category, input.appliesTo);
    const appliedTargets = Object.keys(appliesToTags);

    // 1. UPDATE PATH: Merge into downloaded XML
    if (existingXmlContent) {
        const parsed = create(existingXmlContent).toObject() as Record<string, any>;
        const existingRootKey = Object.keys(parsed).find((k) => !k.startsWith("?") && !k.startsWith("@"));

        if (!existingRootKey || !parsed[existingRootKey] || typeof parsed[existingRootKey] !== "object") {
            throw new Error(`Could not parse existing SDF XML for custom field '${scriptId}'.`);
        }

        if (existingRootKey !== spec.rootElement) {
            throw new Error(
                `Existing custom field '${scriptId}' in NetSuite has root element '<${existingRootKey}>', which does not match requested category '${category}' ('<${spec.rootElement}>').`
            );
        }

        const rootObj = parsed[spec.rootElement];

        if (input.label !== undefined && input.label.trim() !== "") {
            rootObj.label = setNodeTextPreservingAttrs(rootObj.label, input.label.trim());
        }
        if (input.type !== undefined) {
            rootObj.fieldtype = setNodeTextPreservingAttrs(rootObj.fieldtype, input.type);
        }
        if (input.selectRecordType !== undefined && input.selectRecordType.trim() !== "") {
            rootObj.selectrecordtype = setNodeTextPreservingAttrs(
                rootObj.selectrecordtype,
                getSelectRecordType(input.selectRecordType)
            );
        }
        if (input.description !== undefined) {
            rootObj.description = setNodeTextPreservingAttrs(rootObj.description, input.description);
        }
        if (input.helpText !== undefined) {
            rootObj.help = setNodeTextPreservingAttrs(rootObj.help, input.helpText);
        }
        if (input.isMandatory !== undefined) {
            rootObj.ismandatory = setNodeTextPreservingAttrs(
                rootObj.ismandatory,
                input.isMandatory ? "T" : "F"
            );
        }
        if (input.storeValue !== undefined) {
            rootObj.storevalue = setNodeTextPreservingAttrs(
                rootObj.storevalue,
                input.storeValue ? "T" : "F"
            );
        }
        if (input.showInList !== undefined && !spec.unsupportedDefaultTags.has("showinlist")) {
            rootObj.showinlist = setNodeTextPreservingAttrs(
                rootObj.showinlist,
                input.showInList ? "T" : "F"
            );
        }
        if (input.globalSearch !== undefined && !spec.unsupportedDefaultTags.has("globalsearch")) {
            rootObj.globalsearch = setNodeTextPreservingAttrs(
                rootObj.globalsearch,
                input.globalSearch ? "T" : "F"
            );
        }
        if (normalizedDisplayType !== undefined) {
            rootObj.displaytype = setNodeTextPreservingAttrs(rootObj.displaytype, normalizedDisplayType);
        }
        if (input.defaultValue !== undefined) {
            rootObj.defaultvalue = setNodeTextPreservingAttrs(rootObj.defaultvalue, input.defaultValue);
        }
        if (input.defaultChecked !== undefined) {
            rootObj.defaultchecked = setNodeTextPreservingAttrs(
                rootObj.defaultchecked,
                input.defaultChecked ? "T" : "F"
            );
        }
        if (input.dynamicDefault !== undefined) {
            rootObj.dynamicdefault = setNodeTextPreservingAttrs(
                rootObj.dynamicdefault,
                input.dynamicDefault
            );
        }
        if (input.isFormula !== undefined) {
            rootObj.isformula = setNodeTextPreservingAttrs(
                rootObj.isformula,
                input.isFormula ? "T" : "F"
            );
        }
        if (input.subtab !== undefined && input.subtab.trim() !== "") {
            rootObj.subtab = setNodeTextPreservingAttrs(
                rootObj.subtab,
                formatSubtabReference(input.subtab)
            );
        }
        if (input.isParent !== undefined && !spec.unsupportedDefaultTags.has("isparent")) {
            rootObj.isparent = setNodeTextPreservingAttrs(
                rootObj.isparent,
                input.isParent ? "T" : "F"
            );
        }
        if (input.parentSubtab !== undefined && input.parentSubtab.trim() !== "" && !spec.unsupportedDefaultTags.has("isparent")) {
            rootObj.parentsubtab = setNodeTextPreservingAttrs(
                rootObj.parentsubtab,
                formatSubtabReference(input.parentSubtab)
            );
        }
        if (category === "item" && input.itemSubType !== undefined) {
            rootObj.itemsubtype = setNodeTextPreservingAttrs(rootObj.itemsubtype, input.itemSubType);
        }
        if (category === "other_record" && input.recordType !== undefined && input.recordType.trim() !== "") {
            rootObj.rectype = setNodeTextPreservingAttrs(
                rootObj.rectype,
                getSelectRecordType(input.recordType)
            );
        }
        if ((category === "item_option" || category === "item_number") && input.items && input.items.length > 0) {
            rootObj.items = input.items.join("|");
        }

        for (const [tag, val] of Object.entries(appliesToTags)) {
            rootObj[tag] = setNodeTextPreservingAttrs(rootObj[tag], val);
        }

        const updatedXml = create({ version: "1.0", encoding: "UTF-8" }, parsed).end({
            prettyPrint: true
        });
        const dependencies = collectFieldObjectDependencies(rootObj);

        return {
            scriptId,
            rootElement: spec.rootElement,
            xmlContent: updatedXml,
            isUpdate: true,
            dependencies,
            features: requiredFeatures,
            appliedTargets
        };
    }

    // 2. CREATE PATH: Validate required creation fields and apply defaults
    if (!input.label || !input.label.trim()) {
        throw new Error(
            `'label' is required when creating a new custom field ('${scriptId}' does not exist in NetSuite yet).`
        );
    }

    const fieldType: CustomFieldType = input.type ?? "TEXT";
    if (
        (fieldType === "SELECT" || fieldType === "MULTISELECT") &&
        (!input.selectRecordType || !input.selectRecordType.trim())
    ) {
        throw new Error(
            `'selectRecordType' is required when creating field '${scriptId}' with type '${fieldType}'.`
        );
    }

    if (category === "other_record" && (!input.recordType || !input.recordType.trim())) {
        throw new Error(
            `'recordType' is required when creating an 'other_record' custom field ('${scriptId}'). Example values: 'account', 'department', 'location', 'subsidiary', 'class'.`
        );
    }

    const baseFieldObj: Record<string, any> = {
        fieldtype: fieldType,
        label: input.label.trim(),
        description: input.description ?? "",
        help: input.helpText ?? ""
    };

    if ((fieldType === "SELECT" || fieldType === "MULTISELECT") && input.selectRecordType) {
        baseFieldObj.selectrecordtype = getSelectRecordType(input.selectRecordType);
    }

    if (input.isMandatory !== undefined) {
        baseFieldObj.ismandatory = input.isMandatory ? "T" : "F";
    }
    if (input.storeValue !== undefined) {
        baseFieldObj.storevalue = input.storeValue ? "T" : "F";
    }
    if (input.showInList !== undefined) {
        baseFieldObj.showinlist = input.showInList ? "T" : "F";
    }
    if (input.globalSearch !== undefined) {
        baseFieldObj.globalsearch = input.globalSearch ? "T" : "F";
    }
    if (normalizedDisplayType !== undefined) {
        baseFieldObj.displaytype = normalizedDisplayType;
    }
    if (input.defaultValue !== undefined) {
        baseFieldObj.defaultvalue = input.defaultValue;
    }
    if (input.defaultChecked !== undefined) {
        baseFieldObj.defaultchecked = input.defaultChecked ? "T" : "F";
    }
    if (input.dynamicDefault !== undefined) {
        baseFieldObj.dynamicdefault = input.dynamicDefault;
    }
    if (input.isFormula !== undefined) {
        baseFieldObj.isformula = input.isFormula ? "T" : "F";
    }
    if (input.subtab !== undefined && input.subtab.trim() !== "") {
        baseFieldObj.subtab = formatSubtabReference(input.subtab);
    }
    if (input.isParent !== undefined && !spec.unsupportedDefaultTags.has("isparent")) {
        baseFieldObj.isparent = input.isParent ? "T" : "F";
    }
    if (input.parentSubtab !== undefined && input.parentSubtab.trim() !== "" && !spec.unsupportedDefaultTags.has("isparent")) {
        baseFieldObj.parentsubtab = formatSubtabReference(input.parentSubtab);
    }
    if (category === "item" && input.itemSubType !== undefined) {
        baseFieldObj.itemsubtype = input.itemSubType;
    }
    if (category === "other_record" && input.recordType) {
        baseFieldObj.rectype = getSelectRecordType(input.recordType);
    }
    if ((category === "item_option" || category === "item_number") && input.items && input.items.length > 0) {
        baseFieldObj.items = input.items.join("|");
    }

    const withDefaults = await applyDefaults(baseFieldObj, ObjectDefaultType.FIELD);

    // Ensure displaytype from user/project defaults is also normalized to valid SDF enum values
    if (typeof withDefaults.displaytype === "string") {
        withDefaults.displaytype = normalizeDisplayType(withDefaults.displaytype);
    }

    // Filter out default tags that are not supported on this specific field root element
    const cleanedData: Record<string, any> = {};
    for (const [key, val] of Object.entries(withDefaults)) {
        if (spec.unsupportedDefaultTags.has(key)) {
            continue;
        }
        cleanedData[key] = val;
    }

    for (const [tag, val] of Object.entries(appliesToTags)) {
        cleanedData[tag] = val;
    }

    const xmlObject = {
        [spec.rootElement]: {
            "@scriptid": scriptId,
            ...cleanedData
        }
    };

    const createdXml = create({ version: "1.0", encoding: "UTF-8" }, xmlObject).end({
        prettyPrint: true
    });
    const dependencies = collectFieldObjectDependencies(cleanedData);

    return {
        scriptId,
        rootElement: spec.rootElement,
        xmlContent: createdXml,
        isUpdate: false,
        dependencies,
        features: requiredFeatures,
        appliedTargets
    };
};
