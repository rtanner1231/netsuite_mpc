import { ToolDefinition } from "../types/index.js";
import { callNetsuiteRestlet } from "../utils/api.js";

export const getScriptLogsTool: ToolDefinition = {
    name: "netsuite_get_script_logs",
    description: "Retrieve the last 500 script logs for a specific NetSuite script.",
    inputSchema: {
        type: "object",
        properties: { scriptFileName: { type: "string" } },
        required: ["scriptFileName"]
    },
    execute: async (args: { scriptFileName: string }) => {
        try {
            const payload = { action: "SCRIPT_LOGS", scriptFileName: args.scriptFileName };
            const response = await callNetsuiteRestlet(payload);
            return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
        } catch (error: any) {
            return { content: [{ type: "text", text: `RESTlet Execution Error: ${error.message}` }] };
        }
    }
};
