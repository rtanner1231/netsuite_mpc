import fsSync from "fs";
import fs from "fs/promises";
import os from "os";
import path from "path";
import util from "util";
import { exec } from "child_process";
import { create } from "xmlbuilder2";
import { TempSdfProject, withTempSdfProject } from "./tempSdfProject.js";
import { ManifestDependencies, runSdfDeployInDir } from "./deploy.js";
import { getProjectConfig, ProjectConfig, resolveEffectiveSaveToProject } from "./project.js";
import { DeploySdfObjectOptions, syncSdfObjectToMainProject } from "./objects.js";

const execAsync = util.promisify(exec);

export type SdfTemplateType = "advancedpdftemplate" | "emailtemplate";

export const EMAIL_RECORD_TYPES = [
    "CUSTOM",
    "ENTITY",
    "EVENT",
    "PROJECT",
    "TRANSACTION"
] as const;

export type EmailRecordType = (typeof EMAIL_RECORD_TYPES)[number];

export interface ParsedAdvancedPdfTemplate {
    scriptId: string;
    standard: string;
    title: string;
    description?: string;
    trantype?: string;
    printtype?: string;
    recordtype?: string;
    customtransaction?: string;
    savedsearch?: string;
    preferred: boolean;
    displaysourcecode: boolean;
    isinactive: boolean;
    version?: string;
    pdfContent?: string;
    rawXml?: string;
    rawObject?: Record<string, any>;
}

export interface UpsertAdvancedPdfTemplateInput {
    scriptId: string;
    title?: string;
    pdfContent?: string;
    standard?: string;
    trantype?: string;
    printtype?: string;
    recordtype?: string;
    savedsearch?: string;
    preferred?: boolean;
    displaysourcecode?: boolean;
    description?: string;
    isinactive?: boolean;
    saveToProject?: boolean;
}

export interface ParsedEmailTemplate {
    scriptId: string;
    name: string;
    subject?: string;
    description?: string;
    recordtype?: string;
    usesmedia: boolean;
    mediaitem?: string;
    addunsubscribelink: boolean;
    addcompanyaddress: boolean;
    isprivate: boolean;
    isinactive: boolean;
    version?: string;
    htmlContent?: string;
    rawXml?: string;
    rawObject?: Record<string, any>;
}

export interface UpsertEmailTemplateInput {
    scriptId: string;
    name?: string;
    subject?: string;
    htmlContent?: string;
    mediaItemPath?: string;
    recordtype?: EmailRecordType | string;
    addunsubscribelink?: boolean;
    addcompanyaddress?: boolean;
    isprivate?: boolean;
    description?: string;
    isinactive?: boolean;
    saveToProject?: boolean;
}

const fileExists = async (targetPath: string): Promise<boolean> => {
    try {
        await fs.access(targetPath);
        return true;
    } catch {
        return false;
    }
};

/**
 * Normalizes and validates an Advanced PDF Template script ID.
 * Auto-prepends `custtmpl_` if omitted, strips `.template.xml` or `.xml` suffixes,
 * and enforces the SDF max length of 98 characters.
 */
export const normalizeAdvancedPdfScriptId = (rawScriptId: string): string => {
    let id = (rawScriptId || "").trim();
    if (!id) {
        throw new Error("'scriptId' is required.");
    }

    if (id.toLowerCase().endsWith(".template.xml")) {
        id = id.slice(0, -".template.xml".length);
    } else if (id.toLowerCase().endsWith(".xml")) {
        id = id.slice(0, -".xml".length);
    }

    id = id.trim().toLowerCase();
    if (!id) {
        throw new Error("'scriptId' cannot be empty.");
    }

    if (!id.startsWith("custtmpl_")) {
        id = `custtmpl_${id.replace(/^_+/, "")}`;
    }

    if (!/^custtmpl_[a-z0-9_]+$/.test(id)) {
        throw new Error(
            `Invalid Advanced PDF Template scriptId '${id}'. Only lowercase letters, digits, and underscores are allowed after 'custtmpl_'.`
        );
    }

    if (id.length > 98) {
        throw new Error(
            `Advanced PDF Template scriptId '${id}' is ${id.length} characters long, exceeding the NetSuite SDF limit of 98 characters.`
        );
    }

    return id;
};

/**
 * Normalizes and validates an Email Template script ID.
 * Auto-prepends `custemailtmpl_` if omitted, strips `.template.html` or `.xml` suffixes,
 * and enforces the SDF max length of 99 characters.
 */
export const normalizeEmailTemplateScriptId = (rawScriptId: string): string => {
    let id = (rawScriptId || "").trim();
    if (!id) {
        throw new Error("'scriptId' is required.");
    }

    if (id.toLowerCase().endsWith(".template.html")) {
        id = id.slice(0, -".template.html".length);
    } else if (id.toLowerCase().endsWith(".xml")) {
        id = id.slice(0, -".xml".length);
    }

    id = id.trim().toLowerCase();
    if (!id) {
        throw new Error("'scriptId' cannot be empty.");
    }

    if (!id.startsWith("custemailtmpl_")) {
        id = `custemailtmpl_${id.replace(/^_+/, "")}`;
    }

    if (!/^custemailtmpl_[a-z0-9_]+$/.test(id)) {
        throw new Error(
            `Invalid Email Template scriptId '${id}'. Only lowercase letters, digits, and underscores are allowed after 'custemailtmpl_'.`
        );
    }

    if (id.length > 99) {
        throw new Error(
            `Email Template scriptId '${id}' is ${id.length} characters long, exceeding the NetSuite SDF limit of 99 characters.`
        );
    }

    return id;
};

/**
 * Wraps a raw script ID reference (e.g. `customrecord_foo` or `customsearch_foo`) into `[scriptid=...]`,
 * and returns both the formatted SDF attribute value and the raw script ID for `manifest.xml` dependencies.
 */
export const normalizeScriptIdReference = (
    rawRef: string
): { formatted: string; rawId: string } => {
    const trimmed = rawRef.trim();
    const match = trimmed.match(/^\[scriptid=([^\]]+)\]$/i);
    const rawId = (match ? match[1] : trimmed).trim();

    if (!rawId) {
        throw new Error(`Invalid empty scriptId reference: '${rawRef}'.`);
    }

    return {
        formatted: `[scriptid=${rawId}]`,
        rawId
    };
};

/**
 * Normalizes a File Cabinet media item path (e.g., `/Templates/foo.html`, `Templates/foo.html`, or `[/Templates/foo.html]`)
 * into `[/Templates/foo.html]` and validates the extension (`.html`, `.ftl`, `.txt`).
 */
export const normalizeMediaItemPath = (
    rawPath: string
): { formatted: string; fileCabinetPath: string } => {
    let cleaned = rawPath.trim();
    if (!cleaned) {
        throw new Error("'mediaItemPath' cannot be empty.");
    }

    if (cleaned.startsWith("[") && cleaned.endsWith("]")) {
        cleaned = cleaned.slice(1, -1).trim();
    }

    cleaned = cleaned.replace(/\\/g, "/");
    if (!cleaned.startsWith("/")) {
        cleaned = `/${cleaned}`;
    }

    const lower = cleaned.toLowerCase();
    if (!lower.endsWith(".html") && !lower.endsWith(".htm") && !lower.endsWith(".ftl") && !lower.endsWith(".txt")) {
        throw new Error(
            `Invalid mediaItemPath '${rawPath}'. Email template media items must be a File Cabinet path ending in .html, .htm, .ftl, or .txt.`
        );
    }

    return {
        formatted: `[${cleaned}]`,
        fileCabinetPath: cleaned
    };
};

/**
 * Validates BFO XML + FreeMarker content for Advanced PDF Templates.
 */
export const validateBfoPdfContent = (pdfContent: string): void => {
    const trimmed = (pdfContent || "").trim();
    if (!trimmed) {
        throw new Error("'pdfContent' cannot be empty.");
    }

    if (!/<pdf[\s>]/i.test(trimmed) || !/<\/pdf\s*>/i.test(trimmed)) {
        throw new Error(
            "Invalid 'pdfContent': Advanced PDF template content must be valid BFO XML containing a root <pdf>...</pdf> element (e.g., <?xml version=\"1.0\"?><!DOCTYPE pdf PUBLIC \"-//big.faceless.org//report\" \"report-1.1.dtd\"><pdf>...</pdf>)."
        );
    }
};

const extractNodeText = (node: any): string | undefined => {
    if (node === undefined || node === null) return undefined;
    if (typeof node === "string" || typeof node === "number" || typeof node === "boolean") {
        return String(node);
    }
    if (typeof node === "object") {
        if (node["#"] !== undefined && node["#"] !== null) {
            return String(node["#"]);
        }
        return "";
    }
    return undefined;
};

const parseSdfBoolean = (node: any, defaultValue: boolean): boolean => {
    const text = extractNodeText(node);
    if (text === undefined) return defaultValue;
    const upper = text.trim().toUpperCase();
    if (upper === "T" || upper === "TRUE") return true;
    if (upper === "F" || upper === "FALSE") return false;
    return defaultValue;
};

/**
 * Parses an `<advancedpdftemplate>` SDF XML string and optional `.template.xml` body content.
 */
export const parseAdvancedPdfTemplateXml = (
    xmlContent: string,
    pdfContent?: string,
    fallbackScriptId = ""
): ParsedAdvancedPdfTemplate => {
    const obj = create(xmlContent).toObject() as any;
    const root = obj?.advancedpdftemplate;

    if (!root || typeof root !== "object") {
        throw new Error("Could not parse <advancedpdftemplate> root element from XML.");
    }

    const scriptId = String(root["@scriptid"] || fallbackScriptId).trim();
    const standard = root["@standard"] !== undefined ? String(root["@standard"]).trim() : "STDTMPLEMPTY";
    const title = extractNodeText(root.title) ?? "";
    const description = extractNodeText(root.description);
    const trantype = extractNodeText(root.trantype);
    const printtype = extractNodeText(root.printtype);
    const recordtype = extractNodeText(root.recordtype);
    const customtransaction = extractNodeText(root.customtransaction);
    const savedsearch = extractNodeText(root.savedsearch);
    const version = extractNodeText(root.version);

    const preferred = parseSdfBoolean(root.preferred, false);
    const displaysourcecode = parseSdfBoolean(root.displaysourcecode, true);
    const isinactive = parseSdfBoolean(root.isinactive, false);

    return {
        scriptId,
        standard,
        title,
        ...(description !== undefined ? { description } : {}),
        ...(trantype !== undefined ? { trantype } : {}),
        ...(printtype !== undefined ? { printtype } : {}),
        ...(recordtype !== undefined ? { recordtype } : {}),
        ...(customtransaction !== undefined ? { customtransaction } : {}),
        ...(savedsearch !== undefined ? { savedsearch } : {}),
        preferred,
        displaysourcecode,
        isinactive,
        ...(version !== undefined ? { version } : {}),
        ...(pdfContent !== undefined ? { pdfContent } : {}),
        rawXml: xmlContent,
        rawObject: root
    };
};

/**
 * Parses an `<emailtemplate>` SDF XML string and optional `.template.html` body content.
 */
export const parseEmailTemplateXml = (
    xmlContent: string,
    htmlContent?: string,
    fallbackScriptId = ""
): ParsedEmailTemplate => {
    const obj = create(xmlContent).toObject() as any;
    const root = obj?.emailtemplate;

    if (!root || typeof root !== "object") {
        throw new Error("Could not parse <emailtemplate> root element from XML.");
    }

    const scriptId = String(root["@scriptid"] || fallbackScriptId).trim();
    const name = extractNodeText(root.name) ?? "";
    const subject = extractNodeText(root.subject);
    const description = extractNodeText(root.description);
    const recordtype = extractNodeText(root.recordtype);
    const mediaitem = extractNodeText(root.mediaitem);
    const version = extractNodeText(root.version);

    const usesmedia = parseSdfBoolean(root.usesmedia, Boolean(mediaitem));
    const addunsubscribelink = parseSdfBoolean(root.addunsubscribelink, true);
    const addcompanyaddress = parseSdfBoolean(root.addcompanyaddress, true);
    const isprivate = parseSdfBoolean(root.isprivate, false);
    const isinactive = parseSdfBoolean(root.isinactive, false);

    return {
        scriptId,
        name,
        ...(subject !== undefined ? { subject } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(recordtype !== undefined ? { recordtype } : {}),
        usesmedia,
        ...(mediaitem !== undefined ? { mediaitem } : {}),
        addunsubscribelink,
        addcompanyaddress,
        isprivate,
        isinactive,
        ...(version !== undefined ? { version } : {}),
        ...(htmlContent !== undefined ? { htmlContent } : {}),
        rawXml: xmlContent,
        rawObject: root
    };
};

/**
 * Lists Advanced PDF Templates (`custtmpl_*`) and/or Email Templates (`custemailtmpl_*`)
 * in the active NetSuite account via `suitecloud object:list`.
 */
export const listSdfTemplates = async (
    projectRoot: string,
    filterType: "all" | SdfTemplateType = "all",
    projectConfig?: ProjectConfig
): Promise<{
    advancedPdfTemplates: string[];
    emailTemplates: string[];
}> => {
    const resolvedConfig = projectConfig ?? (await getProjectConfig(projectRoot));

    return withTempSdfProject(
        {
            projectRoot,
            projectConfig: resolvedConfig,
            tempDirPrefix: "netsuite-mcp-tmpl-list-"
        },
        async (tempProject) => {
            const typesToQuery: SdfTemplateType[] =
                filterType === "all"
                    ? ["advancedpdftemplate", "emailtemplate"]
                    : [filterType];

            const advancedPdfTemplates: string[] = [];
            const emailTemplates: string[] = [];
            const seenPdf = new Set<string>();
            const seenEmail = new Set<string>();

            for (const type of typesToQuery) {
                const { stdout } = await execAsync(
                    `suitecloud object:list --type ${type}`,
                    { cwd: tempProject.tempDir }
                );

                for (const rawLine of stdout.split(/\r?\n/)) {
                    const line = rawLine.trim();
                    if (!line) continue;

                    if (type === "advancedpdftemplate") {
                        const match = line.match(/(?:^|:)(custtmpl_[a-zA-Z0-9_]+)$/i);
                        if (match && match[1]) {
                            const id = match[1].toLowerCase();
                            if (!seenPdf.has(id)) {
                                seenPdf.add(id);
                                advancedPdfTemplates.push(match[1]);
                            }
                        }
                    } else if (type === "emailtemplate") {
                        const match = line.match(/(?:^|:)(custemailtmpl_[a-zA-Z0-9_]+)$/i);
                        if (match && match[1]) {
                            const id = match[1].toLowerCase();
                            if (!seenEmail.has(id)) {
                                seenEmail.add(id);
                                emailTemplates.push(match[1]);
                            }
                        }
                    }
                }
            }

            return {
                advancedPdfTemplates,
                emailTemplates
            };
        }
    );
};

/**
 * Attempts to import an existing template (`advancedpdftemplate` or `emailtemplate`)
 * and its companion `.template.xml` or `.template.html` file into `tempProject`.
 * Returns `null` if the template does not exist in NetSuite.
 */
export const tryImportTemplateInTempProject = async (
    tempProject: TempSdfProject,
    scriptId: string,
    type: SdfTemplateType
): Promise<{
    xmlPath: string;
    xmlContent: string;
    companionPath: string;
    companionContent?: string;
} | null> => {
    const command = `suitecloud object:import --type ${type} --scriptid ${scriptId} --destinationfolder /Objects`;
    try {
        await execAsync(command, { cwd: tempProject.tempDir });
    } catch {
        return null;
    }

    const xmlPath = tempProject.getLocalObjectPath(scriptId);
    if (!(await fileExists(xmlPath))) {
        return null;
    }

    const xmlContent = await fs.readFile(xmlPath, "utf-8");
    const companionFileName =
        type === "advancedpdftemplate"
            ? `${scriptId}.template.xml`
            : `${scriptId}.template.html`;
    const companionPath = path.join(tempProject.objectsDir, companionFileName);

    let companionContent: string | undefined;
    if (await fileExists(companionPath)) {
        companionContent = await fs.readFile(companionPath, "utf-8");
    }

    return {
        xmlPath,
        xmlContent,
        companionPath,
        companionContent
    };
};

/**
 * Reads an Advanced PDF Template from NetSuite via an isolated temporary SDF project.
 */
export const readAdvancedPdfTemplateFromSdf = async (
    projectRoot: string,
    rawScriptId: string,
    projectConfig?: ProjectConfig
): Promise<ParsedAdvancedPdfTemplate> => {
    const scriptId = normalizeAdvancedPdfScriptId(rawScriptId);
    const resolvedConfig = projectConfig ?? (await getProjectConfig(projectRoot));

    return withTempSdfProject(
        {
            projectRoot,
            projectConfig: resolvedConfig,
            tempDirPrefix: "netsuite-mcp-pdf-read-"
        },
        async (tempProject) => {
            const imported = await tryImportTemplateInTempProject(
                tempProject,
                scriptId,
                "advancedpdftemplate"
            );

            if (!imported) {
                throw new Error(
                    `Advanced PDF Template '${scriptId}' was not found in the active NetSuite environment (or could not be imported via SDF).`
                );
            }

            return parseAdvancedPdfTemplateXml(
                imported.xmlContent,
                imported.companionContent,
                scriptId
            );
        }
    );
};

/**
 * Reads an Email Template from NetSuite via an isolated temporary SDF project.
 */
export const readEmailTemplateFromSdf = async (
    projectRoot: string,
    rawScriptId: string,
    projectConfig?: ProjectConfig
): Promise<ParsedEmailTemplate> => {
    const scriptId = normalizeEmailTemplateScriptId(rawScriptId);
    const resolvedConfig = projectConfig ?? (await getProjectConfig(projectRoot));

    return withTempSdfProject(
        {
            projectRoot,
            projectConfig: resolvedConfig,
            tempDirPrefix: "netsuite-mcp-email-read-"
        },
        async (tempProject) => {
            const imported = await tryImportTemplateInTempProject(
                tempProject,
                scriptId,
                "emailtemplate"
            );

            if (!imported) {
                throw new Error(
                    `Email Template '${scriptId}' was not found in the active NetSuite environment (or could not be imported via SDF).`
                );
            }

            return parseEmailTemplateXml(
                imported.xmlContent,
                imported.companionContent,
                scriptId
            );
        }
    );
};

/**
 * Extracts raw script IDs from `[scriptid=...]` references for `manifest.xml` object dependencies.
 */
const extractScriptIdFromBracketRef = (value: unknown): string | null => {
    if (typeof value !== "string") return null;
    const match = value.trim().match(/^\[scriptid=([^\]]+)\]$/i);
    if (!match || !match[1]) return null;
    const rawId = match[1].trim().split(".")[0];
    return rawId || null;
};

/**
 * Extracts raw File Cabinet path from `[/Templates/...]` mediaitem reference.
 */
const extractFileCabinetPathFromBracketRef = (value: unknown): string | null => {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
        const inner = trimmed.slice(1, -1).trim();
        return inner.startsWith("/") ? inner : `/${inner}`;
    }
    return null;
};

/**
 * Deploys a template object XML and its optional companion file (`.template.xml` or `.template.html`)
 * from `tempProject`, and optionally syncs both files into the local project's `Objects/` directory.
 */
export const deployTemplateFromTempProject = async (args: {
    tempProject: TempSdfProject;
    projectRoot: string;
    scriptId: string;
    xmlContent: string;
    companionFileName?: string;
    companionContent?: string;
    staleCompanionFileNameToDelete?: string;
    manifestDependencies?: ManifestDependencies;
    options?: DeploySdfObjectOptions;
}): Promise<string> => {
    const {
        tempProject,
        projectRoot,
        scriptId,
        xmlContent,
        companionFileName,
        companionContent,
        staleCompanionFileNameToDelete,
        manifestDependencies,
        options
    } = args;

    const projectConfig = options?.projectConfig ?? (await getProjectConfig(projectRoot));

    // 1. Write <scriptId>.xml to <tempDir>/Objects/<scriptId>.xml
    const tempObjectPath = tempProject.getLocalObjectPath(scriptId);
    await fs.mkdir(path.dirname(tempObjectPath), { recursive: true });
    await fs.writeFile(tempObjectPath, xmlContent, "utf-8");

    // 2. Write or clean up companion file in <tempDir>/Objects/
    if (companionFileName && companionContent !== undefined) {
        const tempCompanionPath = path.join(path.dirname(tempObjectPath), companionFileName);
        await fs.writeFile(tempCompanionPath, companionContent, "utf-8");
    }
    if (staleCompanionFileNameToDelete) {
        const staleTempPath = path.join(path.dirname(tempObjectPath), staleCompanionFileNameToDelete);
        try {
            await fs.unlink(staleTempPath);
        } catch {
            // Ignore if it wasn't present
        }
    }

    // 3. Configure deploy.xml and manifest.xml
    // Include ~/Objects/* so both <scriptId>.xml and its companion <scriptId>.template.xml / .template.html
    // are packaged by SuiteCloud CLI into the deployment archive.
    await tempProject.setDeployConfig({
        objects: [`~/Objects/*`]
    });

    if (manifestDependencies) {
        await tempProject.addManifestDependencies(manifestDependencies);
    }

    // 4. Deploy via SuiteCloud CLI
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
            scriptId,
            xmlContent,
            strategy: effectiveSaveInfo.objectsFolderStrategy,
            explicitSubFolder: options?.subFolder,
            rootElement: options?.rootElement,
            manifestDependencies
        });

        const savedDir = path.dirname(syncResult.savedPath);
        let companionNote = "";

        if (companionFileName && companionContent !== undefined) {
            const targetCompanionPath = path.join(savedDir, companionFileName);
            await fs.writeFile(targetCompanionPath, companionContent, "utf-8");
            const relCompanion = path.relative(projectRoot, targetCompanionPath) || targetCompanionPath;
            companionNote = `, companion: ${relCompanion}`;
        }

        if (staleCompanionFileNameToDelete) {
            const staleProjectPath = path.join(savedDir, staleCompanionFileNameToDelete);
            try {
                await fs.unlink(staleProjectPath);
            } catch {
                // Ignore if not present
            }
        }

        const actionLabel = syncResult.updatedExisting
            ? "Updated existing project file"
            : "Saved to project";
        const manifestNote = syncResult.manifestUpdated ? " (and updated manifest.xml dependencies)" : "";

        return `${deployResult.output}\n[${actionLabel}: ${syncResult.relativePath}${companionNote}${manifestNote}]`;
    }

    const skipReason =
        typeof options?.saveToProject === "boolean"
            ? "saveToProject=false"
            : effectiveSaveInfo.reason;
    return `${deployResult.output}\n[Background deployment only — XML/template files were not copied to the local project (${skipReason}).]`;
};

/**
 * Builds, validates, and deploys an Advanced PDF Template (`<advancedpdftemplate>` + `<scriptId>.template.xml`).
 * Performs an upsert: if the template already exists in NetSuite, downloads it first and merges provided properties.
 */
export const upsertAdvancedPdfTemplateInSdf = async (
    projectRoot: string,
    input: UpsertAdvancedPdfTemplateInput,
    projectConfig?: ProjectConfig
): Promise<string> => {
    const scriptId = normalizeAdvancedPdfScriptId(input.scriptId);

    // Up-front field validations
    if (input.title !== undefined) {
        if (!input.title.trim()) {
            throw new Error("'title' cannot be empty.");
        }
        if (input.title.length > 297) {
            throw new Error(
                `'title' is ${input.title.length} characters long, exceeding the NetSuite SDF limit of 297 characters.`
            );
        }
    }

    if (input.description !== undefined && input.description.length > 4000) {
        throw new Error(
            `'description' is ${input.description.length} characters long, exceeding the NetSuite SDF limit of 4000 characters.`
        );
    }

    if (input.printtype !== undefined) {
        const normalizedPrintType = input.printtype.trim().toUpperCase();
        if (normalizedPrintType === "STATEMENT") {
            throw new Error(
                "Invalid printtype 'STATEMENT': NetSuite SDF does not support Customer Statement (STATEMENT) Advanced PDF templates."
            );
        }
    }

    if (input.pdfContent !== undefined) {
        validateBfoPdfContent(input.pdfContent);
    }

    const resolvedConfig = projectConfig ?? (await getProjectConfig(projectRoot));

    return withTempSdfProject(
        {
            projectRoot,
            projectConfig: resolvedConfig,
            tempDirPrefix: "netsuite-mcp-pdf-upsert-"
        },
        async (tempProject) => {
            const existing = await tryImportTemplateInTempProject(
                tempProject,
                scriptId,
                "advancedpdftemplate"
            );

            let rootObj: Record<string, any>;
            let finalPdfContent: string;

            if (existing) {
                const parsedXml = create(existing.xmlContent).toObject() as any;
                rootObj =
                    parsedXml?.advancedpdftemplate && typeof parsedXml.advancedpdftemplate === "object"
                        ? { ...parsedXml.advancedpdftemplate }
                        : { "@scriptid": scriptId };

                finalPdfContent =
                    input.pdfContent !== undefined
                        ? input.pdfContent
                        : existing.companionContent ?? "";

                if (!finalPdfContent.trim()) {
                    throw new Error(
                        `Existing Advanced PDF Template '${scriptId}' had no companion .template.xml body and 'pdfContent' was not provided.`
                    );
                }
            } else {
                // Create mode: title and pdfContent are required
                if (input.title === undefined || !input.title.trim()) {
                    throw new Error(
                        `'title' is required when creating a new Advanced PDF Template ('${scriptId}' does not exist in NetSuite yet).`
                    );
                }
                if (input.pdfContent === undefined || !input.pdfContent.trim()) {
                    throw new Error(
                        `'pdfContent' is required when creating a new Advanced PDF Template ('${scriptId}' does not exist in NetSuite yet).`
                    );
                }

                finalPdfContent = input.pdfContent;

                rootObj = {
                    "@scriptid": scriptId,
                    "@standard": "STDTMPLEMPTY",
                    title: input.title.trim(),
                    displaysourcecode: "T",
                    preferred: "F",
                    isinactive: "F"
                };
            }

            // Apply provided properties onto rootObj
            rootObj["@scriptid"] = scriptId;

            if (input.standard !== undefined && input.standard.trim() !== "") {
                rootObj["@standard"] = input.standard.trim();
            } else if (!rootObj["@standard"]) {
                rootObj["@standard"] = "STDTMPLEMPTY";
            }

            if (input.title !== undefined) {
                rootObj.title = input.title.trim();
            }

            if (input.description !== undefined) {
                rootObj.description = input.description;
            }

            if (input.trantype !== undefined) {
                rootObj.trantype = input.trantype.trim().toUpperCase();
            }

            if (input.printtype !== undefined) {
                rootObj.printtype = input.printtype.trim().toUpperCase();
            }

            if (input.recordtype !== undefined && input.recordtype.trim() !== "") {
                const { formatted, rawId } = normalizeScriptIdReference(input.recordtype);
                if (rawId.toLowerCase().startsWith("customtransaction_")) {
                    rootObj.customtransaction = formatted;
                    delete rootObj.recordtype;
                    if (input.printtype === undefined && !rootObj.printtype) {
                        rootObj.printtype = "CUSTOMTRANSACTION";
                    }
                } else {
                    rootObj.recordtype = formatted;
                    delete rootObj.customtransaction;
                    if (input.printtype === undefined && !rootObj.printtype) {
                        rootObj.printtype = "CUSTOMRECORD";
                    }
                }
            }

            if (input.savedsearch !== undefined && input.savedsearch.trim() !== "") {
                const { formatted } = normalizeScriptIdReference(input.savedsearch);
                rootObj.savedsearch = formatted;
                if (input.printtype === undefined && !rootObj.printtype) {
                    rootObj.printtype = "SEARCH";
                }
            }

            if (input.displaysourcecode !== undefined) {
                rootObj.displaysourcecode = input.displaysourcecode ? "T" : "F";
            } else if (rootObj.displaysourcecode === undefined) {
                rootObj.displaysourcecode = "T";
            }

            if (input.preferred !== undefined) {
                rootObj.preferred = input.preferred ? "T" : "F";
            } else if (rootObj.preferred === undefined) {
                rootObj.preferred = "F";
            }

            if (input.isinactive !== undefined) {
                rootObj.isinactive = input.isinactive ? "T" : "F";
            } else if (rootObj.isinactive === undefined) {
                rootObj.isinactive = "F";
            }

            // Collect manifest dependencies (ADVANCEDPRINTING feature + any referenced objects)
            const objectDeps = new Set<string>();
            for (const refCandidate of [rootObj.recordtype, rootObj.customtransaction, rootObj.savedsearch]) {
                const depId = extractScriptIdFromBracketRef(refCandidate);
                if (depId) {
                    objectDeps.add(depId);
                }
            }

            const manifestDependencies: ManifestDependencies = {
                features: ["ADVANCEDPRINTING"],
                ...(objectDeps.size > 0 ? { objects: Array.from(objectDeps) } : {})
            };

            const xmlContent = create(
                { version: "1.0", encoding: "UTF-8" },
                { advancedpdftemplate: rootObj }
            ).end({ prettyPrint: true });

            return deployTemplateFromTempProject({
                tempProject,
                projectRoot,
                scriptId,
                xmlContent,
                companionFileName: `${scriptId}.template.xml`,
                companionContent: finalPdfContent,
                manifestDependencies,
                options: {
                    saveToProject: input.saveToProject,
                    rootElement: "advancedpdftemplate",
                    projectConfig: resolvedConfig
                }
            });
        }
    );
};

/**
 * Builds, validates, and deploys an Email Template (`<emailtemplate>` + optional `<scriptId>.template.html`).
 * Performs an upsert: if the template already exists in NetSuite, downloads it first and merges provided properties.
 */
export const upsertEmailTemplateInSdf = async (
    projectRoot: string,
    input: UpsertEmailTemplateInput,
    projectConfig?: ProjectConfig
): Promise<string> => {
    const scriptId = normalizeEmailTemplateScriptId(input.scriptId);

    // Up-front field validations
    if (input.name !== undefined) {
        if (!input.name.trim()) {
            throw new Error("'name' cannot be empty.");
        }
        if (input.name.length > 60) {
            throw new Error(
                `'name' is ${input.name.length} characters long, exceeding the NetSuite SDF limit of 60 characters.`
            );
        }
    }

    if (input.subject !== undefined && input.subject.length > 199) {
        throw new Error(
            `'subject' is ${input.subject.length} characters long, exceeding the NetSuite SDF limit of 199 characters.`
        );
    }

    if (input.description !== undefined && input.description.length > 1000) {
        throw new Error(
            `'description' is ${input.description.length} characters long, exceeding the NetSuite SDF limit of 1000 characters.`
        );
    }

    if (input.recordtype !== undefined && input.recordtype.trim() !== "") {
        const upperRecType = input.recordtype.trim().toUpperCase();
        if (!EMAIL_RECORD_TYPES.includes(upperRecType as EmailRecordType)) {
            throw new Error(
                `Invalid recordtype '${input.recordtype}'. Must be one of: ${EMAIL_RECORD_TYPES.join(", ")}.`
            );
        }
    }

    if (input.htmlContent !== undefined && input.mediaItemPath !== undefined) {
        throw new Error(
            "Cannot provide both 'htmlContent' (usesmedia=F) and 'mediaItemPath' (usesmedia=T) at the same time. Provide one or the other."
        );
    }

    let normalizedMediaItem: { formatted: string; fileCabinetPath: string } | undefined;
    if (input.mediaItemPath !== undefined) {
        normalizedMediaItem = normalizeMediaItemPath(input.mediaItemPath);
    }

    const resolvedConfig = projectConfig ?? (await getProjectConfig(projectRoot));

    return withTempSdfProject(
        {
            projectRoot,
            projectConfig: resolvedConfig,
            tempDirPrefix: "netsuite-mcp-email-upsert-"
        },
        async (tempProject) => {
            const existing = await tryImportTemplateInTempProject(
                tempProject,
                scriptId,
                "emailtemplate"
            );

            let rootObj: Record<string, any>;
            let finalHtmlContent: string | undefined;

            if (existing) {
                const parsedXml = create(existing.xmlContent).toObject() as any;
                rootObj =
                    parsedXml?.emailtemplate && typeof parsedXml.emailtemplate === "object"
                        ? { ...parsedXml.emailtemplate }
                        : { "@scriptid": scriptId };

                if (normalizedMediaItem) {
                    rootObj.usesmedia = "T";
                    rootObj.mediaitem = normalizedMediaItem.formatted;
                    finalHtmlContent = undefined;
                } else if (input.htmlContent !== undefined) {
                    rootObj.usesmedia = "F";
                    delete rootObj.mediaitem;
                    finalHtmlContent = input.htmlContent;
                } else {
                    const currentUsesMedia = parseSdfBoolean(rootObj.usesmedia, Boolean(rootObj.mediaitem));
                    if (currentUsesMedia) {
                        finalHtmlContent = undefined;
                    } else {
                        finalHtmlContent = existing.companionContent ?? "";
                    }
                }
            } else {
                // Create mode: name and either htmlContent or mediaItemPath are required
                if (input.name === undefined || !input.name.trim()) {
                    throw new Error(
                        `'name' is required when creating a new Email Template ('${scriptId}' does not exist in NetSuite yet).`
                    );
                }
                if (input.htmlContent === undefined && !normalizedMediaItem) {
                    throw new Error(
                        `Either 'htmlContent' or 'mediaItemPath' is required when creating a new Email Template ('${scriptId}' does not exist in NetSuite yet).`
                    );
                }

                rootObj = {
                    "@scriptid": scriptId,
                    name: input.name.trim(),
                    addcompanyaddress: "T",
                    addunsubscribelink: "T",
                    isprivate: "F",
                    isinactive: "F"
                };

                if (normalizedMediaItem) {
                    rootObj.usesmedia = "T";
                    rootObj.mediaitem = normalizedMediaItem.formatted;
                    finalHtmlContent = undefined;
                } else {
                    rootObj.usesmedia = "F";
                    finalHtmlContent = input.htmlContent!;
                }
            }

            // Apply provided properties onto rootObj
            rootObj["@scriptid"] = scriptId;

            if (input.name !== undefined) {
                rootObj.name = input.name.trim();
            }

            if (input.subject !== undefined) {
                rootObj.subject = input.subject;
            }

            if (input.description !== undefined) {
                rootObj.description = input.description;
            }

            if (input.recordtype !== undefined && input.recordtype.trim() !== "") {
                rootObj.recordtype = input.recordtype.trim().toUpperCase();
            }

            if (input.addunsubscribelink !== undefined) {
                rootObj.addunsubscribelink = input.addunsubscribelink ? "T" : "F";
            } else if (rootObj.addunsubscribelink === undefined) {
                rootObj.addunsubscribelink = "T";
            }

            if (input.addcompanyaddress !== undefined) {
                rootObj.addcompanyaddress = input.addcompanyaddress ? "T" : "F";
            } else if (rootObj.addcompanyaddress === undefined) {
                rootObj.addcompanyaddress = "T";
            }

            if (input.isprivate !== undefined) {
                rootObj.isprivate = input.isprivate ? "T" : "F";
            } else if (rootObj.isprivate === undefined) {
                rootObj.isprivate = "F";
            }

            if (input.isinactive !== undefined) {
                rootObj.isinactive = input.isinactive ? "T" : "F";
            } else if (rootObj.isinactive === undefined) {
                rootObj.isinactive = "F";
            }

            // Collect manifest dependencies (CRM feature is required for emailtemplate, plus File Cabinet path if usesmedia=T)
            const usesMediaNow = parseSdfBoolean(rootObj.usesmedia, false);
            const mediaFilePath = usesMediaNow
                ? extractFileCabinetPathFromBracketRef(rootObj.mediaitem)
                : null;
            const manifestDependencies: ManifestDependencies = {
                features: ["CRM"],
                ...(mediaFilePath ? { files: [mediaFilePath] } : {})
            };

            const xmlContent = create(
                { version: "1.0", encoding: "UTF-8" },
                { emailtemplate: rootObj }
            ).end({ prettyPrint: true });

            return deployTemplateFromTempProject({
                tempProject,
                projectRoot,
                scriptId,
                xmlContent,
                companionFileName: usesMediaNow ? undefined : `${scriptId}.template.html`,
                companionContent: usesMediaNow ? undefined : finalHtmlContent ?? "",
                staleCompanionFileNameToDelete: usesMediaNow ? `${scriptId}.template.html` : undefined,
                manifestDependencies,
                options: {
                    saveToProject: input.saveToProject,
                    rootElement: "emailtemplate",
                    projectConfig: resolvedConfig
                }
            });
        }
    );
};

// =========================================================================
// MANAGED TEMPLATE PREVIEW DIRECTORY & AUTO-CLEANUP
// =========================================================================

const PREVIEW_TTL_MS = 15 * 60 * 1000; // 15 minutes
let previewDirPath: string | null = null;
let exitHookRegistered = false;

/**
 * Resolves the managed preview directory (preferring `/tmp/opencode/netsuite-mcp-previews` on Linux
 * when `/tmp/opencode` exists, otherwise `<os.tmpdir()>/netsuite-mcp-previews`) and registers a
 * process exit cleanup hook so temporary preview files are automatically deleted when the MCP server exits.
 */
export const ensureManagedPreviewDir = async (): Promise<string> => {
    if (!previewDirPath) {
        const opencodeTmp = "/tmp/opencode";
        if (await fileExists(opencodeTmp)) {
            previewDirPath = path.join(opencodeTmp, "netsuite-mcp-previews");
        } else {
            previewDirPath = path.join(os.tmpdir(), "netsuite-mcp-previews");
        }
    }

    await fs.mkdir(previewDirPath, { recursive: true });

    if (!exitHookRegistered) {
        exitHookRegistered = true;
        const targetDir = previewDirPath;
        process.on("exit", () => {
            try {
                fsSync.rmSync(targetDir, { recursive: true, force: true });
            } catch {
                // Ignore cleanup errors on exit
            }
        });
    }

    return previewDirPath;
};

/**
 * Prunes any files inside the managed preview directory older than `PREVIEW_TTL_MS` (15 minutes).
 */
export const pruneExpiredPreviewFiles = async (dirPath: string): Promise<void> => {
    try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        const now = Date.now();
        await Promise.all(
            entries.map(async (entry) => {
                if (!entry.isFile()) return;
                const fullPath = path.join(dirPath, entry.name);
                try {
                    const stat = await fs.stat(fullPath);
                    if (now - stat.mtimeMs > PREVIEW_TTL_MS) {
                        await fs.unlink(fullPath);
                    }
                } catch {
                    // Ignore race conditions
                }
            })
        );
    } catch {
        // Ignore directory read errors
    }
};

/**
 * Writes a rendered template preview file (PDF binary or HTML text) into the managed preview directory,
 * deterministically overwriting by `<baseName>.<ext>` and pruning expired previews (>15 minutes old).
 */
export const writeManagedTemplatePreviewFile = async (
    fileName: string,
    content: Buffer | string
): Promise<string> => {
    const dir = await ensureManagedPreviewDir();
    await pruneExpiredPreviewFiles(dir);

    const safeFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const targetPath = path.join(dir, safeFileName);

    if (typeof content === "string") {
        await fs.writeFile(targetPath, content, "utf-8");
    } else {
        await fs.writeFile(targetPath, content);
    }

    return targetPath;
};
