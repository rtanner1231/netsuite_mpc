import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { ToolDefinition } from "../types/index.js";
import { getProjectRoot } from "../utils/mcp.js";
import { getSaveToProjectSchemaProperty } from "../utils/objects.js";
import {
    DeployScriptInput,
    deployScriptInSdf,
    SUPPORTED_SCRIPT_TYPES
} from "../utils/scripts.js";

export const deployScriptTool: ToolDefinition = {
    name: "netsuite_deploy_script",
    description:
        "Creates or updates (upserts) a NetSuite Script record (customscript_*), its script parameters (custscript_*), and its deployments/schedules (customdeploy_*), " +
        "and conditionally builds and uploads the script file (.ts or .js) to the File Cabinet in a single atomic SDF deployment inside an isolated temporary SDF project. " +
        "Supports all standard SuiteScript 2.x types (USEREVENT, CLIENT, MAPREDUCE, SCHEDULED, SUITELET, RESTLET, WORKFLOWACTION, MASSUPDATE, PORTLET, BUNDLEINSTALLATION) " +
        "with auto-detection from the file's @NScriptType JSDoc tag. " +
        "Includes duplicate-script protection: if the target script file already has an existing script record with a different scriptId, the tool halts and reports the existing scriptId unless forceCreateNewScript is set to true.",
    meta: {
        isDestructive: true,
        requiresSdf: true
    },
    inputSchema: {
        type: "object",
        properties: {
            filePath: {
                type: "string",
                description:
                    "Path to the script file (e.g., 'src/TypeScripts/my_ue.ts', 'TypeScripts/my_ue.ts', or '/SuiteScripts/my_ue.js'). " +
                    "Required when creating a new script or uploading code changes. Optional if you are only updating parameters, schedules, or deployments on an existing script by scriptId."
            },
            scriptId: {
                type: "string",
                description:
                    "The custom script ID (e.g., 'customscript_my_ue'; auto-prefixed with 'customscript_' if omitted, max 40 chars). " +
                    "Optional when updating an existing script record that is already linked to 'filePath'."
            },
            scriptType: {
                type: "string",
                enum: [...SUPPORTED_SCRIPT_TYPES],
                description:
                    "Optional script type override. Auto-detected from the file's @NScriptType JSDoc annotation or existing script record when omitted."
            },
            name: {
                type: "string",
                description:
                    "Display name of the script record (max 40 characters). Required when creating a new script record; optional when updating an existing script."
            },
            description: {
                type: "string",
                description: "(Optional) Description of the script record."
            },
            isInactive: {
                type: "boolean",
                description: "(Optional) Whether the script record is marked inactive (defaults to false on creation)."
            },
            notifyOwner: {
                type: "boolean",
                description: "(Optional) Whether to notify the script owner on unhandled script errors (defaults to true on creation)."
            },
            notifyUser: {
                type: "boolean",
                description: "(Optional) Whether to notify the current user on script errors."
            },
            notifyEmails: {
                type: "string",
                description: "(Optional) Comma-separated list of email addresses to notify on script error."
            },
            portletType: {
                type: "string",
                enum: ["FORM", "HTML", "LINKS", "LIST"],
                description: "(Optional, PORTLET scripts only) The portlet type (defaults to 'FORM')."
            },
            returnType: {
                type: "string",
                description: "(Optional, WORKFLOWACTION scripts only) Return value field type (e.g., 'TEXT', 'INTEGER', 'CHECKBOX', 'SELECT')."
            },
            returnRecordType: {
                type: "string",
                description: "(Optional, WORKFLOWACTION scripts only) Return record type when returnType is 'SELECT' (e.g., 'customer' or 'customrecord_foo')."
            },
            parameters: {
                type: "array",
                description:
                    "(Optional) Array of script parameter definitions (custscript_*) to add or update on the script record. Existing parameters not listed here are preserved.",
                items: {
                    type: "object",
                    properties: {
                        scriptId: {
                            type: "string",
                            description: "Parameter internal ID (e.g. 'custscript_my_param'; auto-prefixed with 'custscript_' if omitted, max 40 chars)."
                        },
                        label: {
                            type: "string",
                            description: "UI label for the script parameter."
                        },
                        type: {
                            type: "string",
                            enum: [
                                "CHECKBOX",
                                "CLOBTEXT",
                                "CURRENCY",
                                "DATE",
                                "DATETIMETZ",
                                "DOCUMENT",
                                "EMAIL",
                                "FLOAT",
                                "HELP",
                                "IMAGE",
                                "INLINEHTML",
                                "INTEGER",
                                "MULTISELECT",
                                "PASSWORD",
                                "PERCENT",
                                "PHONE",
                                "RICHTEXT",
                                "SELECT",
                                "TEXT",
                                "TEXTAREA",
                                "TIMEOFDAY",
                                "URL"
                            ],
                            description: "Parameter field type (e.g. 'TEXT', 'INTEGER', 'CHECKBOX', 'SELECT', 'DATE')."
                        },
                        selectRecordType: {
                            type: "string",
                            description: "Required when type is 'SELECT' or 'MULTISELECT'. The target record/list ID (e.g. 'customer', 'transaction', 'customrecord_foo', 'customlist_bar')."
                        },
                        description: {
                            type: "string",
                            description: "(Optional) Description of the script parameter."
                        },
                        helpText: {
                            type: "string",
                            description: "(Optional) Help text shown in the NetSuite UI."
                        },
                        defaultValue: {
                            type: ["string", "number", "boolean"],
                            description: "(Optional) Default value for the parameter."
                        },
                        isMandatory: {
                            type: "boolean",
                            description: "(Optional) Whether the parameter is mandatory."
                        },
                        setting: {
                            type: "string",
                            enum: ["COMPANY", "USER", "NONE"],
                            description: "(Optional) Preference scope if the parameter is a Company or User preference."
                        },
                        displayType: {
                            type: "string",
                            enum: ["NORMAL", "DISABLED", "INLINE", "HIDDEN", "STATICTEXT"],
                            description: "(Optional) Display type in the UI (defaults to 'NORMAL')."
                        }
                    },
                    required: ["scriptId", "label", "type"]
                }
            },
            deployments: {
                type: "array",
                description:
                    "(Optional) Array of script deployments (customdeploy_*) to create or update. " +
                    "When updating an existing script, matching deployment scriptIds are updated in-place and new deployment scriptIds are appended while preserving other existing deployments.",
                items: {
                    type: "object",
                    properties: {
                        scriptId: {
                            type: "string",
                            description:
                                "(Optional) Deployment ID (e.g. 'customdeploy_my_ue'; auto-prefixed with 'customdeploy_' if omitted, max 40 chars). " +
                                "If omitted, defaults to updating the single existing deployment or 'customdeploy_<script_suffix>'."
                        },
                        title: {
                            type: "string",
                            description: "(Optional) Deployment title (defaults to the script name on creation)."
                        },
                        isDeployed: {
                            type: "boolean",
                            description: "(Optional) Whether the 'Deployed' checkbox is checked (defaults to true on creation)."
                        },
                        status: {
                            type: "string",
                            enum: ["TESTING", "RELEASED", "NOTSCHEDULED", "SCHEDULED"],
                            description:
                                "(Optional) Deployment status. Defaults to 'TESTING' for event/HTTP scripts, or 'NOTSCHEDULED' / 'SCHEDULED' for Scheduled and Map/Reduce scripts."
                        },
                        logLevel: {
                            type: "string",
                            enum: ["DEBUG", "AUDIT", "ERROR", "EMERGENCY"],
                            description: "(Optional) Execution log level (defaults to 'DEBUG' on creation)."
                        },
                        recordType: {
                            type: "string",
                            description:
                                "(Required for new USEREVENT, WORKFLOWACTION, and MASSUPDATE deployments; optional for CLIENT deployments) " +
                                "The record type the script is deployed against (e.g. 'SALESORDER', 'CUSTOMER', 'INVOICE', 'ALLRECORD', or 'customrecord_...')."
                        },
                        eventType: {
                            type: "string",
                            description:
                                "(Optional, USEREVENT / CLIENT scripts) Restrict execution to a specific event type (e.g. 'CREATE', 'EDIT', 'DELETE', 'VIEW', 'XEDIT')."
                        },
                        runAsRole: {
                            type: "string",
                            description:
                                "(Optional, USEREVENT / SUITELET / WORKFLOWACTION / BUNDLEINSTALLATION) Role under which the script runs. " +
                                "Defaults to 'ADMINISTRATOR' on new deployments. Accepts 'ADMINISTRATOR', 'customrole_...' (auto-wrapped as '[scriptid=customrole_...]'), or 'CURRENT_ROLE' / '' to run as the current user's role."
                        },
                        allRoles: {
                            type: "boolean",
                            description: "(Optional) Grant audience access to all roles (defaults to true on creation)."
                        },
                        audienceRoles: {
                            type: "array",
                            items: { type: "string" },
                            description: "(Optional) Array of specific role IDs for the deployment audience."
                        },
                        allEmployees: {
                            type: "boolean",
                            description: "(Optional) Grant audience access to all employees."
                        },
                        allPartners: {
                            type: "boolean",
                            description: "(Optional) Grant audience access to all partners."
                        },
                        isOnline: {
                            type: "boolean",
                            description: "(Optional, SUITELET only) Whether the Suitelet is 'Available Without Login' (defaults to false)."
                        },
                        concurrencyLimit: {
                            type: "number",
                            description: "(Optional, SCHEDULED / MAPREDUCE only) Concurrency limit for parallel executions."
                        },
                        yieldAfterMins: {
                            type: "number",
                            description: "(Optional, MAPREDUCE only) Yield after minutes (defaults to 60)."
                        },
                        bufferSize: {
                            type: "number",
                            description: "(Optional, MAPREDUCE only) Buffer size (defaults to 1)."
                        },
                        parameterValues: {
                            type: "object",
                            additionalProperties: {
                                type: ["string", "number", "boolean", "null"]
                            },
                            description:
                                "(Optional) Key-value map of script parameter values to set on this deployment (e.g. { \"custscript_my_param\": \"abc\", \"custscript_enabled\": true })."
                        },
                        schedule: {
                            type: "object",
                            description:
                                "(Optional, SCHEDULED / MAPREDUCE only) Schedule recurrence configuration for the deployment.",
                            properties: {
                                frequency: {
                                    type: "string",
                                    enum: ["NONE", "SINGLE", "DAILY", "WEEKLY", "MONTHLY", "YEARLY"],
                                    description:
                                        "Recurrence frequency. Use 'NONE' to unschedule (sets status to NOTSCHEDULED), or 'SINGLE', 'DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'."
                                },
                                startDate: {
                                    type: "string",
                                    description:
                                        "(Optional) Start date in 'YYYY-MM-DD' format in the NetSuite account's local timezone (defaults to today in the account timezone)."
                                },
                                startTime: {
                                    type: "string",
                                    description:
                                        "(Optional) Start time in 'HH:mm:ss' (or 'HH:mm') 24-hour format in the NetSuite account's local timezone (e.g. '01:00:00' for 1:00 AM; defaults to '01:00:00'). Automatically converted with startDate to UTC for SDF deployment."
                                },
                                endDate: {
                                    type: "string",
                                    description: "(Optional) End date in 'YYYY-MM-DD' format."
                                },
                                everyXDays: {
                                    type: "number",
                                    description: "(Optional, DAILY only) Run every X days (default 1)."
                                },
                                everyXWeeks: {
                                    type: "number",
                                    description: "(Optional, WEEKLY only) Run every X weeks (default 1)."
                                },
                                daysOfWeek: {
                                    type: "array",
                                    items: {
                                        type: "string",
                                        enum: ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"]
                                    },
                                    description: "(Optional, WEEKLY only) Days of the week on which to run."
                                },
                                everyXMonths: {
                                    type: "number",
                                    description: "(Optional, MONTHLY only) Run every X months (default 1)."
                                },
                                dayOfMonth: {
                                    type: "number",
                                    description: "(Optional, MONTHLY / YEARLY) Day of the month (1-31)."
                                },
                                month: {
                                    type: ["string", "number"],
                                    description: "(Optional, YEARLY only) Month of the year (e.g. 'JANUARY')."
                                },
                                repeatEveryMins: {
                                    type: ["number", "string"],
                                    description: "(Optional) Repeat interval within the day in minutes (e.g. 15, 30, 60) or ISO duration ('PT15M', 'PT1H')."
                                }
                            },
                            required: ["frequency"]
                        }
                    }
                }
            },
            additionalFiles: {
                type: "array",
                items: { type: "string" },
                description:
                    "(Optional) Array of additional helper or library script file paths to compile and upload alongside the primary script file."
            },
            skipBuild: {
                type: "boolean",
                description: "(Optional) Skip running the project build command before uploading files."
            },
            skipFileUpload: {
                type: "boolean",
                description:
                    "(Optional) Skip uploading the .js script file to the File Cabinet and only deploy the script/deployment SDF XML object."
            },
            forceCreateNewScript: {
                type: "boolean",
                description:
                    "(Optional) Set to true ONLY when you intentionally want to create an additional script record for a file that already has an existing script record with a different scriptId."
            },
            saveToProject: getSaveToProjectSchemaProperty()
        }
    },
    execute: async (args: DeployScriptInput, server: Server) => {
        try {
            const projectRoot = await getProjectRoot(server);
            const output = await deployScriptInSdf(projectRoot, args);
            return {
                content: [{ type: "text", text: output }]
            };
        } catch (error: any) {
            return {
                content: [{ type: "text", text: `Failure: ${error.message}` }]
            };
        }
    }
};
