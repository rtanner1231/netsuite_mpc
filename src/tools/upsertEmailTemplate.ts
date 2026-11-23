import { ToolDefinition } from "../types/index.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { getProjectRoot } from "../utils/mcp.js";
import { getProjectConfig } from "../utils/project.js";
import { getSaveToProjectSchemaProperty } from "../utils/objects.js";
import {
    EMAIL_RECORD_TYPES,
    UpsertEmailTemplateInput,
    upsertEmailTemplateInSdf
} from "../utils/templates.js";

export const upsertEmailTemplateTool: ToolDefinition = {
    name: "netsuite_upsert_email_template",
    description:
        "Creates or updates an Email Template (custemailtmpl_*) and its inline HTML / FreeMarker file (<scriptId>.template.html) or File Cabinet <mediaitem> reference in NetSuite via an isolated temporary SDF project. If the template already exists in NetSuite, its current definition is downloaded first and merged with the provided parameters so omitted properties are preserved. When creating a new template, 'name' and either 'htmlContent' or 'mediaItemPath' are required.",
    meta: {
        isDestructive: true,
        requiresSdf: true
    },
    inputSchema: {
        type: "object",
        properties: {
            scriptId: {
                type: "string",
                description:
                    "Maps to the scriptid attribute (max 99 chars). Automatically prepends 'custemailtmpl_' if omitted."
            },
            name: {
                type: "string",
                description:
                    "Maps to <name> (max 60 chars). Required when creating a new template; optional when updating an existing template."
            },
            subject: {
                type: "string",
                description:
                    "Maps to <subject> (max 199 chars). Supports FreeMarker expressions (e.g., 'Order ${transaction.tranid}')."
            },
            htmlContent: {
                type: "string",
                description:
                    "Written to <scriptId>.template.html with <usesmedia>F</usesmedia>. Required when creating a new template unless 'mediaItemPath' is provided."
            },
            mediaItemPath: {
                type: "string",
                description:
                    "Optional File Cabinet path (.html, .htm, .ftl, .txt). When set, emits <usesmedia>T</usesmedia> and <mediaitem>[/Templates/...]</mediaitem> instead of writing <scriptId>.template.html."
            },
            recordtype: {
                type: "string",
                enum: [...EMAIL_RECORD_TYPES],
                description:
                    "Maps to <recordtype>. Must be one of: CUSTOM, ENTITY, EVENT, PROJECT, TRANSACTION."
            },
            addunsubscribelink: {
                type: "boolean",
                description:
                    "Maps to <addunsubscribelink> ('T' / 'F'; SDF schema default is T on creation, though false is often cleaner for transactional emails)."
            },
            addcompanyaddress: {
                type: "boolean",
                description:
                    "Maps to <addcompanyaddress> ('T' / 'F', SDF default T on creation)."
            },
            isprivate: {
                type: "boolean",
                description:
                    "Maps to <isprivate> ('T' / 'F', defaults to false on creation)."
            },
            description: {
                type: "string",
                description: "Maps to <description> (max 1000 chars)."
            },
            isinactive: {
                type: "boolean",
                description:
                    "Maps to <isinactive> ('T' / 'F', defaults to false on creation)."
            },
            saveToProject: getSaveToProjectSchemaProperty()
        },
        required: ["scriptId"]
    },
    execute: async (args: UpsertEmailTemplateInput, server: Server) => {
        try {
            const projectRoot = await getProjectRoot(server);
            const projectConfig = await getProjectConfig(projectRoot);

            const output = await upsertEmailTemplateInSdf(
                projectRoot,
                args,
                projectConfig
            );

            return {
                content: [
                    {
                        type: "text",
                        text: output
                    }
                ]
            };
        } catch (error: any) {
            return {
                content: [
                    {
                        type: "text",
                        text: `Error upserting Email Template: ${error.message}`
                    }
                ]
            };
        }
    }
};
