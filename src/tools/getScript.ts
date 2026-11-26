import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { ToolDefinition } from "../types/index.js";
import { getProjectRoot } from "../utils/mcp.js";
import { getScriptData, GetScriptOptions } from "../utils/scripts.js";

export const getScriptTool: ToolDefinition = {
    name: "netsuite_get_script",
    description:
        "Loads comprehensive metadata for a NetSuite Script record (customscript_* or custevsub_*) and all of its deployments (customdeploy_*) or Event Subscriber criteria, " +
        "from either a scriptId (customscript_*, custevsub_*, or numeric internal ID) or a script file path/name (e.g., 'src/TypeScripts/my_ue.ts', '/SuiteScripts/my_ue.js', or 'my_ue.js'). " +
        "Resolves the exact File Cabinet path, maps it to local workspace .ts/.js and Objects/<scriptId>.xml files, returns deployment status/recordType/logLevel/effective active state (and subscription criteria for Event Subscribers), " +
        "and optionally downloads and parses the full SDF XML definition (when includeSdfXml: true) to inspect script parameters, parameter override values, recurrence schedules, or Event Subscriber criteria.",
    meta: {
        isDestructive: false,
        requiresSdf: false
    },
    inputSchema: {
        type: "object",
        properties: {
            scriptId: {
                type: "string",
                description:
                    "(Optional) The script custom ID (e.g., 'customscript_my_ue', 'custevsub_my_sub') or numeric internal ID. Provide either 'scriptId' or 'filePath'."
            },
            filePath: {
                type: "string",
                description:
                    "(Optional) The script file path or file name (e.g., 'src/TypeScripts/my_ue.ts', '/SuiteScripts/my_ue.js', or 'my_ue.js'). Provide either 'scriptId' or 'filePath'."
            },
            includeSdfXml: {
                type: "boolean",
                description:
                    "(Optional) When true, also imports the full SDF XML definition for the script via SuiteCloud CLI in an isolated temporary project (requires sdfId configured in env.json), returning full scriptcustomfields parameter definitions, parameter values, and schedule recurrence nodes."
            }
        }
    },
    execute: async (args: GetScriptOptions, server: Server) => {
        try {
            const projectRoot = await getProjectRoot(server);
            const result = await getScriptData(projectRoot, args);
            return {
                content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
            };
        } catch (error: any) {
            return {
                content: [{ type: "text", text: `Failure: ${error.message}` }]
            };
        }
    }
};
