import { ToolDefinition } from "../types/index.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { getProjectRoot } from "../utils/mcp.js";
import { getProjectConfig } from "../utils/project.js";
import { getSaveToProjectSchemaProperty } from "../utils/objects.js";
import {
    UpsertAdvancedPdfTemplateInput,
    upsertAdvancedPdfTemplateInSdf
} from "../utils/templates.js";

export const upsertAdvancedPdfTemplateTool: ToolDefinition = {
    name: "netsuite_upsert_advanced_pdf_template",
    description:
        "Creates or updates an Advanced PDF/HTML Template (custtmpl_*) and its companion BFO XML / FreeMarker file (<scriptId>.template.xml) in NetSuite via an isolated temporary SDF project. If the template already exists in NetSuite, its current definition is downloaded first and merged with the provided parameters so omitted properties are preserved. When creating a new template, 'title' and 'pdfContent' are required.",
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
                    "Maps to the scriptid attribute (max 98 chars). Automatically prepends 'custtmpl_' if omitted."
            },
            title: {
                type: "string",
                description:
                    "Maps to <title> (max 297 chars). Required when creating a new template; optional when updating an existing template."
            },
            pdfContent: {
                type: "string",
                description:
                    "Written to <scriptId>.template.xml. Must be valid BFO XML (<?xml version=\"1.0\"?><!DOCTYPE pdf ...><pdf>...</pdf>) + FreeMarker. Required when creating a new template; optional when updating an existing template."
            },
            standard: {
                type: "string",
                description:
                    "Maps to the standard attribute (e.g., 'STDTMPLCUSTINVC', 'STDTMPLEMPTY'). Defaults to 'STDTMPLEMPTY' for standalone/saved search templates when creating a new template."
            },
            trantype: {
                type: "string",
                description:
                    "Maps to <trantype> (e.g., 'CUSTINVC', 'SALESORD', 'VENDBILL', 'ITEMSHIP')."
            },
            printtype: {
                type: "string",
                description:
                    "Maps to <printtype> (e.g., 'TRANSACTION', 'PACKINGSLIP', 'PICKINGTICKET', 'ITEMLABEL', 'CUSTOMRECORD', 'CUSTOMTRANSACTION', 'SEARCH'). Note: 'STATEMENT' is rejected up front because NetSuite SDF does not support Customer Statement templates."
            },
            recordtype: {
                type: "string",
                description:
                    "Maps to <recordtype> for custom records (or <customtransaction> if a 'customtransaction_*' script ID is passed). Accepts raw script IDs (e.g., 'customrecord_foo' or 'customtransaction_bar') and wraps them in '[scriptid=...]' automatically."
            },
            savedsearch: {
                type: "string",
                description:
                    "Maps to <savedsearch>. Accepts a raw search ID (e.g., 'customsearch_foo') and wraps it in '[scriptid=...]' automatically."
            },
            preferred: {
                type: "boolean",
                description:
                    "Maps to <preferred> ('T' / 'F', defaults to false on creation)."
            },
            displaysourcecode: {
                type: "boolean",
                description:
                    "Maps to <displaysourcecode> ('T' / 'F', defaults to true on creation to prevent users from accidentally breaking FreeMarker loops in the NetSuite WYSIWYG editor)."
            },
            description: {
                type: "string",
                description: "Maps to <description> (max 4000 chars)."
            },
            isinactive: {
                type: "boolean",
                description: "Maps to <isinactive> ('T' / 'F', defaults to false on creation)."
            },
            saveToProject: getSaveToProjectSchemaProperty()
        },
        required: ["scriptId"]
    },
    execute: async (args: UpsertAdvancedPdfTemplateInput, server: Server) => {
        try {
            const projectRoot = await getProjectRoot(server);
            const projectConfig = await getProjectConfig(projectRoot);

            const output = await upsertAdvancedPdfTemplateInSdf(
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
                        text: `Error upserting Advanced PDF Template: ${error.message}`
                    }
                ]
            };
        }
    }
};
