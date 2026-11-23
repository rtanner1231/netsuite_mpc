import { ToolDefinition } from "../types/index.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { getProjectRoot } from "../utils/mcp.js";
import { getProjectConfig } from "../utils/project.js";
import { readEmailTemplateFromSdf } from "../utils/templates.js";

type ReadEmailTemplateArgs = {
    scriptId: string;
};

export const readEmailTemplateTool: ToolDefinition = {
    name: "netsuite_read_email_template",
    description:
        "Downloads and reads an Email Template (custemailtmpl_*) and its inline HTML / FreeMarker body (<scriptId>.template.html) or File Cabinet media item reference (<mediaitem>) from the active NetSuite environment via an isolated temporary SDF project.",
    meta: {
        isDestructive: false,
        requiresSdf: true
    },
    inputSchema: {
        type: "object",
        properties: {
            scriptId: {
                type: "string",
                description:
                    "The script ID of the Email Template (e.g., 'custemailtmpl_order_confirm'). Automatically prepends 'custemailtmpl_' if omitted."
            }
        },
        required: ["scriptId"]
    },
    execute: async (args: ReadEmailTemplateArgs, server: Server) => {
        try {
            const rawScriptId = (args?.scriptId || "").trim();
            if (!rawScriptId) {
                return {
                    content: [
                        {
                            type: "text",
                            text: "Error: 'scriptId' is required."
                        }
                    ]
                };
            }

            const projectRoot = await getProjectRoot(server);
            const projectConfig = await getProjectConfig(projectRoot);

            const parsed = await readEmailTemplateFromSdf(
                projectRoot,
                rawScriptId,
                projectConfig
            );

            const payload: Record<string, any> = {
                scriptId: parsed.scriptId,
                name: parsed.name,
                ...(parsed.subject !== undefined ? { subject: parsed.subject } : {}),
                ...(parsed.description !== undefined ? { description: parsed.description } : {}),
                ...(parsed.recordtype !== undefined ? { recordtype: parsed.recordtype } : {}),
                usesmedia: parsed.usesmedia,
                ...(parsed.mediaitem !== undefined ? { mediaitem: parsed.mediaitem } : {}),
                addunsubscribelink: parsed.addunsubscribelink,
                addcompanyaddress: parsed.addcompanyaddress,
                isprivate: parsed.isprivate,
                isinactive: parsed.isinactive,
                ...(parsed.version !== undefined ? { version: parsed.version } : {}),
                ...(parsed.htmlContent !== undefined ? { htmlContent: parsed.htmlContent } : {}),
                rawXml: parsed.rawXml
            };

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
                        text: `Error reading Email Template: ${error.message}`
                    }
                ]
            };
        }
    }
};
