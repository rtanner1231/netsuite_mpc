import { ToolDefinition } from "../types/index.js";
import { callNetsuiteRestlet } from "../utils/api.js";

export const loadRecordSampleTool: ToolDefinition = {
    name: "netsuite_load_record_sample",
    description: "Loads a full NetSuite record as JSON to inspect its fields and sublist structure.",
    inputSchema: {
        type: "object",
        properties: {
            record_type: { type: "string" },
            id: { type: "string" }
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
