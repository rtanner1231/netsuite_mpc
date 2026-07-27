import { ToolDefinition } from "../types/index.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { generateAndDeploySdf } from "../utils/objects.js";
import { applyDefaults } from "../defaults/index.js";
import { ObjectDefaultType } from "../defaults/types.js";
import { CustomRecordField, getManifestDependenciesFromFields, mapCustomRecordFields } from "../utils/customRecords.js";

type RecordCreateCustomRecord = {
    scriptId: string;
    name: string;
    includeNameField: boolean;
    fields: CustomRecordField[];
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

        const mappedFields = fields ? await mapCustomRecordFields(fields) : [];

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
