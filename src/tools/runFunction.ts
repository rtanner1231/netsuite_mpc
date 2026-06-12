import { ToolDefinition } from "../types/index.js";
import { callNetsuiteRestlet } from "../utils/api.js";

export const runFunctionTool: ToolDefinition = {
    name: "netsuite_run_function",
    description: "Run a specific function from a module in NetSuite and return the execution result.",
    inputSchema: {
        type: "object",
        properties: {
            filePath: { type: "string" },
            functionName: { type: "string" },
            args: { type: "array", items: {} }
        },
        required: ["filePath", "functionName", "args"]
    },
    execute: async (args: { filePath: string; functionName: string; args: any[] }) => {
        try {
            const payload = { action: "RUN_FUNCTION", ...args };
            const response = await callNetsuiteRestlet(payload);
            return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
        } catch (error: any) {
            return { content: [{ type: "text", text: `RESTlet Error: ${error.message}` }] };
        }
    }
};
