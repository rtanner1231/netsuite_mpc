import fs from "fs/promises";
import { ToolDefinition } from "../types/index.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { getProjectRoot } from "../utils/mcp.js";
import { getProjectConfig } from "../utils/project.js";
import { withTempSdfProject } from "../utils/tempSdfProject.js";
import {
    downloadSdfObjectInTempProject,
    getSaveToProjectSchemaProperty
} from "../utils/objects.js";
import {
    deployTranslationCollectionFromTempProject,
    parseTranslationCollectionXml,
    toSdfLocale
} from "../utils/translations.js";
import { callNetsuiteRestlet } from "../utils/api.js";

type UpdateTranslationStringInput = {
    scriptId: string;
    defaultTranslation?: string;
    description?: string;
    translations?: Record<string, string>;
};

type UpdateTranslationCollectionArgs = {
    scriptId: string;
    name?: string;
    description?: string;
    strings?: UpdateTranslationStringInput[];
    saveToProject?: boolean;
};

export const updateTranslationCollectionTool: ToolDefinition = {
    name: "netsuite_update_translation_collection",
    description:
        "Updates an existing NetSuite Translation Collection (custcollection_*) via an isolated temporary SDF project. Downloads the latest XML definition from NetSuite, retrieves existing translations via the RESTlet (N/translation) for any modified locales so existing translations are preserved, merges new/updated strings and locale translations, deploys the updated XML and .xlf files, and optionally copies them into the local project. Note: Existing strings can be updated and new strings can be added, but NetSuite SDF Account Customization Projects do not support deleting existing strings or changing the collection's defaultLanguage after creation.",
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
                    "The script ID of the existing translation collection (e.g. 'custcollection_my_translations')."
            },
            name: {
                type: "string",
                description: "(Optional) Updated display name of the translation collection."
            },
            description: {
                type: "string",
                description: "(Optional) Updated description of the translation collection."
            },
            strings: {
                type: "array",
                description:
                    "(Optional) Array of strings to add or update in the collection. Existing strings are matched by 'scriptId' and merged; new 'scriptId' entries are appended. Existing strings cannot be deleted via SDF.",
                items: {
                    type: "object",
                    properties: {
                        scriptId: {
                            type: "string",
                            description: "The script ID of the string within the collection."
                        },
                        defaultTranslation: {
                            type: "string",
                            description:
                                "The text value in the collection's default language. Required when adding a new string; optional when only updating non-default translations or description of an existing string."
                        },
                        description: {
                            type: "string",
                            description: "(Optional) Updated description for translators."
                        },
                        translations: {
                            type: "object",
                            description:
                                "(Optional) Map of locale code (e.g. 'es-ES', 'fr-FR') to translated text to add or overwrite for this string.",
                            additionalProperties: {
                                type: "string"
                            }
                        }
                    },
                    required: ["scriptId"]
                }
            },
            saveToProject: getSaveToProjectSchemaProperty()
        },
        required: ["scriptId"]
    },
    execute: async (args: UpdateTranslationCollectionArgs, server: Server) => {
        try {
            const rawScriptId = (args?.scriptId || "").trim();
            if (!rawScriptId) {
                return {
                    content: [{ type: "text", text: "Error: 'scriptId' is required." }]
                };
            }

            const scriptId = rawScriptId.toLowerCase().endsWith(".xml")
                ? rawScriptId.slice(0, -4)
                : rawScriptId;

            const projectRoot = await getProjectRoot(server);
            const projectConfig = await getProjectConfig(projectRoot);

            return await withTempSdfProject(
                {
                    projectRoot,
                    projectConfig,
                    tempDirPrefix: "netsuite-mcp-tc-update-"
                },
                async (tempProject) => {
                    // 1. Download current XML definition via SDF
                    const downloadedPath = await downloadSdfObjectInTempProject(
                        tempProject,
                        scriptId,
                        "translationcollection"
                    );
                    const xmlContent = await fs.readFile(downloadedPath, "utf-8");
                    const collection = parseTranslationCollectionXml(xmlContent, scriptId);

                    // 2. Collect all locales being updated across the incoming strings
                    const affectedLocalesSet = new Set<string>();
                    const incomingStrings = Array.isArray(args.strings) ? args.strings : [];

                    for (const strInput of incomingStrings) {
                        if (strInput.translations && typeof strInput.translations === "object") {
                            for (const rawLocale of Object.keys(strInput.translations)) {
                                affectedLocalesSet.add(toSdfLocale(rawLocale));
                            }
                        }
                    }

                    // 3. If any locales are being updated, fetch existing translations for those locales
                    // from NetSuite via the RESTlet so existing string translations in those .xlf files are preserved
                    const existingKeys = collection.strings.map((s) => s.scriptId);
                    const affectedLocales = Array.from(affectedLocalesSet);
                    let existingTranslationsByKey: Record<string, Record<string, string>> = {};

                    if (existingKeys.length > 0 && affectedLocales.length > 0) {
                        try {
                            const restletResp = await callNetsuiteRestlet({
                                action: "GET_TRANSLATIONS",
                                collectionId: collection.scriptId,
                                keys: existingKeys,
                                locales: affectedLocales,
                                defaultLocale: collection.defaultLanguage
                            });

                            if (restletResp && restletResp.success && restletResp.translations) {
                                existingTranslationsByKey = restletResp.translations;
                            }
                        } catch {
                            // Continue with merge if RESTlet is unreachable
                        }
                    }

                    // Populate existing strings with any fetched translations for affected locales
                    for (const existingStr of collection.strings) {
                        const fetched = existingTranslationsByKey[existingStr.scriptId];
                        if (fetched && typeof fetched === "object") {
                            existingStr.translations = {
                                ...(existingStr.translations || {}),
                                ...fetched
                            };
                        }
                    }

                    // 4. Update collection header fields
                    if (args.name !== undefined) {
                        collection.name = args.name;
                    }
                    if (args.description !== undefined) {
                        collection.description = args.description;
                    }

                    // 5. Upsert incoming strings and merge their per-locale translations
                    for (const incoming of incomingStrings) {
                        const cleanId = (incoming.scriptId || "").trim();
                        if (!cleanId) continue;

                        const existingEntry = collection.strings.find(
                            (s) => s.scriptId.toLowerCase() === cleanId.toLowerCase()
                        );

                        const normalizedIncomingTranslations: Record<string, string> = {};
                        if (incoming.translations && typeof incoming.translations === "object") {
                            for (const [loc, val] of Object.entries(incoming.translations)) {
                                if (val !== undefined && val !== null) {
                                    normalizedIncomingTranslations[toSdfLocale(loc)] = String(val);
                                }
                            }
                        }

                        if (existingEntry) {
                            if (incoming.defaultTranslation !== undefined) {
                                existingEntry.defaultTranslation = incoming.defaultTranslation;
                            }
                            if (incoming.description !== undefined) {
                                existingEntry.description = incoming.description;
                            }
                            if (Object.keys(normalizedIncomingTranslations).length > 0) {
                                existingEntry.translations = {
                                    ...(existingEntry.translations || {}),
                                    ...normalizedIncomingTranslations
                                };
                            }
                        } else {
                            if (incoming.defaultTranslation === undefined) {
                                return {
                                    content: [
                                        {
                                            type: "text",
                                            text: `Error: 'defaultTranslation' is required when adding a new string ('${cleanId}') to '${collection.scriptId}'.`
                                        }
                                    ]
                                };
                            }

                            collection.strings.push({
                                scriptId: cleanId,
                                defaultTranslation: incoming.defaultTranslation,
                                ...(incoming.description !== undefined
                                    ? { description: incoming.description }
                                    : {}),
                                ...(Object.keys(normalizedIncomingTranslations).length > 0
                                    ? { translations: normalizedIncomingTranslations }
                                    : {})
                            });
                        }
                    }

                    // 7. Deploy the updated XML and XLIFF files via SDF
                    const output = await deployTranslationCollectionFromTempProject({
                        tempProject,
                        projectRoot,
                        collection,
                        options: {
                            saveToProject: args.saveToProject,
                            rootElement: "translationcollection",
                            projectConfig
                        }
                    });

                    return { content: [{ type: "text", text: output }] };
                }
            );
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
