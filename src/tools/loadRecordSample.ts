import { ToolDefinition } from "../types/index.js";
import { callNetsuiteRestlet } from "../utils/api.js";

export const loadRecordSampleTool: ToolDefinition = {
    name: "netsuite_load_record_sample",
    description:
        "Loads a full NetSuite record in dynamic mode as JSON via the MCP RESTlet to inspect its body fields and sublist structure. If 'id' is omitted, automatically searches for and samples the most recently created record of the specified 'record_type'.",
    meta: {
        isDestructive: false,
        requiresSdf: false
    },
    inputSchema: {
        type: "object",
        properties: {
            record_type: {
                type: "string",
                description: "The NetSuite record type ID (e.g., 'salesorder', 'customer', or a custom record scriptId)."
            },
            id: {
                type: "string",
                description: "(Optional) The internal ID of a specific record to load. If omitted, the latest record of 'record_type' is automatically sampled."
            }
        },
        required: ["record_type"]
    },
    execute: async (args: { record_type: string; id?: string }) => {
        try {
            const payload = { action: "RECORD_SAMPLE", recordType: args.record_type, recordId: args.id };
            const response = await callNetsuiteRestlet(payload);
            return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
        } catch (error: any) {
            return { content: [{ type: "text", text: `RESTlet Error: ${error.message}` }] };
        }
    }
};
