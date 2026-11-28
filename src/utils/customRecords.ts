import { applyDefaults } from "../defaults/index.js";
import { ObjectDefaultType } from "../defaults/types.js";
import { ManifestDependencies } from "./deploy.js";
import {
    CustomFieldDisplayTypeInput,
    formatSubtabReference,
    normalizeDisplayType
} from "./customFields.js";

export type CustomFieldType =
    | "CHECKBOX"
    | "CLOBTEXT"
    | "CURRENCY"
    | "DATE"
    | "DATETIMETZ"
    | "DOCUMENT"
    | "EMAIL"
    | "FLOAT"
    | "HELP"
    | "IMAGE"
    | "INLINEHTML"
    | "INTEGER"
    | "MULTISELECT"
    | "PASSWORD"
    | "PERCENT"
    | "PHONE"
    | "RICHTEXT"
    | "SELECT"
    | "TEXT"
    | "TEXTAREA"
    | "TIMEOFDAY"
    | "URL";

export const CUSTOM_FIELD_TYPES: CustomFieldType[] = [
    "CHECKBOX",
    "CLOBTEXT",
    "CURRENCY",
    "DATE",
    "DATETIMETZ",
    "DOCUMENT",
    "EMAIL",
    "FLOAT",
    "HELP",
    "IMAGE",
    "INLINEHTML",
    "INTEGER",
    "MULTISELECT",
    "PASSWORD",
    "PERCENT",
    "PHONE",
    "RICHTEXT",
    "SELECT",
    "TEXT",
    "TEXTAREA",
    "TIMEOFDAY",
    "URL"
];

export type CustomRecordOnParentDelete = "SET_NULL" | "STOP_DELETE" | "DELETE_THIS_CHILD";

export type CustomRecordAccessType = "CUSTRECORDENTRYPERM" | "NONENEEDED" | "USEPERMISSIONLIST";

export type CustomRecordField = {
    scriptId: string;
    label: string;
    type: CustomFieldType;
    selectRecordType?: string;
    description: string;
    helpText: string;
    isMandatory?: boolean;
    storeValue?: boolean;
    showInList?: boolean;
    globalSearch?: boolean;
    displayType?: CustomFieldDisplayTypeInput;
    defaultValue?: string;
    defaultChecked?: boolean;
    dynamicDefault?: string;
    isFormula?: boolean;
    isParent?: boolean;
    parentSubtab?: string;
    onParentDelete?: CustomRecordOnParentDelete;
    subtab?: string;
};

// If a standard record type is being used, we must use the internal negative NetSuite ID.
// These are internal to NetSuite and should never change.
export const standardRecordSdfIds: Record<string, number> = {
    'account': -112,
    'accountingperiod': -105,
    'address': -289,
    'billingaccount': -333,
    'billingclass': -139,
    'billingratecard': -338,
    'billingschedule': -141,
    'bin': -242,
    'bom': -420,
    'bomrevision': -421,
    'phonecall': -22,
    'campaign': -24,
    'campaigncategory': -144,
    'campaignaudience': -142,
    'campaignchannel': -145,
    'campaignfamily': -147,
    'campaignoffer': -148,
    'campaignsearch': -150,
    'campaignsubscription': -151,
    'campaignvertical': -152,
    'supportcase': -23,
    'case': -23,
    'class': -101,
    'classification': -101,
    'competitor': -108,
    'contact': -6,
    'contactcategory': -158,
    'contactrole': -157,
    'costcategory': -155,
    'couponcode': -162,
    'currency': -122,
    'customer': -2,
    'customercategory': -109,
    'customerMessage': -163,
    'customermessage': -163,
    'department': -102,
    'emailtemplate': -120,
    'employee': -4,
    'employeetype': -111,
    'entity': -9,
    'entitygroup': -8,
    'entitystatus': -104,
    'calendarevent': -20,
    'event': -20,
    'expensecategory': -127,
    'fairvalueprice': -332,
    'genericresource': -305,
    'globalaccountmapping': -253,
    'inboundshipment': -402,
    'inventorynumber': -260,
    'issue': -26,
    'item': -10,
    'itemaccountmapping': -254,
    'itemCollection': -442,
    'itemcollection': -442,
    'itemdemandplan': -247,
    'itemlocationconfiguration': -508,
    'itemrevision': -266,
    'itemsupplyplan': -248,
    'itemtype': -106,
    'job': -7,
    'project': -7,
    'jobtype': -177,
    'projecttype': -177,
    'location': -103,
    'manufacturingcosttemplate': -294,
    'manufacturingoperationtask': -28,
    'manufacturingrouting': -293,
    'merchandisehierarchynode': -405,
    'module': -116,
    'nexus': -225,
    'note': -33,
    'notetype': -180,
    'opportunity': -31,
    'othernamecategory': -181,
    'partner': -5,
    'partnercategory': -182,
    'paymentmethod': -183,
    'payrollitem': -131,
    'pricebook': -369,
    'pricelevel': -186,
    'priceplan': -368,
    'pricinggroup': -187,
    'product': -115,
    'productbuild': -114,
    'productversion': -113,
    'projecttask': -27,
    'promotioncode': -121,
    'resourceallocation': -29,
    'revrecschedule': -132,
    'revrectemplate': -282,
    'role': -118,
    'salesrole': -188,
    'salestaxitem': -128,
    'savedsearch': -119,
    'shipitem': -192,
    'shipmethod': -192,
    'solution': -25,
    'subsidiary': -117,
    'subscription': -365,
    'subscriptionline': -366,
    'subscriptionplan': -367,
    'SubscriptionTerm': -383,
    'subscriptionterm': -383,
    'task': -21,
    'taxacct': -189,
    'taxgroup': -135,
    'taxperiod': -223,
    'taxschedule': -221,
    'taxtype': -190,
    'term': -199,
    'timebill': -257,
    'timeentry': -246,
    'timesheet': -281,
    'topic': -34,
    'transaction': -30,
    'transactiontype': -100,
    'unitstype': -201,
    'usage': -371,
    'vendor': -3,
    'vendorcategory': -110,
    'winlossreason': -203,
    'workplace': -245
};

/**
 * Normalizes and validates a Custom Record Type scriptId (`customrecord_*`).
 */
export const normalizeCustomRecordScriptId = (rawScriptId: string): string => {
    let id = (rawScriptId || "").trim();
    if (!id) {
        throw new Error("'scriptId' is required.");
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
            `Invalid custom record scriptId '${id}'. Only lowercase letters, numbers, and underscores are allowed.`
        );
    }

    if (!id.startsWith("customrecord_")) {
        id = `customrecord_${id.replace(/^_+/, "")}`;
    }

    if (id === "customrecord_") {
        throw new Error(`ScriptId '${id}' must include an identifier after prefix 'customrecord_'.`);
    }

    if (id.length > 38) {
        throw new Error(
            `Custom Record scriptId '${id}' is ${id.length} characters long, exceeding the NetSuite SDF limit of 38 characters.`
        );
    }

    return id;
};

/**
 * Normalizes and validates a Custom Record Field scriptId (`custrecord_*`).
 */
export const normalizeCustomRecordFieldScriptId = (rawScriptId: string): string => {
    let id = (rawScriptId || "").trim();
    if (!id) {
        throw new Error("Field 'scriptId' is required.");
    }

    if (id.toLowerCase().endsWith(".xml")) {
        id = id.slice(0, -".xml".length);
    }

    id = id.trim().toLowerCase();
    if (!id) {
        throw new Error("Field 'scriptId' cannot be empty.");
    }

    if (!/^[a-z0-9_]+$/.test(id)) {
        throw new Error(
            `Invalid custom record field scriptId '${id}'. Only lowercase letters, numbers, and underscores are allowed.`
        );
    }

    if (!id.startsWith("custrecord_")) {
        id = `custrecord_${id.replace(/^_+/, "")}`;
    }

    if (id === "custrecord_") {
        throw new Error(`Field scriptId '${id}' must include an identifier after prefix 'custrecord_'.`);
    }

    if (id.length > 38) {
        throw new Error(
            `Custom record field scriptId '${id}' is ${id.length} characters long, exceeding the NetSuite SDF limit of 38 characters.`
        );
    }

    return id;
};

/**
 * Formats the select record type (or rectype) properly.
 * If the type is a custom list or custom record it should be in the form:
 * [scriptid=customrecord_example] or [scriptid=customlist_example]
 * If it is already formatted as [scriptid=...] or a negative integer string, it is preserved.
 * If it is a native type name, it resolves to its internal negative ID.
 */
export const getSelectRecordType = (passedInType: string): string => {
    const trimmed = passedInType.trim();
    if (!trimmed) {
        throw new Error("Record type cannot be empty.");
    }

    if (/^\[scriptid=.+\]$/i.test(trimmed)) {
        return trimmed;
    }

    if (/^-?\d+$/.test(trimmed)) {
        return trimmed;
    }

    const lower = trimmed.toLowerCase();
    if (lower.startsWith('customrecord') || lower.startsWith('customlist')) {
        return `[scriptid=${lower}]`;
    }

    const normalizedKey = lower.replace(/[\s_-]+/g, "");
    const standardRecord = standardRecordSdfIds[lower] ?? standardRecordSdfIds[normalizedKey];

    if (!standardRecord) {
        throw new Error(
            `Invalid standard record type: '${passedInType}'. Provide a custom record/list scriptId (customrecord_* / customlist_*), a known standard record name (e.g. 'customer', 'vendor', 'item', 'transaction', 'account', 'department', 'location', 'subsidiary', 'class', 'employee'), or a numeric NetSuite record type ID (e.g. '-112').`
        );
    }

    return standardRecord.toString();
};

/**
 * Extracts a custom object scriptId (e.g. customrecord_*, customlist_*, custtab_*)
 * from a raw string or a `[scriptid=...]` reference if applicable.
 */
export const extractCustomObjectDependency = (refValue?: string): string | null => {
    if (!refValue || typeof refValue !== "string") {
        return null;
    }
    const trimmed = refValue.trim();
    const match = trimmed.match(/^\[scriptid=([^\]]+)\]$/i);
    const candidate = (match ? match[1] : trimmed).trim().toLowerCase();

    if (
        candidate.startsWith("customrecord_") ||
        candidate.startsWith("customlist_") ||
        candidate.startsWith("custtab_") ||
        candidate.startsWith("customsegment_") ||
        candidate.startsWith("customtransaction_")
    ) {
        return candidate;
    }
    return null;
};

/**
 * Create the manifest dependency requirements from the passed in fields. Any referenced custom records/lists/subtabs will be added to the dependencies.
 */
export const getManifestDependenciesFromFields = (
    fields: CustomRecordField[],
    selfRecordScriptId?: string
): ManifestDependencies | undefined => {
    const deps = new Set<string>();
    const selfLower = selfRecordScriptId ? selfRecordScriptId.toLowerCase() : "";

    const addIfDep = (ref?: string) => {
        const dep = extractCustomObjectDependency(ref);
        if (dep && dep !== selfLower) {
            deps.add(dep);
        }
    };

    for (const f of fields ?? []) {
        if ((f.type === 'SELECT' || f.type === 'MULTISELECT') && f.selectRecordType) {
            addIfDep(f.selectRecordType);
        }
        if (f.subtab) {
            addIfDep(f.subtab);
        }
        if (f.parentSubtab) {
            addIfDep(f.parentSubtab);
        }
    }

    return deps.size > 0
        ? {
              objects: Array.from(deps)
          }
        : undefined;
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

const applyOptionalFieldProperties = (
    targetObj: Record<string, any>,
    field: CustomRecordField,
    preserveAttrs: boolean
) => {
    const setVal = (key: string, val: string) => {
        targetObj[key] = preserveAttrs ? setNodeTextPreservingAttrs(targetObj[key], val) : val;
    };

    if ((field.type === "SELECT" || field.type === "MULTISELECT") && field.selectRecordType) {
        setVal("selectrecordtype", getSelectRecordType(field.selectRecordType));
    }
    if (field.isMandatory !== undefined) {
        setVal("ismandatory", field.isMandatory ? "T" : "F");
    }
    if (field.storeValue !== undefined) {
        setVal("storevalue", field.storeValue ? "T" : "F");
    }
    if (field.showInList !== undefined) {
        setVal("showinlist", field.showInList ? "T" : "F");
    }
    if (field.globalSearch !== undefined) {
        setVal("globalsearch", field.globalSearch ? "T" : "F");
    }
    if (field.displayType !== undefined) {
        setVal("displaytype", normalizeDisplayType(field.displayType));
    }
    if (field.defaultValue !== undefined) {
        setVal("defaultvalue", field.defaultValue);
    }
    if (field.defaultChecked !== undefined) {
        setVal("defaultchecked", field.defaultChecked ? "T" : "F");
    }
    if (field.dynamicDefault !== undefined) {
        setVal("dynamicdefault", field.dynamicDefault);
    }
    if (field.isFormula !== undefined) {
        setVal("isformula", field.isFormula ? "T" : "F");
    }
    if (field.isParent !== undefined) {
        setVal("isparent", field.isParent ? "T" : "F");
    }
    if (field.parentSubtab !== undefined && field.parentSubtab.trim() !== "") {
        setVal("parentsubtab", formatSubtabReference(field.parentSubtab));
    }
    if (field.onParentDelete !== undefined) {
        setVal("onparentdelete", field.onParentDelete);
    }
    if (field.subtab !== undefined && field.subtab.trim() !== "") {
        setVal("subtab", formatSubtabReference(field.subtab));
    }
};

/**
 * Validates and builds a new `<customrecordcustomfield>` SDF object with field defaults applied.
 */
export const buildNewCustomRecordFieldObject = async (field: CustomRecordField): Promise<Record<string, any>> => {
    const normalizedScriptId = normalizeCustomRecordFieldScriptId(field.scriptId);

    if (!field.label || !field.label.trim()) {
        throw new Error(`'label' is required for custom record field '${normalizedScriptId}'.`);
    }
    if (field.label.trim().length > 40) {
        throw new Error(
            `Custom record field '${normalizedScriptId}' label '${field.label.trim()}' is ${field.label.trim().length} characters long, exceeding the NetSuite SDF limit of 40 characters.`
        );
    }
    if (
        (field.type === "SELECT" || field.type === "MULTISELECT") &&
        (!field.selectRecordType || !field.selectRecordType.trim())
    ) {
        throw new Error(
            `'selectRecordType' is required for field '${normalizedScriptId}' when 'type' is '${field.type}'.`
        );
    }

    const fieldObj: Record<string, any> = {
        "@scriptid": normalizedScriptId,
        fieldtype: field.type,
        label: field.label.trim(),
        description: field.description,
        help: field.helpText
    };

    applyOptionalFieldProperties(fieldObj, field, false);

    const withDefaults = await applyDefaults(fieldObj, ObjectDefaultType.FIELD);
    if (typeof withDefaults.displaytype === "string") {
        withDefaults.displaytype = normalizeDisplayType(withDefaults.displaytype);
    }

    return withDefaults;
};

/**
 * Merges an incoming CustomRecordField definition into an existing parsed `<customrecordcustomfield>` XML node.
 */
export const mergeExistingCustomRecordFieldObject = (
    existingFieldObj: Record<string, any>,
    field: CustomRecordField
): Record<string, any> => {
    const normalizedScriptId = normalizeCustomRecordFieldScriptId(field.scriptId);

    if (field.label !== undefined) {
        if (!field.label.trim()) {
            throw new Error(`'label' cannot be empty for custom record field '${normalizedScriptId}'.`);
        }
        if (field.label.trim().length > 40) {
            throw new Error(
                `Custom record field '${normalizedScriptId}' label '${field.label.trim()}' is ${field.label.trim().length} characters long, exceeding the NetSuite SDF limit of 40 characters.`
            );
        }
        existingFieldObj.label = setNodeTextPreservingAttrs(existingFieldObj.label, field.label.trim());
    }

    if (field.type !== undefined) {
        existingFieldObj.fieldtype = setNodeTextPreservingAttrs(existingFieldObj.fieldtype, field.type);
    }

    if (field.description !== undefined) {
        existingFieldObj.description = setNodeTextPreservingAttrs(existingFieldObj.description, field.description);
    }

    if (field.helpText !== undefined) {
        existingFieldObj.help = setNodeTextPreservingAttrs(existingFieldObj.help, field.helpText);
    }

    applyOptionalFieldProperties(existingFieldObj, field, true);

    return existingFieldObj;
};

/**
 * Maps custom fields from standard representation to XML object structures
 */
export const mapCustomRecordFields = async (fields: CustomRecordField[]) => {
    return await Promise.all(fields.map((field) => buildNewCustomRecordFieldObject(field)));
};
