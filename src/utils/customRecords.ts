import { applyDefaults } from "../defaults/index.js";
import { ObjectDefaultType } from "../defaults/types.js";
import { ManifestDependencies } from "./deploy.js";

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

export type CustomRecordField = {
    scriptId: string;
    label: string;
    type: CustomFieldType;
    selectRecordType?: string;
    description: string;
    helpText: string;
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
 * Create the manifest dependency requirements from the passed in fields. Any referenced custom records/lists will be added to the dependencies.
 */
export const getManifestDependenciesFromFields = (fields: CustomRecordField[]): ManifestDependencies | undefined => {
    const deps = new Set<string>();
    for (const f of fields ?? []) {
        if ((f.type === 'SELECT' || f.type === 'MULTISELECT') && f.selectRecordType) {
            const dep = extractCustomObjectDependency(f.selectRecordType);
            if (dep) {
                deps.add(dep);
            }
        }
    }

    return deps.size > 0
        ? {
              objects: Array.from(deps)
          }
        : undefined;
};

/**
 * Maps custom fields from standard representation to XML object structures
 */
export const mapCustomRecordFields = async (fields: CustomRecordField[]) => {
    return await Promise.all(fields.map(async (field) => {
        const fieldObj: any = {
            "@scriptid": field.scriptId,
            fieldtype: field.type,
            label: field.label,
            description: field.description,
            help: field.helpText,
        };

        if ((field.type === 'SELECT' || field.type === 'MULTISELECT') && field.selectRecordType) {
            const selectRecordType = getSelectRecordType(field.selectRecordType);
            fieldObj.selectrecordtype = selectRecordType;
        }

        return applyDefaults(fieldObj, ObjectDefaultType.FIELD);
    }));
};
