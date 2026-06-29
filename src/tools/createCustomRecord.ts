import { ToolDefinition } from "../types/index.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { generateAndDeploySdf } from "../utils/objects.js";
import { ManifestDependencies } from "../utils/deploy.js";
import { applyDefaults } from "../defaults/index.js";
import { ObjectDefaultType } from "../defaults/types.js";

type RecordCreateField = {
    scriptId: string;
    label: string;
    type: "CHECKBOX" | "CLOBTEXT" | "CURRENCY" | "DATE" | "DATETIMETZ" | "DOCUMENT" | "EMAIL" | "FLOAT" | "HELP" | "IMAGE" | "INLINEHTML" | "INTEGER" | "MULTISELECT" | "PASSWORD" | "PERCENT" | "PHONE" | "RICHTEXT" | "SELECT" | "TEXT" | "TEXTAREA" | "TIMEOFDAY" | "URL";
    selectRecordType?: string;
    helpText?: string;
}

type RecordCreateCustomRecord = {
    scriptId: string;
    name: string;
    includeNameField: boolean;
    fields: RecordCreateField[];
}

//if a standard record type is being used, we much use the Id
//These are internal to Netsuite and should never change.
const standardRecordSdfIds: Record<string, number> = {
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
const getSelectRecordType = (passedInType: string) => {
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
const getManifestDependenciesFromFields = (fields: RecordCreateField[]): ManifestDependencies | undefined => {

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

export const createCustomRecordTool: ToolDefinition = {
    name: "netsuite_create_custom_record",
    description: "Creates and deploys a new Custom Record Type in NetSuite via SDF.",
    inputSchema: {
        type: "object",
        properties: {
            scriptId: {
                type: "string",
                description: "The internal ID of the custom record. Must start with 'customrecord_'."
            },
            name: {
                type: "string",
                description: "The name/label of the custom record."
            },
            includeNameField: {
                type: "boolean",
                description: "Indicate if the native name field should be included"
            },
            fields: {
                type: "array",
                description: "An array of custom fields to add to the record.",
                items: {
                    type: "object",
                    properties: {
                        scriptId: { type: "string", description: "Internal ID of the field. Must start with 'custrecord_'." },
                        label: { type: "string", description: "The label displayed in the UI for this field." },
                        type: { type: "string", description: "Field type (e.g., 'TEXT', 'INTEGER', 'SELECT', 'DATE', 'CHECKBOX', 'CURRENCY')", enum: ["CHECKBOX", "CLOBTEXT", "CURRENCY", "DATE", "DATETIMETZ", "DOCUMENT", "EMAIL", "FLOAT", "HELP", "IMAGE", "INLINEHTML", "INTEGER", "MULTISELECT", "PASSWORD", "PERCENT", "PHONE", "RICHTEXT", "SELECT", "TEXT", "TEXTAREA", "TIMEOFDAY", "URL"] },
                        selectRecordType: { type: "string", description: "Required ONLY if type is SELECT or MULTISELECT. The scriptId of the record or list it references." },
                        helpText: { type: "string", description: "Optional help text for the field." }
                    },
                    required: ["scriptId", "label", "type"]
                }
            }
        },
        required: ["scriptId", "name", "fields", "includeNameField"]
    },
    execute: async (args: RecordCreateCustomRecord, server: Server) => {
        const { scriptId, name, fields, includeNameField } = args;

        const mappedFields = fields ? await Promise.all(fields.map(async (field) => {
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
        })) : [];

        const baseRecordData = {
            recordname: name,
            includename: includeNameField ? 'T' : 'F',
            ...(mappedFields && mappedFields.length > 0 && {
                customrecordcustomfields: {
                    customrecordcustomfield: mappedFields
                }
            })
        };

        const manifestDependencies = getManifestDependenciesFromFields(fields);

        const sdfData = await applyDefaults(baseRecordData, ObjectDefaultType.RECORD);

        return await generateAndDeploySdf({ rootElement: "customrecordtype", scriptId, data: sdfData, server, manifestDependencies });
    }
};
