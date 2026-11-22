import { ToolDefinition } from "../types/index.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { getProjectRoot } from "../utils/mcp.js";
import { downloadSdfObjectXml } from "../utils/objects.js";
import { parseTranslationCollectionXml, toSdfLocale } from "../utils/translations.js";
import { callNetsuiteRestlet } from "../utils/api.js";

type ViewTranslationCollectionArgs = {
    scriptId: string;
    locales?: string[];
};

export const viewTranslationCollectionTool: ToolDefinition = {
    name: "netsuite_view_translation_collection",
    description:
        "Downloads a Translation Collection XML definition (custcollection_*) via SDF to inspect its strings, default translations, and descriptions, and calls the MCP Services RESTlet using N/translation to fetch the translated values across requested or active NetSuite locales. Note: Because NetSuite's N/translation API falls back to returning the default language string when a locale has no translation, any non-default locale whose resolved string matches the defaultTranslation is reported as an empty string (\"\"); this means either the locale is untranslated or its translation is identical to the default language.",
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
                    "The script ID of the translation collection (e.g. 'custcollection_my_translations')."
            },
            locales: {
                type: "array",
                items: {
                    type: "string"
                },
                description:
                    "Optional array of locale codes (e.g. ['es-ES', 'fr-FR']) to retrieve translations for. If omitted, automatically queries active languages configured in the NetSuite environment."
            }
        },
        required: ["scriptId"]
    },
    execute: async (args: ViewTranslationCollectionArgs, server: Server) => {
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

            const scriptId = rawScriptId.toLowerCase().endsWith(".xml")
                ? rawScriptId.slice(0, -4)
                : rawScriptId;

            const projectRoot = await getProjectRoot(server);

            // 1. Download the <translationcollection> XML via SDF
            const xmlContent = await downloadSdfObjectXml(
                projectRoot,
                scriptId,
                "translationcollection"
            );

            // 2. Parse the XML definition
            const parsed = parseTranslationCollectionXml(xmlContent, scriptId);
            const keys = parsed.strings.map((s) => s.scriptId);

            // 3. Call the RESTlet to resolve actual translations via N/translation
            let restletTranslations: Record<string, Record<string, string>> = {};
            let localesChecked: string[] = [];
            let restletWarning: string | undefined;

            if (keys.length > 0) {
                try {
                    const response = await callNetsuiteRestlet({
                        action: "GET_TRANSLATIONS",
                        collectionId: parsed.scriptId,
                        keys,
                        locales:
                            Array.isArray(args.locales) && args.locales.length > 0
                                ? args.locales.map(toSdfLocale)
                                : undefined,
                        defaultLocale: parsed.defaultLanguage
                    });

                    if (response && response.success) {
                        restletTranslations = response.translations || {};
                        localesChecked = Array.isArray(response.localesChecked)
                            ? response.localesChecked
                            : [];
                    } else {
                        restletWarning =
                            response?.errorMessage ||
                            "RESTlet GET_TRANSLATIONS did not return success; showing default translations from SDF XML only.";
                    }
                } catch (restletErr: any) {
                    restletWarning = `Could not fetch non-default translations from RESTlet (${restletErr.message}); showing default translations from SDF XML only.`;
                }
            }

            // 4. Merge XML definition with N/translation values
            const defaultLangSdf = toSdfLocale(parsed.defaultLanguage);
            const enrichedStrings = parsed.strings.map((str) => {
                const perLocale = { ...(restletTranslations[str.scriptId] || {}) };
                if (perLocale[defaultLangSdf] === undefined) {
                    perLocale[defaultLangSdf] = str.defaultTranslation;
                }

                return {
                    scriptId: str.scriptId,
                    defaultTranslation: str.defaultTranslation,
                    ...(str.description !== undefined ? { description: str.description } : {}),
                    translations: perLocale
                };
            });

            const resultPayload: Record<string, any> = {
                scriptId: parsed.scriptId,
                name: parsed.name,
                defaultLanguage: parsed.defaultLanguage,
                ...(parsed.description !== undefined ? { description: parsed.description } : {}),
                localesChecked,
                stringsCount: enrichedStrings.length,
                strings: enrichedStrings,
                ...(restletWarning ? { warning: restletWarning } : {})
            };

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
                        text: `Error viewing translation collection: ${error.message}`
                    }
                ]
            };
        }
    }
};
