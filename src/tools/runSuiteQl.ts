import { ToolDefinition } from "../types/index.js";
import { callNetsuiteRestlet } from "../utils/api.js";

export const runSuiteQlTool: ToolDefinition = {
    name: "netsuite_run_suite_ql",
    description:
        "Execute a SuiteQL query within NetSuite via the MCP RESTlet and return the mapped result rows, elapsed execution time (timeElapsedMS), or error message.",
    meta: {
        isDestructive: false,
        requiresSdf: false
    },
    inputSchema: {
        type: "object",
        properties: {
            query: {
                type: "string",
                description: "The SuiteQL query string to execute."
            }
        },
        required: ["query"]
    },
    execute: async (args: { query: string }) => {
        try {
            const payload = { action: "RUN_SUITE_QL", query: args.query };
            const response = await callNetsuiteRestlet(payload);
            return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
        } catch (error: any) {
            return { content: [{ type: "text", text: `RESTlet Execution Error: ${error.message}` }] };
        }
    }
};
