import fs from "fs/promises";
import path from "path";
import util from "util";
import { exec } from "child_process";
import { create } from "xmlbuilder2";
import { TempSdfProject, withTempSdfProject } from "./tempSdfProject.js";
import { runSdfDeployInDir } from "./deploy.js";
import { getProjectConfig, ProjectConfig, resolveEffectiveSaveToProject } from "./project.js";
import { DeploySdfObjectOptions, syncSdfObjectToMainProject } from "./objects.js";

const execAsync = util.promisify(exec);

export interface TranslationStringDefinition {
    scriptId: string;
    defaultTranslation: string;
    description?: string;
    translations?: Record<string, string>;
}

export interface ParsedTranslationCollection {
    scriptId: string;
    name: string;
    nameTranslate?: boolean;
    defaultLanguage: string;
    description?: string;
    descriptionTranslate?: boolean;
    strings: TranslationStringDefinition[];
}

export interface XliffStringEntry {
    scriptId: string;
    source: string;
    target: string;
    description?: string;
}

/**
 * Normalizes a locale identifier to NetSuite SDF/XLIFF hyphenated format (e.g. "en_US" -> "en-US").
 */
export const toSdfLocale = (rawLocale: string): string => {
    const trimmed = rawLocale.trim();
    const parts = trimmed.split(/[-_]/);
    if (parts.length === 2 && parts[0].length >= 2 && parts[1].length >= 2) {
        return `${parts[0].toLowerCase()}-${parts[1].toUpperCase()}`;
    }
    return trimmed.replace(/_/g, "-");
};

/**
 * Normalizes a locale identifier to NetSuite N/translation underscore format (e.g. "en-US" -> "en_US").
 */
export const toNetsuiteLocale = (rawLocale: string): string => {
    const trimmed = rawLocale.trim();
    const parts = trimmed.split(/[-_]/);
    if (parts.length === 2 && parts[0].length >= 2 && parts[1].length >= 2) {
        return `${parts[0].toLowerCase()}_${parts[1].toUpperCase()}`;
    }
    return trimmed.replace(/-/g, "_");
};

/**
 * Runs `suitecloud object:list --type translationcollection` inside a temporary SDF project
 * and parses the returned script IDs.
 */
export const listSdfTranslationCollections = async (
    projectRoot: string,
    projectConfig?: ProjectConfig
): Promise<{ scriptIds: string[]; rawOutput: string }> => {
    const resolvedConfig = projectConfig ?? (await getProjectConfig(projectRoot));

    return withTempSdfProject(
        {
            projectRoot,
            projectConfig: resolvedConfig,
            tempDirPrefix: "netsuite-mcp-tc-list-"
        },
        async (tempProject) => {
            const { stdout } = await execAsync(
                `suitecloud object:list --type translationcollection`,
                { cwd: tempProject.tempDir }
            );

            const scriptIds: string[] = [];
            const seen = new Set<string>();

            for (const rawLine of stdout.split(/\r?\n/)) {
                const line = rawLine.trim();
                if (!line) continue;

                // SuiteCloud CLI outputs either `custcollection_foo` or `translationcollection:custcollection_foo`
                const match = line.match(/(?:^|:)(custcollection_[a-zA-Z0-9_]+)$/i);
                if (match && match[1]) {
                    const id = match[1].toLowerCase();
                    if (!seen.has(id)) {
                        seen.add(id);
                        scriptIds.push(match[1]);
                    }
                }
            }

            return {
                scriptIds,
                rawOutput: stdout.trim()
            };
        }
    );
};

/**
 * Extracts text and optional `@translate` flag from an xmlbuilder2 parsed node
 * (which may be a plain string, number, or an object like `{ "@translate": "T", "#": "..." }`).
 */
const extractNodeTextAndTranslateAttr = (
    node: any
): { text: string; translate?: boolean } => {
    if (node == null) {
        return { text: "" };
    }
    if (typeof node === "string" || typeof node === "number" || typeof node === "boolean") {
        return { text: String(node) };
    }
    if (typeof node === "object") {
        const text = node["#"] != null ? String(node["#"]) : "";
        const translateAttr = node["@translate"];
        const translate =
            translateAttr === "T" ? true : translateAttr === "F" ? false : undefined;
        return { text, translate };
    }
    return { text: "" };
};

/**
 * Parses an SDF `<translationcollection>` XML string into a structured object.
 */
export const parseTranslationCollectionXml = (
    xmlContent: string,
    fallbackScriptId = ""
): ParsedTranslationCollection => {
    const obj = create(xmlContent).toObject() as any;
    const tc = obj?.translationcollection;

    if (!tc || typeof tc !== "object") {
        throw new Error("Could not parse <translationcollection> root element from XML.");
    }

    const scriptId = String(tc["@scriptid"] || fallbackScriptId).trim();
    const { text: name, translate: nameTranslate } = extractNodeTextAndTranslateAttr(tc.name);
    const { text: defaultLanguageRaw } = extractNodeTextAndTranslateAttr(tc.defaultlanguage);
    const defaultLanguage = defaultLanguageRaw ? toSdfLocale(defaultLanguageRaw) : "en-US";

    let description: string | undefined;
    let descriptionTranslate: boolean | undefined;
    if (tc.description !== undefined) {
        const extractedDesc = extractNodeTextAndTranslateAttr(tc.description);
        description = extractedDesc.text;
        descriptionTranslate = extractedDesc.translate;
    }

    const strings: TranslationStringDefinition[] = [];
    const rawStringsNode = tc.strings?.string;
    const rawStringsArray =
        rawStringsNode == null
            ? []
            : Array.isArray(rawStringsNode)
              ? rawStringsNode
              : [rawStringsNode];

    for (const item of rawStringsArray) {
        if (!item || typeof item !== "object") continue;
        const strScriptId = item["@scriptid"] != null ? String(item["@scriptid"]).trim() : "";
        if (!strScriptId) continue;

        const { text: defaultTranslation } = extractNodeTextAndTranslateAttr(
            item.defaulttranslation
        );
        const strDesc =
            item.description !== undefined
                ? extractNodeTextAndTranslateAttr(item.description).text
                : undefined;

        strings.push({
            scriptId: strScriptId,
            defaultTranslation,
            ...(strDesc !== undefined ? { description: strDesc } : {})
        });
    }

    return {
        scriptId,
        name,
        ...(nameTranslate !== undefined ? { nameTranslate } : {}),
        defaultLanguage,
        ...(description !== undefined ? { description } : {}),
        ...(descriptionTranslate !== undefined ? { descriptionTranslate } : {}),
        strings
    };
};

/**
 * Generates an SDF `<translationcollection>` XML string from a `ParsedTranslationCollection`.
 */
export const buildTranslationCollectionXml = (
    collection: ParsedTranslationCollection
): string => {
    const tcObj: Record<string, any> = {
        "@scriptid": collection.scriptId
    };

    if (collection.nameTranslate !== undefined) {
        tcObj.name = {
            "@translate": collection.nameTranslate ? "T" : "F",
            "#": collection.name
        };
    } else {
        tcObj.name = collection.name;
    }

    tcObj.defaultlanguage = toSdfLocale(collection.defaultLanguage || "en-US");

    if (collection.description !== undefined) {
        if (collection.descriptionTranslate !== undefined) {
            tcObj.description = {
                "@translate": collection.descriptionTranslate ? "T" : "F",
                "#": collection.description
            };
        } else {
            tcObj.description = collection.description;
        }
    }

    if (collection.strings && collection.strings.length > 0) {
        tcObj.strings = {
            string: collection.strings.map((s) => {
                const strNode: Record<string, any> = {
                    "@scriptid": s.scriptId,
                    defaulttranslation: s.defaultTranslation
                };
                if (s.description !== undefined) {
                    strNode.description = s.description;
                }
                return strNode;
            })
        };
    } else {
        tcObj.strings = {};
    }

    const doc = create(
        { version: "1.0", encoding: "UTF-8" },
        { translationcollection: tcObj }
    );
    return doc.end({ prettyPrint: true });
};

/**
 * Strips characters that are illegal in XML 1.0 documents (which cause fatal SAX parse errors).
 */
const sanitizeXmlText = (value: unknown): string => {
    if (value == null) return "";
    return String(value).replace(
        /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g,
        ""
    );
};

/**
 * Normalizes a translation string scriptId for use as a `<trans-unit id="...">` attribute.
 */
const normalizeTransUnitId = (rawId: string, collectionScriptId: string): string => {
    let id = rawId.trim();

    // Unwrap `[scriptid=custcollection_foo.bar]` if passed in SDF reference format
    const refMatch = id.match(/^\[scriptid=([^\]]+)\]$/i);
    if (refMatch) {
        id = refMatch[1].trim();
    }

    const prefix = `${collectionScriptId}.`;
    if (id.toLowerCase().startsWith(prefix.toLowerCase())) {
        id = id.slice(prefix.length);
    }

    return id.trim();
};

/**
 * Builds an SDF-compatible XLIFF 1.2 XML string for a specific target locale.
 */
export const buildXliffContent = (args: {
    collectionScriptId: string;
    collectionDescription?: string;
    sourceLanguage: string;
    targetLanguage: string;
    entries: XliffStringEntry[];
}): string => {
    const sourceLang = toSdfLocale(args.sourceLanguage);
    const targetLang = toSdfLocale(args.targetLanguage);
    const collectionId = args.collectionScriptId.trim();
    const cleanCollectionDesc =
        args.collectionDescription !== undefined
            ? sanitizeXmlText(args.collectionDescription)
            : "";

    const transUnits = args.entries.map((entry) => {
        const cleanId = normalizeTransUnitId(entry.scriptId, collectionId);
        if (!cleanId) {
            throw new Error(`Invalid empty translation unit ID in collection "${collectionId}".`);
        }

        const sourceText = sanitizeXmlText(entry.source);
        const targetText = sanitizeXmlText(entry.target);

        if (!sourceText.trim()) {
            throw new Error(
                `Translation unit "${cleanId}" in "${collectionId}" has an empty <source> string.`
            );
        }

        const unit: Record<string, any> = {
            "@id": cleanId,
            source: sourceText,
            target: targetText
        };

        const notes: Array<Record<string, any>> = [];
        const cleanDesc =
            entry.description !== undefined ? sanitizeXmlText(entry.description) : "";
        if (cleanDesc !== "") {
            notes.push({
                "@from": "string description",
                "#": cleanDesc
            });
        }
        if (cleanCollectionDesc !== "") {
            notes.push({
                "@from": "collection description",
                "#": cleanCollectionDesc
            });
        }

        if (notes.length > 0) {
            unit.note = notes;
        }

        return unit;
    });

    const xliffObj = {
        xliff: {
            "@xmlns:ns": "netsuite",
            "@xmlns:ns3": "urn:oasis:names:tc:xliff:document:1.2",
            "@version": "1.2",
            file: {
                "@original": "netsuite-database",
                "@source-language": sourceLang,
                "@target-language": targetLang,
                "@datatype": "database",
                body: {
                    group: {
                        "@ns:collection": collectionId,
                        "trans-unit": transUnits
                    }
                }
            }
        }
    };

    const doc = create({ version: "1.0", encoding: "UTF-8", standalone: true }, xliffObj);
    return doc.end({ prettyPrint: true });
};

/**
 * Extracts per-locale XLIFF files from a `ParsedTranslationCollection` whose `strings`
 * contain `translations: Record<locale, translatedText>`.
 */
export const buildXliffFilesByLocale = (
    collection: ParsedTranslationCollection
): Map<string, string> => {
    const defaultLocale = toSdfLocale(collection.defaultLanguage || "en-US");
    const entriesByLocale = new Map<string, XliffStringEntry[]>();

    for (const str of collection.strings) {
        if (!str.translations || typeof str.translations !== "object") continue;

        const cleanSource = sanitizeXmlText(str.defaultTranslation);
        if (!cleanSource.trim()) continue;

        for (const [rawLocale, translatedText] of Object.entries(str.translations)) {
            if (translatedText === undefined || translatedText === null) continue;
            const cleanTarget = sanitizeXmlText(translatedText);
            if (cleanTarget === "") continue;

            const targetLocale = toSdfLocale(rawLocale);
            // The default language is already stored in <defaulttranslation> inside the XML
            if (targetLocale.toLowerCase() === defaultLocale.toLowerCase()) {
                continue;
            }

            if (!entriesByLocale.has(targetLocale)) {
                entriesByLocale.set(targetLocale, []);
            }
            entriesByLocale.get(targetLocale)!.push({
                scriptId: str.scriptId,
                source: cleanSource,
                target: cleanTarget,
                ...(str.description !== undefined ? { description: str.description } : {})
            });
        }
    }

    const xliffByLocale = new Map<string, string>();
    for (const [targetLocale, entries] of entriesByLocale.entries()) {
        if (entries.length === 0) continue;
        const xliffXml = buildXliffContent({
            collectionScriptId: collection.scriptId,
            collectionDescription: collection.description,
            sourceLanguage: defaultLocale,
            targetLanguage: targetLocale,
            entries
        });
        xliffByLocale.set(targetLocale, xliffXml);
    }

    return xliffByLocale;
};

/**
 * Deploys a translation collection XML and its associated `.xlf` files from a `TempSdfProject`,
 * and optionally syncs both the XML and XLIFF files into the local project.
 */
export const deployTranslationCollectionFromTempProject = async (args: {
    tempProject: TempSdfProject;
    projectRoot: string;
    collection: ParsedTranslationCollection;
    options?: DeploySdfObjectOptions;
}): Promise<string> => {
    const { tempProject, projectRoot, collection, options } = args;
    const projectConfig = options?.projectConfig ?? (await getProjectConfig(projectRoot));

    const xmlContent = buildTranslationCollectionXml(collection);
    const xliffByLocale = buildXliffFilesByLocale(collection);

    // 1. Write the collection XML to <tempDir>/Objects/<scriptId>.xml
    const tempObjectPath = tempProject.getLocalObjectPath(collection.scriptId);
    await fs.mkdir(path.dirname(tempObjectPath), { recursive: true });
    await fs.writeFile(tempObjectPath, xmlContent, "utf-8");

    // 2. Write each locale's .xlf file to <tempDir>/Translations/<scriptId>.<locale>.xlf
    const deployTranslationPaths: string[] = [];
    for (const [locale, xliffContent] of xliffByLocale.entries()) {
        const tempXliffPath = tempProject.getLocalTranslationPath(collection.scriptId, locale);
        await fs.mkdir(path.dirname(tempXliffPath), { recursive: true });
        await fs.writeFile(tempXliffPath, xliffContent, "utf-8");
        deployTranslationPaths.push(`~/Translations/${path.basename(tempXliffPath)}`);
    }

    // 3. Configure deploy.xml
    const objectFileName = path.basename(tempObjectPath);
    await tempProject.setDeployConfig({
        objects: [`~/Objects/${objectFileName}`],
        ...(deployTranslationPaths.length > 0 ? { translations: deployTranslationPaths } : {})
    });

    // 4. Run suitecloud project:deploy
    const deployResult = await runSdfDeployInDir(tempProject.tempDir);
    if (!deployResult.success) {
        return deployResult.output;
    }

    // 5. Sync to main project if saveToProject is enabled
    const effectiveSaveInfo = await resolveEffectiveSaveToProject(projectRoot, projectConfig);
    const shouldSave =
        typeof options?.saveToProject === "boolean"
            ? options.saveToProject
            : effectiveSaveInfo.effectiveDefault;

    if (shouldSave) {
        const syncResult = await syncSdfObjectToMainProject({
            projectRoot,
            sdfSrcDir: effectiveSaveInfo.sdfSrcDir,
            scriptId: collection.scriptId,
            xmlContent,
            strategy: effectiveSaveInfo.objectsFolderStrategy,
            explicitSubFolder: options?.subFolder,
            rootElement: options?.rootElement ?? "translationcollection"
        });

        const savedXliffRelativePaths: string[] = [];
        if (xliffByLocale.size > 0) {
            const projectTranslationsDir = path.join(effectiveSaveInfo.sdfSrcDir, "Translations");
            await fs.mkdir(projectTranslationsDir, { recursive: true });

            for (const [locale, xliffContent] of xliffByLocale.entries()) {
                const fileName = `${collection.scriptId}.${locale}.xlf`;
                const targetXliffPath = path.join(projectTranslationsDir, fileName);
                await fs.writeFile(targetXliffPath, xliffContent, "utf-8");
                savedXliffRelativePaths.push(
                    path.relative(projectRoot, targetXliffPath) || targetXliffPath
                );
            }
        }

        const actionLabel = syncResult.updatedExisting
            ? "Updated existing project file"
            : "Saved to project";
        const xliffNote =
            savedXliffRelativePaths.length > 0
                ? `\n[Saved XLIFF translations: ${savedXliffRelativePaths.join(", ")}]`
                : "";

        return `${deployResult.output}\n[${actionLabel}: ${syncResult.relativePath}]${xliffNote}`;
    }

    const skipReason =
        typeof options?.saveToProject === "boolean"
            ? "saveToProject=false"
            : effectiveSaveInfo.reason;
    return `${deployResult.output}\n[Background deployment only — XML/XLIFF files were not copied to the local project (${skipReason}).]`;
};
