import { ToolDefinition } from "../types/index.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { getProjectRoot } from "../utils/mcp.js";
import { getProjectConfig } from "../utils/project.js";
import { readAdvancedPdfTemplateFromSdf } from "../utils/templates.js";

type ReadAdvancedPdfTemplateArgs = {
    scriptId: string;
};

export const readAdvancedPdfTemplateTool: ToolDefinition = {
    name: "netsuite_read_advanced_pdf_template",
    description:
        "Downloads and reads an Advanced PDF/HTML Template (custtmpl_*) and its BFO XML / FreeMarker source code (<scriptId>.template.xml) from the active NetSuite environment via an isolated temporary SDF project.",
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
                    "The script ID of the Advanced PDF Template (e.g., 'custtmpl_custom_invoice'). Automatically prepends 'custtmpl_' if omitted."
            }
        },
        required: ["scriptId"]
    },
    execute: async (args: ReadAdvancedPdfTemplateArgs, server: Server) => {
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

            const parsed = await readAdvancedPdfTemplateFromSdf(
                projectRoot,
                rawScriptId,
                projectConfig
            );

            const payload: Record<string, any> = {
                scriptId: parsed.scriptId,
                standard: parsed.standard,
                title: parsed.title,
                ...(parsed.description !== undefined ? { description: parsed.description } : {}),
                ...(parsed.trantype !== undefined ? { trantype: parsed.trantype } : {}),
                ...(parsed.printtype !== undefined ? { printtype: parsed.printtype } : {}),
                ...(parsed.recordtype !== undefined ? { recordtype: parsed.recordtype } : {}),
                ...(parsed.customtransaction !== undefined
                    ? { customtransaction: parsed.customtransaction }
                    : {}),
                ...(parsed.savedsearch !== undefined ? { savedsearch: parsed.savedsearch } : {}),
                preferred: parsed.preferred,
                displaysourcecode: parsed.displaysourcecode,
                isinactive: parsed.isinactive,
                ...(parsed.version !== undefined ? { version: parsed.version } : {}),
                pdfContent: parsed.pdfContent ?? "",
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
                        text: `Error reading Advanced PDF Template: ${error.message}`
                    }
                ]
            };
        }
    }
};
