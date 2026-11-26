import { ToolDefinition } from "../types/index.js";
import {
    searchScriptsInNetsuite,
    SearchScriptsOptions,
    SUPPORTED_SCRIPT_TYPES
} from "../utils/scripts.js";

export const searchScriptsTool: ToolDefinition = {
    name: "netsuite_search_scripts",
    description:
        "Searches NetSuite Script records (customscript_*) and their Script Deployments (customdeploy_*) via SuiteQL with filters for the target recordType deployed against, " +
        "scriptType, partial name/ID/file searchTerm, fileName, isDeployed status, deployment status (RELEASED, TESTING, NOTSCHEDULED, SCHEDULED), logLevel, and inactive status. " +
        "Returns matching scripts grouped with their File Cabinet paths and deployments (including whether each deployment is effectively active).",
    meta: {
        isDestructive: false,
        requiresSdf: false
    },
    inputSchema: {
        type: "object",
        properties: {
            recordType: {
                type: "string",
                description:
                    "(Optional) Filter by the record type the script is deployed against (e.g., 'salesorder', 'customer', 'invoice', 'itemfulfillment', or 'customrecord_...'). Case-insensitive."
            },
            scriptType: {
                type: "string",
                enum: [...SUPPORTED_SCRIPT_TYPES],
                description:
                    "(Optional) Filter by script type (USEREVENT, CLIENT, MAPREDUCE, SCHEDULED, SUITELET, RESTLET, WORKFLOWACTION, MASSUPDATE, PORTLET, BUNDLEINSTALLATION, EVENTSUBSCRIBER)."
            },
            searchTerm: {
                type: "string",
                description:
                    "(Optional) Case-insensitive partial match across script name, scriptId (customscript_* or custevsub_*), deploymentId (customdeploy_*), deployment title, or script file name."
            },
            fileName: {
                type: "string",
                description:
                    "(Optional) Filter by script file name or path (e.g., 'my_script.js' or 'my_script.ts')."
            },
            isDeployed: {
                type: "boolean",
                description:
                    "(Optional) Filter by whether the deployment 'Deployed' checkbox is checked (true = only deployed, false = only undeployed). Active EVENTSUBSCRIBER scripts are treated as deployed even though NetSuite's internal deployment row stores isdeployed = 'F'."
            },
            status: {
                type: "string",
                description:
                    "(Optional) Filter by deployment status (e.g., 'RELEASED', 'TESTING', 'NOTSCHEDULED', 'SCHEDULED', 'INPROGRESS')."
            },
            logLevel: {
                type: "string",
                enum: ["DEBUG", "AUDIT", "ERROR", "EMERGENCY"],
                description:
                    "(Optional) Filter by deployment log level ('DEBUG', 'AUDIT', 'ERROR', 'EMERGENCY')."
            },
            includeInactive: {
                type: "boolean",
                description:
                    "(Optional) Whether to include inactive scripts (isinactive = 'T'). Defaults to false."
            },
            limit: {
                type: "number",
                description:
                    "(Optional) Maximum number of scripts to return (default 100, max 500)."
            }
        }
    },
    execute: async (args: SearchScriptsOptions) => {
        try {
            const result = await searchScriptsInNetsuite(args || {});
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
