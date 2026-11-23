import { ToolDefinition } from "../types/index.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { getProjectRoot } from "../utils/mcp.js";
import { getProjectConfig } from "../utils/project.js";
import { listSdfTemplates, SdfTemplateType } from "../utils/templates.js";

type ListTemplatesArgs = {
    type?: "all" | SdfTemplateType;
};

export const listTemplatesTool: ToolDefinition = {
    name: "netsuite_list_templates",
    description:
        "Lists custom Advanced PDF Templates (custtmpl_*) and/or Email Templates (custemailtmpl_*) in the active NetSuite environment by running 'suitecloud object:list' inside an isolated temporary SDF project.",
    meta: {
        isDestructive: false,
        requiresSdf: true
    },
    inputSchema: {
        type: "object",
        properties: {
            type: {
                type: "string",
                enum: ["all", "advancedpdftemplate", "emailtemplate"],
                description:
                    "Optional filter for the template type to list: 'advancedpdftemplate' (custtmpl_*), 'emailtemplate' (custemailtmpl_*), or 'all' (default)."
            }
        }
    },
    execute: async (args: ListTemplatesArgs, server: Server) => {
        try {
            const rawType = (args?.type || "all").trim().toLowerCase();
            const filterType: "all" | SdfTemplateType =
                rawType === "advancedpdftemplate" || rawType === "emailtemplate"
                    ? rawType
                    : "all";

            const projectRoot = await getProjectRoot(server);
            const projectConfig = await getProjectConfig(projectRoot);

            const { advancedPdfTemplates, emailTemplates } = await listSdfTemplates(
                projectRoot,
                filterType,
                projectConfig
            );

            const payload: Record<string, any> = {
                filter: filterType
            };

            if (filterType === "all" || filterType === "advancedpdftemplate") {
                payload.advancedPdfTemplatesCount = advancedPdfTemplates.length;
                payload.advancedPdfTemplates = advancedPdfTemplates;
            }

            if (filterType === "all" || filterType === "emailtemplate") {
                payload.emailTemplatesCount = emailTemplates.length;
                payload.emailTemplates = emailTemplates;
            }

            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(payload, null, 2)
                    }
                ]
            };
        } catch (error: any) {
            return {
                content: [
                    {
                        type: "text",
                        text: `Error listing templates: ${error.message}`
                    }
                ]
            };
        }
    }
};
