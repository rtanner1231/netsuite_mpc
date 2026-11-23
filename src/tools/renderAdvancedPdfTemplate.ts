import { pathToFileURL } from "url";
import { ToolDefinition } from "../types/index.js";
import { callNetsuiteRestlet } from "../utils/api.js";
import {
    normalizeAdvancedPdfScriptId,
    validateBfoPdfContent,
    writeManagedTemplatePreviewFile
} from "../utils/templates.js";

type RenderAdvancedPdfTemplateArgs = {
    scriptId?: string;
    pdfContent?: string;
    recordType?: string;
    recordId?: string | number;
    searchId?: string;
    customData?: Record<string, any>;
    returnEvaluatedXml?: boolean;
};

export const renderAdvancedPdfTemplateTool: ToolDefinition = {
    name: "netsuite_render_advanced_pdf_template",
    description:
        "Renders an Advanced PDF/HTML Template (by deployed 'scriptId' or inline 'pdfContent' BFO XML + FreeMarker) using NetSuite's N/render module via the MCP RESTlet. Binds an optional 'recordType' (with explicit 'recordId' or auto-sampled from the most recent record of that type), 'searchId' (saved search results), and/or 'customData'. Returns the binary PDF as an embedded MCP resource ('application/pdf' base64 blob) and saves a temporary copy in an auto-cleaned preview directory ('previewFilePath') so you can visually inspect the rendered PDF.",
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
                    "The script ID of a deployed Advanced PDF Template (e.g., 'custtmpl_custom_invoice'). Automatically prepends 'custtmpl_' if omitted. Required unless 'pdfContent' is provided."
            },
            pdfContent: {
                type: "string",
                description:
                    "Optional raw BFO XML + FreeMarker string (<?xml version=\"1.0\"?><!DOCTYPE pdf ...><pdf>...</pdf>). When provided, renders this inline template content directly without requiring it to be deployed via SDF first."
            },
            recordType: {
                type: "string",
                description:
                    "Optional NetSuite record type to load and bind to the '${record}' FreeMarker variable (e.g., 'invoice', 'salesorder', 'vendorbill', 'itemfulfillment', or 'customrecord_foo')."
            },
            recordId: {
                anyOf: [{ type: "number" }, { type: "string" }],
                description:
                    "Optional internal ID of the record to bind when 'recordType' is specified. If 'recordType' is provided and 'recordId' is omitted, the tool automatically samples the most recently created record of that type."
            },
            searchId: {
                type: "string",
                description:
                    "Optional Saved Search ID (e.g., 'customsearch_my_search') to execute and bind to the '${results}' FreeMarker variable for saved-search PDF templates."
            },
            customData: {
                type: "object",
                description:
                    "Optional map of custom FreeMarker data source aliases to JSON objects (e.g., { \"customObj\": { \"title\": \"Hello\" } }) bound via renderer.addCustomDataSource."
            },
            returnEvaluatedXml: {
                type: "boolean",
                description:
                    "Optional flag (default false). If true, also returns the intermediate BFO XML string after FreeMarker evaluation ('evaluatedXml'). Note: If BFO PDF rendering fails, 'evaluatedXml' is included automatically to aid debugging."
            }
        }
    },
    execute: async (args: RenderAdvancedPdfTemplateArgs) => {
        try {
            const hasScriptId = typeof args?.scriptId === "string" && args.scriptId.trim() !== "";
            const hasPdfContent =
                typeof args?.pdfContent === "string" && args.pdfContent.trim() !== "";

            if (!hasScriptId && !hasPdfContent) {
                return {
                    content: [
                        {
                            type: "text",
                            text: "Error: Either 'scriptId' (for a deployed template) or 'pdfContent' (for inline BFO XML previewing) must be provided."
                        }
                    ],
                    isError: true
                };
            }

            const normalizedScriptId = hasScriptId
                ? normalizeAdvancedPdfScriptId(args.scriptId!)
                : undefined;

            if (hasPdfContent) {
                validateBfoPdfContent(args.pdfContent!);
            }

            const response = await callNetsuiteRestlet({
                action: "RENDER_PDF_TEMPLATE",
                ...(normalizedScriptId ? { scriptId: normalizedScriptId } : {}),
                ...(hasPdfContent ? { pdfContent: args.pdfContent } : {}),
                ...(args?.recordType ? { recordType: args.recordType.trim() } : {}),
                ...(args?.recordId !== undefined && args?.recordId !== null
                    ? { recordId: args.recordId }
                    : {}),
                ...(args?.searchId ? { searchId: args.searchId.trim() } : {}),
                ...(args?.customData ? { customData: args.customData } : {}),
                returnEvaluatedXml: Boolean(args?.returnEvaluatedXml)
            });

            if (!response || !response.success) {
                const errorPayload: Record<string, any> = {
                    success: false,
                    errorMessage:
                        response?.errorMessage || "NetSuite RESTlet RENDER_PDF_TEMPLATE failed."
                };
                if (response?.evaluatedXml) {
                    errorPayload.evaluatedXml = response.evaluatedXml;
                }
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify(errorPayload, null, 2)
                        }
                    ],
                    isError: true
                };
            }

            const pdfBase64 = String(response.pdfBase64 || "");
            const pdfBuffer = Buffer.from(pdfBase64, "base64");

            const baseFileName = normalizedScriptId
                ? `${normalizedScriptId}.pdf`
                : "inline_preview.pdf";
            const previewFilePath = await writeManagedTemplatePreviewFile(
                baseFileName,
                pdfBuffer
            );
            const fileUri = pathToFileURL(previewFilePath).href;

            const metadataSummary: Record<string, any> = {
                success: true,
                scriptId: normalizedScriptId ?? null,
                usedInlinePdfContent: Boolean(response.usedInlinePdfContent),
                recordType: response.recordType ?? null,
                resolvedRecordId: response.resolvedRecordId ?? null,
                isAutoSampled: Boolean(response.isAutoSampled),
                searchId: response.searchId ?? null,
                pdfByteSize: pdfBuffer.byteLength,
                previewFilePath,
                timeElapsedMS: response.timeElapsedMS,
                governanceUsed: response.governanceUsed,
                ...(response.evaluatedXml !== undefined
                    ? { evaluatedXml: response.evaluatedXml }
                    : {})
            };

            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(metadataSummary, null, 2)
                    },
                    {
                        type: "resource",
                        resource: {
                            uri: fileUri,
                            mimeType: "application/pdf",
                            blob: pdfBase64
                        }
                    }
                ]
            };
        } catch (error: any) {
            return {
                content: [
                    {
                        type: "text",
                        text: `Error rendering Advanced PDF Template: ${error.message}`
                    }
                ],
                isError: true
            };
        }
    }
};
