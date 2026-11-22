import { ToolDefinition } from "../types/index.js";
import { callNetsuiteRestlet } from "../utils/api.js";

type ListSupportedLocalesArgs = {
    includeAllStandardLocales?: boolean;
};

export const listSupportedLocalesTool: ToolDefinition = {
    name: "netsuite_list_supported_locales",
    description:
        "Returns the active/supported languages (locales) configured in the current NetSuite environment, including their SDF/XLIFF locale code (e.g. 'es-ES'), SuiteScript N/translation locale code (e.g. 'es_ES'), display name, and which locale is the environment's default language. Call this before creating or updating a translation collection when you need to know which languages the NetSuite environment supports.",
    meta: {
        isDestructive: false,
        requiresSdf: false
    },
    inputSchema: {
        type: "object",
        properties: {
            includeAllStandardLocales: {
                type: "boolean",
                description:
                    "Optional. If true, also includes the full list of standard NetSuite N/translation.Locale enum values alongside the account's active configured locales. Defaults to false."
            }
        }
    },
    execute: async (args: ListSupportedLocalesArgs) => {
        try {
            const response = await callNetsuiteRestlet({
                action: "GET_SUPPORTED_LOCALES"
            });

            if (!response || !response.success) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `Failed to retrieve supported locales: ${response?.errorMessage || "Unknown error"}`
                        }
                    ]
                };
            }

            const activeLocales = Array.isArray(response.activeLocales)
                ? response.activeLocales
                : [];
            const standardLocales = Array.isArray(response.standardLocales)
                ? response.standardLocales
                : [];

            const includeStandard =
                args?.includeAllStandardLocales === true || activeLocales.length === 0;

            const resultPayload: Record<string, any> = {
                defaultLocale: response.defaultLocale ?? null,
                activeLocalesCount: activeLocales.length,
                activeLocales
            };

            if (includeStandard) {
                resultPayload.standardLocalesCount = standardLocales.length;
                resultPayload.standardLocales = standardLocales;
            }

            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(resultPayload, null, 2)
                    }
                ]
            };
        } catch (error: any) {
            return {
                content: [
                    {
                        type: "text",
                        text: `Error retrieving supported locales: ${error.message}`
                    }
                ]
            };
        }
    }
};
