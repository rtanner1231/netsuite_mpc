import { ToolDefinition } from "../types/index.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { getProjectRoot } from "../utils/mcp.js";
import { getProjectConfig } from "../utils/project.js";
import { withTempSdfProject } from "../utils/tempSdfProject.js";
import { getSaveToProjectSchemaProperty } from "../utils/objects.js";
import {
    deployTranslationCollectionFromTempProject,
    ParsedTranslationCollection,
    toSdfLocale,
    TranslationStringDefinition
} from "../utils/translations.js";

type CreateTranslationCollectionArgs = {
    scriptId: string;
    name: string;
    defaultLanguage?: string;
    description?: string;
    strings: TranslationStringDefinition[];
    saveToProject?: boolean;
};

export const createTranslationCollectionTool: ToolDefinition = {
    name: "netsuite_create_translation_collection",
    description:
        "Creates and deploys a new NetSuite Translation Collection (custcollection_*) and any non-default language XLIFF (.xlf) translation files via an isolated temporary SDF project, and optionally copies the XML and .xlf files into the local project.",
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
                    "The script ID of the translation collection. Must start with 'custcollection_' (e.g. 'custcollection_my_translations')."
            },
            name: {
                type: "string",
                description: "The display name of the translation collection."
            },
            defaultLanguage: {
                type: "string",
                description:
                    "Optional default language locale code in SDF format (e.g. 'en-US'). Defaults to 'en-US'."
            },
            description: {
                type: "string",
                description: "Optional description of the translation collection."
            },
            strings: {
                type: "array",
                description:
                    "Array of translation strings to include in the collection, along with optional non-default locale translations.",
                items: {
                    type: "object",
                    properties: {
                        scriptId: {
                            type: "string",
                            description:
                                "The script ID of the string within the collection (e.g. 'btn_save' or 'hello_msg')."
                        },
                        defaultTranslation: {
                            type: "string",
                            description: "The text value in the collection's default language."
                        },
                        description: {
                            type: "string",
                            description:
                                "Optional description or context for translators for this string."
                        },
                        translations: {
                            type: "object",
                            description:
                                "Optional map of locale code (e.g. 'es-ES', 'fr-FR') to translated text for this string.",
                            additionalProperties: {
                                type: "string"
                            }
                        }
                    },
                    required: ["scriptId", "defaultTranslation"]
                }
            },
            saveToProject: getSaveToProjectSchemaProperty()
        },
        required: ["scriptId", "name", "strings"]
    },
    execute: async (args: CreateTranslationCollectionArgs, server: Server) => {
        try {
            const rawScriptId = (args?.scriptId || "").trim();
            if (!rawScriptId.toLowerCase().startsWith("custcollection_")) {
                return {
                    content: [
                        {
                            type: "text",
                            text: "Error: 'scriptId' must start with 'custcollection_'."
                        }
                    ]
                };
            }

            const scriptId = rawScriptId.toLowerCase().endsWith(".xml")
                ? rawScriptId.slice(0, -4)
                : rawScriptId;

            const defaultLanguage = toSdfLocale(args.defaultLanguage || "en-US");

            const collection: ParsedTranslationCollection = {
                scriptId,
                name: args.name,
                defaultLanguage,
                ...(args.description !== undefined ? { description: args.description } : {}),
                strings: (args.strings || []).map((s) => ({
                    scriptId: s.scriptId.trim(),
                    defaultTranslation: s.defaultTranslation,
                    ...(s.description !== undefined ? { description: s.description } : {}),
                    ...(s.translations ? { translations: s.translations } : {})
                }))
            };

            const projectRoot = await getProjectRoot(server);
            const projectConfig = await getProjectConfig(projectRoot);

            const output = await withTempSdfProject(
                {
                    projectRoot,
                    projectConfig,
                    tempDirPrefix: "netsuite-mcp-tc-create-"
                },
                async (tempProject) => {
                    return deployTranslationCollectionFromTempProject({
                        tempProject,
                        projectRoot,
                        collection,
                        options: {
                            saveToProject: args.saveToProject,
                            rootElement: "translationcollection",
                            projectConfig
                        }
                    });
                }
            );

            return { content: [{ type: "text", text: output }] };
        } catch (error: any) {
            return {
                content: [
                    {
                        type: "text",
                        text: `Unexpected Tool Error: ${error.message}`
                    }
                ]
            };
        }
    }
};
