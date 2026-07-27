import { applyDefaults } from "../defaults/index.js";
import { ObjectDefaultType } from "../defaults/types.js";
import { ManifestDependencies } from "./deploy.js";

export type CustomRecordField = {
    scriptId: string;
    label: string;
    type: "CHECKBOX" | "CLOBTEXT" | "CURRENCY" | "DATE" | "DATETIMETZ" | "DOCUMENT" | "EMAIL" | "FLOAT" | "HELP" | "IMAGE" | "INLINEHTML" | "INTEGER" | "MULTISELECT" | "PASSWORD" | "PERCENT" | "PHONE" | "RICHTEXT" | "SELECT" | "TEXT" | "TEXTAREA" | "TIMEOFDAY" | "URL";
    selectRecordType?: string;
    helpText?: string;
}

//if a standard record type is being used, we much use the Id
//These are internal to Netsuite and should never change.
export const standardRecordSdfIds: Record<string, number> = {
    'account': -112,
    'accountingperiod': -105,
    'bin': -242,
    'phonecall': -22,
    'campaign': -24,
    'supportcase': -23,
    'class': -101,
    'competitor': -108,
    'contact': -6,
    'customer': -2,
    'customercategory': -109,
    'department': -102,
    'emailtemplate': -120,
    'employee': -4,
    'employeetype': -111,
    'entitystatus': -104,
    'calendarevent': -20,
    'issue': -26,
    'item': -10,
    'itemtype': -106,
    'job': -7,
    'location': -103,
    'module': -116,
    'opportunity': -31,
    'partner': -5,
    'product': -115,
    'productbuild': -114,
    'productversion': -113,
    'role': -118,
    'savedsearch': -119,
    'subsidiary': -117,
    'task': -21,
    'transaction': -30,
    'transactiontype': -100,
    'vendor': -3,
    'vendorcategory': -110
};

/**
 * Formats the select record type properly
 * If the type is a custom list or custom record it should be in the form:
 * [scriptid=customrecord_example]
 * If it is a native type, it should use the internal ID
 */
export const getSelectRecordType = (passedInType: string) => {
    if (passedInType.startsWith('customrecord') || passedInType.startsWith('customlist')) {
        return `[scriptid=${passedInType}]`;
    }

    const standardRecord = standardRecordSdfIds[passedInType.toLowerCase()];

    if (!standardRecord) {
        throw new Error(`Invalid standard record type: ${passedInType}`);
    }

    return standardRecord.toString();
}

/**
 * Create the manifest dependency requirements from the passed in fields.  Any custom fields will be added to the dependencies.
 */
export const getManifestDependenciesFromFields = (fields: CustomRecordField[]): ManifestDependencies | undefined => {

    const referencedCustomRecords = fields?.filter((f) => {
        if (f.type !== 'SELECT' || !f.selectRecordType) {
            return false;
        }

        if (f.selectRecordType.startsWith('customrecord')) {
            return true;
        }
    }).map((m) => m.selectRecordType as string) ?? []

    return referencedCustomRecords.length > 0 ? {
        objects: referencedCustomRecords
    } : undefined;
}

/**
 * Maps custom fields from standard representation to XML object structures
 */
export const mapCustomRecordFields = async (fields: CustomRecordField[]) => {
    return await Promise.all(fields.map(async (field) => {
        const fieldObj: any = {
            "@scriptid": field.scriptId,
            fieldtype: field.type,
            label: field.label,
        };

        if (field.helpText) fieldObj.help = field.helpText;
        if (field.type === 'SELECT' && field.selectRecordType) {
            const selectRecordType = getSelectRecordType(field.selectRecordType);
            fieldObj.selectrecordtype = selectRecordType;
        }

        return applyDefaults(fieldObj, ObjectDefaultType.FIELD);
    }));
}
