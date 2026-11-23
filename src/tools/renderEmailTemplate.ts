import { pathToFileURL } from "url";
import { ToolDefinition } from "../types/index.js";
import { callNetsuiteRestlet } from "../utils/api.js";
import {
    normalizeEmailTemplateScriptId,
    writeManagedTemplatePreviewFile
} from "../utils/templates.js";

type RenderEmailTemplateArgs = {
    scriptId: string;
    transactionId?: string | number;
    transactionType?: string;
    entityType?: string;
    entityId?: string | number;
    recipientType?: string;
    recipientId?: string | number;
    customRecordType?: string;
    customRecordId?: string | number;
    supportCaseId?: string | number;
};

export const renderEmailTemplateTool: ToolDefinition = {
    name: "netsuite_render_email_template",
    description:
        "Renders an Email Template (custemailtmpl_*) using NetSuite's N/render.mergeEmail via the MCP RESTlet. Supports binding transaction, entity, recipient, customRecord, or supportCase records (with explicit internal IDs or auto-sampling the latest record when a type such as 'transactionType', 'entityType', or 'customRecordType' is provided without an ID). Returns the evaluated 'subject' and HTML 'body', an embedded 'text/html' MCP resource, and saves a temporary HTML preview file ('previewFilePath') in an auto-cleaned preview directory.",
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
                    "The script ID of the deployed Email Template (e.g., 'custemailtmpl_order_confirm'). Automatically prepends 'custemailtmpl_' if omitted."
            },
            transactionId: {
                anyOf: [{ type: "number" }, { type: "string" }],
                description:
                    "Optional internal ID of a transaction record to merge into '${transaction.*}' fields."
            },
            transactionType: {
                type: "string",
                description:
                    "Optional transaction record type (e.g., 'salesorder', 'invoice') used to auto-sample the most recent transaction when 'transactionId' is omitted."
            },
            entityType: {
                type: "string",
                description:
                    "Optional entity record type (e.g., 'customer', 'employee', 'vendor', 'contact', 'partner') to merge into entity fields. If 'entityId' is omitted, auto-samples the most recent record of this type."
            },
            entityId: {
                anyOf: [{ type: "number" }, { type: "string" }],
                description:
                    "Optional internal ID of the entity record when 'entityType' is specified."
            },
            recipientType: {
                type: "string",
                description:
                    "Optional recipient record type (e.g., 'customer', 'contact', 'employee', 'vendor') to merge into recipient fields. If 'recipientId' is omitted, auto-samples the most recent record of this type."
            },
            recipientId: {
                anyOf: [{ type: "number" }, { type: "string" }],
                description:
                    "Optional internal ID of the recipient record when 'recipientType' is specified."
            },
            customRecordType: {
                type: "string",
                description:
                    "Optional custom record script ID (e.g., 'customrecord_foo') to merge into '${customRecord.*}' fields. If 'customRecordId' is omitted, auto-samples the most recent record of this type."
            },
            customRecordId: {
                anyOf: [{ type: "number" }, { type: "string" }],
                description:
                    "Optional internal ID of the custom record when 'customRecordType' is specified."
            },
            supportCaseId: {
                anyOf: [{ type: "number" }, { type: "string" }],
                description:
                    "Optional internal ID of a support case record to merge."
            }
        },
        required: ["scriptId"]
    },
    execute: async (args: RenderEmailTemplateArgs) => {
        try {
            const rawScriptId = (args?.scriptId || "").trim();
            if (!rawScriptId) {
                return {
                    content: [
                        {
                            type: "text",
                            text: "Error: 'scriptId' is required."
                        }
                    ],
                    isError: true
                };
            }

            const scriptId = normalizeEmailTemplateScriptId(rawScriptId);

            const response = await callNetsuiteRestlet({
                action: "RENDER_EMAIL_TEMPLATE",
                scriptId,
                ...(args.transactionId !== undefined && args.transactionId !== null
                    ? { transactionId: args.transactionId }
                    : {}),
                ...(args.transactionType ? { transactionType: args.transactionType.trim() } : {}),
                ...(args.entityType ? { entityType: args.entityType.trim() } : {}),
                ...(args.entityId !== undefined && args.entityId !== null
                    ? { entityId: args.entityId }
                    : {}),
                ...(args.recipientType ? { recipientType: args.recipientType.trim() } : {}),
                ...(args.recipientId !== undefined && args.recipientId !== null
                    ? { recipientId: args.recipientId }
                    : {}),
                ...(args.customRecordType
                    ? { customRecordType: args.customRecordType.trim() }
                    : {}),
                ...(args.customRecordId !== undefined && args.customRecordId !== null
                    ? { customRecordId: args.customRecordId }
                    : {}),
                ...(args.supportCaseId !== undefined && args.supportCaseId !== null
                    ? { supportCaseId: args.supportCaseId }
                    : {})
            });

            if (!response || !response.success) {
                return {
                    content: [
                        {
                            type: "text",
                            text:
                                response?.errorMessage ||
                                "NetSuite RESTlet RENDER_EMAIL_TEMPLATE failed."
                        }
                    ],
                    isError: true
                };
            }

            const subject = String(response.subject ?? "");
            const body = String(response.body ?? "");

            const previewFilePath = await writeManagedTemplatePreviewFile(
                `${scriptId}.html`,
                body
            );
            const fileUri = pathToFileURL(previewFilePath).href;

            const payload = {
                success: true,
                scriptId,
                templateId: response.templateId,
                ...(response.templateName ? { templateName: response.templateName } : {}),
                boundRecords: response.boundRecords || {},
                subject,
                body,
                previewFilePath,
                timeElapsedMS: response.timeElapsedMS,
                governanceUsed: response.governanceUsed
            };

            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(payload, null, 2)
                    },
                    {
                        type: "resource",
                        resource: {
                            uri: fileUri,
                            mimeType: "text/html",
                            text: body
                        }
                    }
                ]
            };
        } catch (error: any) {
            return {
                content: [
                    {
                        type: "text",
                        text: `Error rendering Email Template: ${error.message}`
                    }
                ],
                isError: true
            };
        }
    }
};
