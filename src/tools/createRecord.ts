import { ToolDefinition } from "../types/index.js";
import { callNetsuiteRestlet } from "../utils/api.js";

export interface RecordFieldValue {
    fieldId: string;
    value: string | number | boolean | any[] | null;
}

export const createRecordTool: ToolDefinition = {
    name: "netsuite_create_record",
    description:
        "Creates a new record in NetSuite for a given table/record type (table_id) and sets the specified body field values (fields) via the MCP RESTlet, returning the newly created internal recordId, elapsed time (timeElapsedMS), and governance units used (governanceUsed).",
    meta: {
        isDestructive: true,
        requiresSdf: false
    },
    inputSchema: {
        type: "object",
        properties: {
            table_id: {
                type: "string",
                description: "The NetSuite record type / table ID (e.g., 'customer', 'salesorder', or a custom record scriptId such as 'customrecord_...')."
            },
            fields: {
                type: "array",
                description: "An array of fieldId and value pairs to set on the newly created record.",
                items: {
                    type: "object",
                    properties: {
                        fieldId: {
                            type: "string",
                            description: "The internal ID of the body field to set (e.g., 'companyname', 'subsidiary', or 'custrecord_...')."
                        },
                        value: {
                            description: "The value to assign to the field. For date/datetime fields, pass an ISO string (e.g., 'YYYY-MM-DD' or 'YYYY-MM-DDTHH:mm:ss').",
                            anyOf: [
                                { type: "string" },
                                { type: "number" },
                                { type: "boolean" },
                                {
                                    type: "array",
                                    items: {
                                        anyOf: [
                                            { type: "string" },
                                            { type: "number" }
                                        ]
                                    }
                                },
                                { type: "null" }
                            ]
                        }
                    },
                    required: ["fieldId", "value"]
                }
            }
        },
        required: ["table_id", "fields"]
    },
    execute: async (args: { table_id: string; fields: RecordFieldValue[] }) => {
        try {
            const payload = {
                action: "CREATE_RECORD",
                recordType: args.table_id,
                fields: args.fields
            };
            const response = await callNetsuiteRestlet(payload);
            return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
        } catch (error: any) {
            return { content: [{ type: "text", text: `RESTlet Error: ${error.message}` }] };
        }
    }
};
