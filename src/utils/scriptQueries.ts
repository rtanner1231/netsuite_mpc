import fs from "fs/promises";
import path from "path";
import util from "util";
import { exec } from "child_process";
import { create } from "xmlbuilder2";
import { callNetsuiteRestlet } from "./api.js";
import { findExistingObjectFile } from "./objects.js";
import {
    getProjectConfig,
    getSdfSrcDir,
    loadTsProject,
    ProjectConfig,
    resolveProjectFile
} from "./project.js";
import { TempSdfProject, withTempSdfProject } from "./tempSdfProject.js";
import {
    canonicalizeSuiteQlScriptId,
    ensureArray,
    GetScriptOptions,
    isSdfTrue,
    normalizeCustomScriptId,
    normalizeEventSubscriberId,
    normalizeScriptTypeKey,
    ParsedScriptXml,
    SdfScriptRootElement,
    SearchScriptsOptions,
    SuiteQlScriptMatch
} from "./scriptTypes.js";
import {
    extractEventSubscriberCriteriaSummary,
    parseScriptXmlString
} from "./scriptXml.js";

const execAsync = util.promisify(exec);

const fileExists = async (targetPath: string): Promise<boolean> => {
    try {
        await fs.access(targetPath);
        return true;
    } catch {
        return false;
    }
};

const isDeploymentEffectivelyActive = (
    scriptIsInactive: boolean,
    isDeployed: boolean,
    status?: string,
    scriptType?: string,
    scriptId?: string
): boolean => {
    if (scriptIsInactive) {
        return false;
    }
    if (
        (scriptType && scriptType.trim().toUpperCase().includes("EVENTSUBSCRIBER")) ||
        (scriptId && scriptId.trim().toLowerCase().startsWith("custevsub_"))
    ) {
        return true;
    }
    return (
        isDeployed &&
        (status === "RELEASED" ||
            status === "TESTING" ||
            status === "SCHEDULED" ||
            status === "INPROGRESS")
    );
};

/**
 * Executes a SuiteQL query via the MCP RESTlet and returns the result rows array (or throws on error).
 */
export const executeSuiteQlRows = async (sql: string): Promise<Record<string, any>[]> => {
    const response = await callNetsuiteRestlet({
        action: "RUN_SUITE_QL",
        query: sql
    });

    if (!response || response.success === false) {
        throw new Error(response?.errorMessage || "SuiteQL query failed.");
    }

    return Array.isArray(response.results) ? response.results : [];
};

const isValidIanaTimeZone = (tz: string): boolean => {
    if (!tz || typeof tz !== "string") return false;
    try {
        Intl.DateTimeFormat(undefined, { timeZone: tz.trim() });
        return true;
    } catch {
        return false;
    }
};

const cachedTimeZoneByEnv = new Map<string, string>();

/**
 * Resolves the NetSuite account/user timezone (an IANA timezone string like `"America/New_York"`
 * or a signed ISO UTC offset like `"-05:00"`), falling back to the local host machine's IANA timezone.
 */
export const resolveNetsuiteAccountTimeZone = async (
    environmentKey = "default"
): Promise<string> => {
    const cached = cachedTimeZoneByEnv.get(environmentKey);
    if (cached) {
        return cached;
    }

    // 1. Check companypreference for TIMEZONE (often an IANA timezone such as "America/New_York")
    try {
        const prefRows = await executeSuiteQlRows(
            `SELECT value FROM companypreference WHERE preference = 'TIMEZONE'`
        );
        const rawTz = prefRows[0]?.value != null ? String(prefRows[0].value).trim() : "";
        if (rawTz && isValidIanaTimeZone(rawTz)) {
            cachedTimeZoneByEnv.set(environmentKey, rawTz);
            return rawTz;
        }
    } catch {
        // Ignore if companypreference is inaccessible
    }

    // 2. Check SESSIONTIMEZONE from DUAL (returns either an IANA timezone or a signed offset like "-05:00" / "-04:00")
    try {
        const dualRows = await executeSuiteQlRows(
            `SELECT SESSIONTIMEZONE AS session_tz FROM DUAL`
        );
        const sessionTz = dualRows[0]?.session_tz != null ? String(dualRows[0].session_tz).trim() : "";
        if (sessionTz) {
            if (isValidIanaTimeZone(sessionTz)) {
                cachedTimeZoneByEnv.set(environmentKey, sessionTz);
                return sessionTz;
            }
            if (/^[+-]\d{2}:\d{2}$/.test(sessionTz)) {
                // If the local host machine's IANA timezone currently has the same UTC offset, prefer the IANA name
                // so future DST dates are also handled; otherwise use the exact offset string.
                const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
                if (localTz && isValidIanaTimeZone(localTz)) {
                    cachedTimeZoneByEnv.set(environmentKey, localTz);
                    return localTz;
                }
                cachedTimeZoneByEnv.set(environmentKey, sessionTz);
                return sessionTz;
            }
        }
    } catch {
        // Ignore if DUAL query fails
    }

    // 3. Fallback to local system IANA timezone
    const fallbackTz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    cachedTimeZoneByEnv.set(environmentKey, fallbackTz);
    return fallbackTz;
};

/**
 * Standard NetSuite File Cabinet root folders (which have negative internal IDs in NetSuite).
 * Pre-seeded so that even if a role cannot query negative IDs in `mediaitemfolder`, root folders
 * like `SuiteScripts` (-15) are always resolved properly.
 */
const NETSUITE_SYSTEM_ROOT_FOLDERS: Record<number, { name: string; parent: number | null }> = {
    [-15]: { name: "SuiteScripts", parent: null },
    [-16]: { name: "SuiteBundles", parent: null },
    [-10]: { name: "Templates", parent: null },
    [-11]: { name: "Letter Templates", parent: -10 },
    [-12]: { name: "E-mail Templates", parent: -10 },
    [-13]: { name: "Fax Templates", parent: -10 },
    [-14]: { name: "Marketing Templates", parent: -10 },
    [-100]: { name: "Web Site Hosting Files", parent: null },
    [-101]: { name: "Live Hosting Files", parent: -100 },
    [-102]: { name: "Staging Hosting Files", parent: -100 },
    [-6]: { name: "Images", parent: null },
    [-4]: { name: "Attachments Received", parent: null },
    [-5]: { name: "Attachments Sent", parent: null },
    [-9]: { name: "SuiteApps", parent: null }
};

/**
 * Ensures a script File Cabinet path starts with a valid top-level root folder (defaulting to `/SuiteScripts/...`
 * when a relative subfolder path such as `/SalesOrder/ue_salesorder_global.js` is passed).
 */
export const normalizeScriptFileCabinetPath = (rawPath: string): string => {
    let cleaned = (rawPath || "").trim();
    if (!cleaned) return "";

    if (cleaned.startsWith("[") && cleaned.endsWith("]")) {
        cleaned = cleaned.slice(1, -1).trim();
    }

    cleaned = cleaned.replace(/\\/g, "/");
    if (!cleaned.startsWith("/")) {
        cleaned = `/${cleaned}`;
    }

    const knownRootPrefixes = [
        "/suitescripts/",
        "/suitebundles/",
        "/suiteapps/",
        "/templates/",
        "/web site hosting files/",
        "/bundle "
    ];
    const lower = cleaned.toLowerCase();
    if (knownRootPrefixes.some((prefix) => lower.startsWith(prefix))) {
        return cleaned;
    }

    return `/SuiteScripts${cleaned}`;
};

/**
 * Resolves the full File Cabinet path (e.g. `/SuiteScripts/sub/my_script.js`) for one or more file internal IDs
 * by querying `file` and walking `mediaitemfolder` parent links via SuiteQL.
 */
export const resolveRemoteFileCabinetPathsByFileIds = async (
    fileIds: number[]
): Promise<Map<number, string>> => {
    const uniqueIds = Array.from(
        new Set(fileIds.filter((id) => Number.isFinite(id) && id !== 0))
    );
    const resultMap = new Map<number, string>();
    if (uniqueIds.length === 0) {
        return resultMap;
    }

    try {
        const fileRows = await executeSuiteQlRows(
            `SELECT id, name, folder FROM file WHERE id IN (${uniqueIds.join(", ")})`
        );

        const folderMap = new Map<number, { name: string; parent: number | null }>();
        for (const [sysIdStr, sysNode] of Object.entries(NETSUITE_SYSTEM_ROOT_FOLDERS)) {
            folderMap.set(Number(sysIdStr), { ...sysNode });
        }

        const folderIdsToFetch = new Set<number>();
        const fileInfoById = new Map<number, { name: string; folderId: number | null }>();

        for (const r of fileRows) {
            const fId = Number(r.id);
            const fName = String(r.name || "");
            const folderId =
                r.folder != null && Number(r.folder) !== 0 && !Number.isNaN(Number(r.folder))
                    ? Number(r.folder)
                    : null;
            fileInfoById.set(fId, { name: fName, folderId });
            if (folderId !== null && !folderMap.has(folderId)) {
                folderIdsToFetch.add(folderId);
            }
        }

        let currentBatch = Array.from(folderIdsToFetch);
        let depth = 0;

        while (currentBatch.length > 0 && depth < 12) {
            depth++;
            const folderRows = await executeSuiteQlRows(
                `SELECT id, name, parent FROM mediaitemfolder WHERE id IN (${currentBatch.join(", ")})`
            );
            const nextBatch: number[] = [];
            for (const fr of folderRows) {
                const id = Number(fr.id);
                const name = String(fr.name || "");
                const parent =
                    fr.parent != null && Number(fr.parent) !== 0 && !Number.isNaN(Number(fr.parent))
                        ? Number(fr.parent)
                        : null;
                folderMap.set(id, { name, parent });
                if (parent !== null && !folderMap.has(parent)) {
                    nextBatch.push(parent);
                }
            }
            currentBatch = Array.from(new Set(nextBatch));
        }

        for (const [fId, info] of fileInfoById.entries()) {
            const segments: string[] = [info.name];
            let currFolder = info.folderId;
            let guard = 0;
            while (currFolder !== null && folderMap.has(currFolder) && guard < 15) {
                guard++;
                const fNode = folderMap.get(currFolder)!;
                segments.unshift(fNode.name);
                currFolder = fNode.parent;
            }
            const assembledPath = normalizeScriptFileCabinetPath("/" + segments.join("/"));
            resultMap.set(fId, assembledPath);
        }
    } catch {
        // Fallback: if mediaitemfolder is inaccessible, leave map partial
    }

    return resultMap;
};

/**
 * Finds and parses a local `<scriptId>.xml` inside `<sdfSrcDir>/Objects` by reusing `findExistingObjectFile`.
 */
export const findLocalScriptXmlById = async (
    objectsDir: string,
    scriptId: string
): Promise<ParsedScriptXml | null> => {
    if (!(await fileExists(objectsDir))) {
        return null;
    }

    const xmlPath = await findExistingObjectFile(objectsDir, scriptId);
    if (!xmlPath) {
        return null;
    }

    try {
        const xmlContent = await fs.readFile(xmlPath, "utf-8");
        return parseScriptXmlString(xmlPath, xmlContent);
    } catch {
        return null;
    }
};

/**
 * Scans the local workspace `<sdfSrcDir>/Objects` directory for any script XML files
 * that reference a given File Cabinet path (e.g. `[/SuiteScripts/foo.js]`).
 */
export const findLocalScriptXmlsForFileCabinetPath = async (
    sdfSrcDir: string,
    fileCabinetPath: string
): Promise<{ scriptId: string; rootElement: SdfScriptRootElement; xmlPath: string; name?: string }[]> => {
    const objectsDir = path.join(sdfSrcDir, "Objects");
    if (!(await fileExists(objectsDir))) {
        return [];
    }

    const normalizedFc = fileCabinetPath.startsWith("/") ? fileCabinetPath : `/${fileCabinetPath}`;
    const targetScriptFileVal = `[${normalizedFc}]`.toLowerCase();
    const matches: { scriptId: string; rootElement: SdfScriptRootElement; xmlPath: string; name?: string }[] = [];

    const walk = async (dir: string) => {
        let entries;
        try {
            entries = await fs.readdir(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                await walk(fullPath);
            } else if (
                entry.isFile() &&
                entry.name.toLowerCase().endsWith(".xml") &&
                !entry.name.toLowerCase().endsWith(".template.xml")
            ) {
                try {
                    const content = await fs.readFile(fullPath, "utf-8");
                    if (!content.toLowerCase().includes(targetScriptFileVal)) {
                        continue;
                    }
                    const parsed = parseScriptXmlString(fullPath, content);
                    if (!parsed) continue;

                    const sf = String(
                        parsed.rootObj.scriptfile || parsed.rootObj.scriptfilepath || ""
                    )
                        .trim()
                        .toLowerCase();
                    if (sf === targetScriptFileVal) {
                        const sid = String(
                            parsed.rootObj["@scriptid"] || entry.name.replace(/\.xml$/i, "")
                        ).toLowerCase();
                        matches.push({
                            scriptId: sid,
                            rootElement: parsed.rootElement,
                            xmlPath: fullPath,
                            name:
                                typeof parsed.rootObj.name === "string"
                                    ? parsed.rootObj.name
                                    : undefined
                        });
                    }
                } catch {
                    // Ignore malformed XML files
                }
            }
        }
    };

    await walk(objectsDir);
    return matches;
};

/**
 * Queries NetSuite via SuiteQL for existing script records associated with a File Cabinet path or file name.
 */
export const findRemoteScriptsForFileCabinetPath = async (
    fileCabinetPath: string
): Promise<SuiteQlScriptMatch[]> => {
    const normalizedFc = normalizeScriptFileCabinetPath(fileCabinetPath);
    const baseFileName = path.posix.basename(normalizedFc).replace(/'/g, "''");
    if (!baseFileName) return [];

    try {
        const sql = `
            SELECT
                s.id AS internal_id,
                s.scriptid AS script_id,
                s.name AS name,
                s.scripttype AS script_type,
                s.description AS description,
                s.isinactive AS is_inactive,
                s.apiversion AS api_version,
                s.scriptfile AS script_file_id,
                f.name AS script_file_name
            FROM
                script s
                JOIN file f ON f.id = s.scriptfile
            WHERE
                LOWER(f.name) = LOWER('${baseFileName}')
            ORDER BY
                s.id ASC
        `;
        const rows = await executeSuiteQlRows(sql);
        if (rows.length === 0) return [];

        const fileIds = rows
            .map((r) => (r.script_file_id != null ? Number(r.script_file_id) : 0))
            .filter((id) => id > 0);
        const pathMap = await resolveRemoteFileCabinetPathsByFileIds(fileIds);

        const matches: SuiteQlScriptMatch[] = [];
        for (const r of rows) {
            const fileId = r.script_file_id != null ? Number(r.script_file_id) : undefined;
            const resolvedPath = fileId ? pathMap.get(fileId) : undefined;

            if (resolvedPath && resolvedPath.toLowerCase() !== normalizedFc.toLowerCase()) {
                continue;
            }

            const rawSuiteQlScriptId = String(r.script_id || "").toLowerCase();
            const canonicalScriptId = canonicalizeSuiteQlScriptId(
                rawSuiteQlScriptId,
                r.name != null ? String(r.name) : undefined,
                r.script_type != null ? String(r.script_type) : undefined
            );

            matches.push({
                internalId: Number(r.internal_id),
                scriptId: canonicalScriptId,
                name: String(r.name || ""),
                scriptType: String(r.script_type || ""),
                description: r.description != null ? String(r.description) : undefined,
                isInactive: isSdfTrue(r.is_inactive),
                apiVersion: r.api_version != null ? String(r.api_version) : undefined,
                scriptFileId: fileId,
                scriptFileName: r.script_file_name != null ? String(r.script_file_name) : undefined,
                fileCabinetPath: resolvedPath || normalizedFc
            });
        }

        return matches;
    } catch {
        return [];
    }
};

/**
 * Attempts to import an existing script object XML from NetSuite into `tempProject`.
 * If `knownRootElement` is provided, tries that type first; otherwise tries `ALL`.
 */
export const tryImportScriptInTempProject = async (
    tempProject: TempSdfProject,
    scriptId: string,
    knownRootElement?: SdfScriptRootElement
): Promise<ParsedScriptXml | null> => {
    const sdfType = knownRootElement || "ALL";
    const command = `suitecloud object:import --type ${sdfType} --scriptid ${scriptId} --destinationfolder /Objects`;
    try {
        await execAsync(command, { cwd: tempProject.tempDir });
    } catch {
        if (sdfType !== "ALL") {
            try {
                await execAsync(
                    `suitecloud object:import --type ALL --scriptid ${scriptId} --destinationfolder /Objects`,
                    { cwd: tempProject.tempDir }
                );
            } catch {
                return null;
            }
        } else {
            return null;
        }
    }

    const xmlPath = tempProject.getLocalObjectPath(scriptId);
    if (!(await fileExists(xmlPath))) {
        return null;
    }

    const xmlContent = await fs.readFile(xmlPath, "utf-8");
    return parseScriptXmlString(xmlPath, xmlContent);
};

/**
 * Maps a NetSuite File Cabinet path (e.g. `/SuiteScripts/foo/bar.js`) back to local project paths
 * (both compiled `.js` and TypeScript `.ts` source file if present).
 */
export const resolveLocalPathsFromFileCabinetPath = async (
    projectRoot: string,
    fileCabinetPath: string,
    projectConfig?: ProjectConfig
): Promise<{
    fileCabinetPath: string;
    localJsPath?: string;
    localJsExists: boolean;
    localTsPath?: string;
    localTsExists: boolean;
}> => {
    const config = projectConfig ?? (await getProjectConfig(projectRoot));
    const sdfSrcDir = await getSdfSrcDir(projectRoot, config);
    const tsProject = await loadTsProject(projectRoot, config);

    const normalizedFc = normalizeScriptFileCabinetPath(fileCabinetPath);
    const rawFc = (fileCabinetPath.startsWith("/") ? fileCabinetPath : `/${fileCabinetPath}`).replace(
        /\\/g,
        "/"
    );

    // 1. Resolve local compiled .js path (preferring normalized /SuiteScripts/... path, with fallback check on raw path)
    let resolvedJs = await resolveProjectFile(projectRoot, normalizedFc, config, sdfSrcDir, tsProject);
    if (!resolvedJs.existsOnDisk && rawFc.toLowerCase() !== normalizedFc.toLowerCase()) {
        const altJs = await resolveProjectFile(projectRoot, rawFc, config, sdfSrcDir, tsProject);
        if (altJs.existsOnDisk) {
            resolvedJs = altJs;
        }
    }

    // Also check tsconfig.outDir / config.jsOutDir directly if resolveProjectFile fell back to FileCabinet root
    const relJsFromSuiteScripts = normalizedFc.replace(/^\/SuiteScripts\//i, "");
    if (!resolvedJs.existsOnDisk) {
        const jsDirCandidates: string[] = [];
        if (config.jsOutDir) {
            jsDirCandidates.push(path.resolve(projectRoot, config.jsOutDir));
        }
        if (tsProject?.outDir) {
            jsDirCandidates.push(tsProject.outDir);
        }
        jsDirCandidates.push(path.join(sdfSrcDir, "FileCabinet", "SuiteScripts"));

        for (const jsDir of jsDirCandidates) {
            const candidateJs = path.resolve(jsDir, relJsFromSuiteScripts);
            if (await fileExists(candidateJs)) {
                resolvedJs = {
                    ...resolvedJs,
                    localOutputPath: candidateJs,
                    existsOnDisk: true
                };
                break;
            }
        }
    }

    const relLocalJsPath = (
        path.relative(projectRoot, resolvedJs.localOutputPath) || resolvedJs.localOutputPath
    ).replace(/\\/g, "/");
    const localJsExists = resolvedJs.existsOnDisk;

    // 2. Resolve local TypeScript .ts path using config.tsRootDir, tsconfig.json rootDir, and standard directories
    const relTsFromSuiteScripts = relJsFromSuiteScripts.replace(/\.js$/i, ".ts");
    const relTsFromFcRoot = normalizedFc.replace(/^\//, "").replace(/\.js$/i, ".ts");

    const tsCandidates: string[] = [];
    if (config.tsRootDir) {
        tsCandidates.push(path.resolve(projectRoot, config.tsRootDir, relTsFromSuiteScripts));
        tsCandidates.push(path.resolve(projectRoot, config.tsRootDir, relTsFromFcRoot));
    }
    if (tsProject?.rootDir) {
        tsCandidates.push(path.resolve(tsProject.rootDir, relTsFromSuiteScripts));
        tsCandidates.push(path.resolve(tsProject.rootDir, relTsFromFcRoot));
    }
    tsCandidates.push(
        path.resolve(projectRoot, "TypeScripts", relTsFromSuiteScripts),
        path.resolve(projectRoot, "src", "TypeScripts", relTsFromSuiteScripts),
        path.resolve(projectRoot, "src", "FileCabinet", relTsFromFcRoot),
        path.resolve(projectRoot, "FileCabinet", relTsFromFcRoot),
        path.resolve(sdfSrcDir, "FileCabinet", relTsFromFcRoot),
        path.resolve(projectRoot, "src", relTsFromSuiteScripts)
    );

    let matchedTsAbsPath: string | undefined;
    for (const candidate of tsCandidates) {
        if (await fileExists(candidate)) {
            matchedTsAbsPath = candidate;
            break;
        }
    }

    // If not found in direct candidate paths, also check tsconfig parsed fileNames by suffix
    if (!matchedTsAbsPath && tsProject && tsProject.commandLine.fileNames.length > 0) {
        const targetSuffix = "/" + relTsFromSuiteScripts.replace(/\\/g, "/").toLowerCase();
        const foundInTsConfig = tsProject.commandLine.fileNames.find((f) =>
            path.resolve(f).replace(/\\/g, "/").toLowerCase().endsWith(targetSuffix)
        );
        if (foundInTsConfig && (await fileExists(foundInTsConfig))) {
            matchedTsAbsPath = path.resolve(foundInTsConfig);
        }
    }

    // If a TypeScript project is configured (config.tsRootDir or tsconfig.json) even when the .ts file doesn't exist on disk,
    // compute the expected relative localTsPath so callers can see where the .ts file would live
    let expectedTsAbsPath = matchedTsAbsPath;
    if (!expectedTsAbsPath) {
        if (config.tsRootDir) {
            expectedTsAbsPath = path.resolve(projectRoot, config.tsRootDir, relTsFromSuiteScripts);
        } else if (tsProject?.rootDir) {
            expectedTsAbsPath = path.resolve(tsProject.rootDir, relTsFromSuiteScripts);
        } else if (await fileExists(path.resolve(projectRoot, "TypeScripts"))) {
            expectedTsAbsPath = path.resolve(projectRoot, "TypeScripts", relTsFromSuiteScripts);
        }
    }

    const relLocalTsPath = expectedTsAbsPath
        ? (path.relative(projectRoot, expectedTsAbsPath) || expectedTsAbsPath).replace(/\\/g, "/")
        : undefined;
    const localTsExists = Boolean(matchedTsAbsPath);

    return {
        fileCabinetPath: normalizedFc,
        localJsPath: relLocalJsPath,
        localJsExists,
        ...(relLocalTsPath !== undefined
            ? { localTsPath: relLocalTsPath, localTsExists }
            : { localTsExists: false })
    };
};

/**
 * Loads the live fields of a `scriptdeployment` record from NetSuite via the MCP RESTlet (`RECORD_SAMPLE` action)
 * using the deployment's `primarykey`.
 * Returns `fields` (including all `custscript_*` parameter values, `url`, `externalurl`, and audience fields).
 */
export const fetchLiveScriptDeploymentRecordFields = async (
    primaryKey: number
): Promise<Record<string, any> | null> => {
    if (!Number.isFinite(primaryKey) || primaryKey <= 0) {
        return null;
    }

    try {
        const response = await callNetsuiteRestlet({
            action: "RECORD_SAMPLE",
            recordType: "scriptdeployment",
            recordId: String(primaryKey)
        });

        const fields = response?.recordData?.fields;
        if (response?.success && fields && typeof fields === "object") {
            return fields as Record<string, any>;
        }
    } catch {
        // Ignore if record.load fails or role lacks permission
    }

    return null;
};

/**
 * Checks whether an SDF XML object contains any `[ACCOUNT_SPECIFIC_VALUE]` placeholder strings.
 */
export const containsAccountSpecificValuePlaceholder = (val: unknown): boolean => {
    if (!val) return false;
    if (typeof val === "string") {
        return val.includes("[ACCOUNT_SPECIFIC_VALUE]");
    }
    if (Array.isArray(val)) {
        return val.some(containsAccountSpecificValuePlaceholder);
    }
    if (typeof val === "object") {
        return Object.values(val as Record<string, unknown>).some(
            containsAccountSpecificValuePlaceholder
        );
    }
    return false;
};

/**
 * Replaces `[ACCOUNT_SPECIFIC_VALUE]` placeholders inside an imported SDF script XML object (`imported.rootObj`)
 * using:
 * 1. Any local project `<scriptId>.xml` concrete values (if present), and
 * 2. Live `scriptdeployment` record fields loaded from NetSuite via `RECORD_SAMPLE` (`record.load({ type: 'scriptdeployment', id: primaryKey })`).
 */
export const hydrateAccountSpecificValuesInParsedScript = async (
    scriptId: string,
    imported: ParsedScriptXml,
    localFallback?: ParsedScriptXml | null
): Promise<ParsedScriptXml> => {
    if (!containsAccountSpecificValuePlaceholder(imported.rootObj)) {
        return imported;
    }

    const rootObj: Record<string, any> = JSON.parse(JSON.stringify(imported.rootObj));
    const localRootObj = localFallback?.rootObj;

    // 1. Hydrate `<scriptcustomfields>` from local XML if any `<defaultselection>` or `<defaultvalue>` is `[ACCOUNT_SPECIFIC_VALUE]`
    if (rootObj.scriptcustomfields?.scriptcustomfield && localRootObj?.scriptcustomfields?.scriptcustomfield) {
        const importedFields = ensureArray<Record<string, any>>(
            rootObj.scriptcustomfields.scriptcustomfield
        );
        const localFields = ensureArray<Record<string, any>>(
            localRootObj.scriptcustomfields.scriptcustomfield
        );

        for (const impField of importedFields) {
            const fid = String(impField?.["@scriptid"] || "").toLowerCase();
            const locField = localFields.find(
                (lf) => String(lf?.["@scriptid"] || "").toLowerCase() === fid
            );
            if (!locField) continue;

            for (const [k, v] of Object.entries(impField)) {
                if (
                    typeof v === "string" &&
                    v.includes("[ACCOUNT_SPECIFIC_VALUE]") &&
                    typeof locField[k] === "string" &&
                    !locField[k].includes("[ACCOUNT_SPECIFIC_VALUE]")
                ) {
                    impField[k] = locField[k];
                }
            }
        }
        rootObj.scriptcustomfields.scriptcustomfield = importedFields;
    }

    // 2. Hydrate `<scriptdeployments>` from local XML and live NetSuite `scriptdeployment` records
    if (rootObj.scriptdeployments?.scriptdeployment) {
        const importedDeploys = ensureArray<Record<string, any>>(
            rootObj.scriptdeployments.scriptdeployment
        );
        const localDeploys = ensureArray<Record<string, any>>(
            localRootObj?.scriptdeployments?.scriptdeployment
        );

        // Query deployment primarykeys from SuiteQL for any deployment that still has [ACCOUNT_SPECIFIC_VALUE]
        const deployPrimaryKeyByScriptId = new Map<string, number>();
        const deploysNeedingLiveLookup = importedDeploys.filter((d) =>
            containsAccountSpecificValuePlaceholder(d)
        );

        if (deploysNeedingLiveLookup.length > 0) {
            try {
                const escapedScriptId = scriptId.replace(/'/g, "''");
                const rows = await executeSuiteQlRows(`
                    SELECT
                        d.primarykey AS primary_key,
                        d.scriptid AS deployment_id
                    FROM
                        scriptdeployment d
                        JOIN script s ON s.id = d.script
                    WHERE
                        LOWER(s.scriptid) = LOWER('${escapedScriptId}')
                `);
                for (const r of rows) {
                    const depId = String(r.deployment_id || "").toLowerCase();
                    const pk = Number(r.primary_key);
                    if (depId && Number.isFinite(pk) && pk > 0) {
                        deployPrimaryKeyByScriptId.set(depId, pk);
                    }
                }
            } catch {
                // Ignore if SuiteQL lookup fails
            }
        }

        for (const impDep of importedDeploys) {
            if (!containsAccountSpecificValuePlaceholder(impDep)) {
                continue;
            }

            const depId = String(impDep?.["@scriptid"] || "").toLowerCase();
            const locDep = localDeploys.find(
                (ld) => String(ld?.["@scriptid"] || "").toLowerCase() === depId
            );

            const pk = deployPrimaryKeyByScriptId.get(depId);
            const liveFields = pk ? await fetchLiveScriptDeploymentRecordFields(pk) : null;

            for (const [k, v] of Object.entries(impDep)) {
                if (typeof v !== "string" || !v.includes("[ACCOUNT_SPECIFIC_VALUE]")) {
                    continue;
                }

                // Prefer live value from NetSuite record.load if available
                if (liveFields && liveFields[k] !== undefined && liveFields[k] !== null) {
                    const liveVal = Array.isArray(liveFields[k])
                        ? liveFields[k].join("|")
                        : String(liveFields[k]);
                    if (!liveVal.includes("[ACCOUNT_SPECIFIC_VALUE]")) {
                        impDep[k] = liveVal;
                        continue;
                    }
                }

                // Secondary fallback: local project XML value if available
                if (
                    locDep &&
                    typeof locDep[k] === "string" &&
                    !locDep[k].includes("[ACCOUNT_SPECIFIC_VALUE]")
                ) {
                    impDep[k] = locDep[k];
                }
            }
        }

        rootObj.scriptdeployments.scriptdeployment = importedDeploys;
    }

    const updatedXmlContent = create(
        { version: "1.0", encoding: "UTF-8" },
        { [imported.rootElement]: rootObj }
    ).end({ prettyPrint: true });

    return {
        ...imported,
        rootObj,
        xmlContent: updatedXmlContent
    };
};

/**
 * Queries `scriptdeployment` rows in NetSuite for a list of script internal IDs,
 * and enriches each deployment with live `custscript_*` parameter values (and `url` / `externalUrl`)
 * via `RECORD_SAMPLE` (`record.load({ type: 'scriptdeployment', id: primaryKey })`).
 */
const fetchDeploymentsByScriptInternalIds = async (
    scriptInternalIds: number[]
): Promise<Map<number, Record<string, any>[]>> => {
    const deploymentsByScriptInternalId = new Map<number, Record<string, any>[]>();
    if (scriptInternalIds.length === 0) {
        return deploymentsByScriptInternalId;
    }

    let deployRows: Record<string, any>[] = [];
    try {
        const deploySql = `
            SELECT
                d.primarykey AS primary_key,
                d.version AS internal_id,
                d.script AS script_internal_id,
                d.scriptid AS deployment_id,
                d.title AS title,
                d.status AS status,
                d.isdeployed AS is_deployed,
                d.recordtype AS record_type,
                d.loglevel AS log_level,
                d.runasrole AS run_as_role,
                BUILTIN.DF(d.runasrole) AS run_as_role_name,
                d.isonline AS is_online
            FROM
                scriptdeployment d
            WHERE
                d.script IN (${scriptInternalIds.join(", ")})
            ORDER BY
                d.primarykey ASC
        `;
        deployRows = await executeSuiteQlRows(deploySql);
    } catch {
        const fallbackDeploySql = `
            SELECT
                d.script AS script_internal_id,
                d.scriptid AS deployment_id,
                d.title AS title,
                d.status AS status,
                d.isdeployed AS is_deployed,
                d.recordtype AS record_type,
                d.loglevel AS log_level
            FROM
                scriptdeployment d
            WHERE
                d.script IN (${scriptInternalIds.join(", ")})
        `;
        deployRows = await executeSuiteQlRows(fallbackDeploySql);
    }

    for (const dr of deployRows) {
        const sId = Number(dr.script_internal_id);
        const isDep = isSdfTrue(dr.is_deployed);
        const statusStr = dr.status != null ? String(dr.status) : undefined;
        const primaryKey = dr.primary_key != null ? Number(dr.primary_key) : undefined;
        const liveFields = primaryKey
            ? await fetchLiveScriptDeploymentRecordFields(primaryKey)
            : null;

        const parameterValues: Record<string, any> = {};
        let url: string | undefined;
        let externalUrl: string | undefined;

        if (liveFields) {
            if (typeof liveFields.url === "string" && liveFields.url.trim()) {
                url = liveFields.url.trim();
            }
            if (typeof liveFields.externalurl === "string" && liveFields.externalurl.trim()) {
                externalUrl = liveFields.externalurl.trim();
            }
            for (const [k, v] of Object.entries(liveFields)) {
                if (k.toLowerCase().startsWith("custscript_")) {
                    parameterValues[k.toLowerCase()] = v;
                }
            }
        }

        const list = deploymentsByScriptInternalId.get(sId) ?? [];
        list.push({
            ...(dr.internal_id != null ? { internalId: Number(dr.internal_id) } : {}),
            ...(primaryKey != null ? { primaryKey } : {}),
            deploymentId: String(dr.deployment_id || "").toLowerCase(),
            title: dr.title != null ? String(dr.title) : undefined,
            status: statusStr,
            isDeployed: isDep,
            recordType: dr.record_type != null ? String(dr.record_type) : undefined,
            logLevel: dr.log_level != null ? String(dr.log_level) : undefined,
            ...(dr.run_as_role != null ? { runAsRoleId: dr.run_as_role } : {}),
            ...(dr.run_as_role_name != null ? { runAsRoleName: String(dr.run_as_role_name) } : {}),
            ...(dr.is_online != null ? { isOnline: isSdfTrue(dr.is_online) } : {}),
            ...(url ? { url } : {}),
            ...(externalUrl ? { externalUrl } : {}),
            ...(Object.keys(parameterValues).length > 0 ? { parameterValues } : {})
        });
        deploymentsByScriptInternalId.set(sId, list);
    }

    return deploymentsByScriptInternalId;
};

/**
 * Loads comprehensive metadata for a NetSuite script record (and all of its deployments and parameters)
 * by either `scriptId` or `filePath`/`fileName`, correlating File Cabinet paths to local workspace files
 * and optionally importing the full SDF XML definition.
 */
export const getScriptData = async (
    projectRoot: string,
    options: GetScriptOptions,
    projectConfig?: ProjectConfig
): Promise<Record<string, any>> => {
    const resolvedConfig = projectConfig ?? (await getProjectConfig(projectRoot));
    const sdfSrcDir = await getSdfSrcDir(projectRoot, resolvedConfig);

    const rawScriptId = options.scriptId?.trim() || "";
    const rawFilePath = options.filePath?.trim() || "";

    if (!rawScriptId && !rawFilePath) {
        throw new Error("Either 'scriptId' or 'filePath' must be provided to netsuite_get_script.");
    }

    let resolvedInputFcPath: string | undefined;
    let lookupFileName: string | undefined;

    if (rawFilePath) {
        const resolved = await resolveProjectFile(projectRoot, rawFilePath, resolvedConfig, sdfSrcDir);
        resolvedInputFcPath = resolved.fileCabinetPath;
        lookupFileName = path.posix.basename(resolved.fileCabinetPath);
    }

    const whereClauses: string[] = [];
    if (rawScriptId) {
        if (/^\d+$/.test(rawScriptId)) {
            whereClauses.push(`s.id = ${Number(rawScriptId)}`);
        } else {
            const candidateIds = new Set<string>();
            const lowerRaw = rawScriptId.trim().toLowerCase().replace(/\.xml$/i, "");
            if (lowerRaw) {
                candidateIds.add(lowerRaw);
            }

            if (lowerRaw.startsWith("custevsub_")) {
                const normEvSub = normalizeEventSubscriberId(rawScriptId);
                candidateIds.add(normEvSub);
                candidateIds.add(`${normEvSub}_script`);
            } else if (lowerRaw.startsWith("customscript_")) {
                const normCustom = normalizeCustomScriptId(rawScriptId);
                candidateIds.add(normCustom);
            } else {
                const normCustom = normalizeCustomScriptId(rawScriptId);
                candidateIds.add(normCustom);
                try {
                    const normEvSub = normalizeEventSubscriberId(rawScriptId);
                    candidateIds.add(normEvSub);
                    candidateIds.add(`${normEvSub}_script`);
                } catch {
                    // Ignore if unprefixed ID is longer than the 27-char custevsub_ limit
                }
            }

            const sqlList = Array.from(candidateIds)
                .map((id) => `LOWER('${id.replace(/'/g, "''")}')`)
                .join(", ");
            whereClauses.push(`LOWER(s.scriptid) IN (${sqlList})`);
        }
    } else if (lookupFileName) {
        const escapedFile = lookupFileName.replace(/'/g, "''");
        whereClauses.push(`LOWER(f.name) = LOWER('${escapedFile}')`);
    }

    const scriptSql = `
        SELECT
            s.id AS internal_id,
            s.scriptid AS script_id,
            s.name AS name,
            s.scripttype AS script_type,
            s.description AS description,
            s.isinactive AS is_inactive,
            s.apiversion AS api_version,
            s.owner AS owner_id,
            BUILTIN.DF(s.owner) AS owner_name,
            s.notifyowner AS notify_owner,
            s.notifyuser AS notify_user,
            s.notifyemails AS notify_emails,
            s.scriptfile AS script_file_id,
            f.name AS script_file_name
        FROM
            script s
            LEFT JOIN file f ON f.id = s.scriptfile
        WHERE
            ${whereClauses.join(" AND ")}
        ORDER BY
            s.id ASC
    `;

    const scriptRows = await executeSuiteQlRows(scriptSql);

    const fileIds = scriptRows
        .map((r) => (r.script_file_id != null ? Number(r.script_file_id) : 0))
        .filter((id) => id > 0);
    const fcPathMap = await resolveRemoteFileCabinetPathsByFileIds(fileIds);

    let filteredScriptRows = scriptRows;
    if (!rawScriptId && resolvedInputFcPath && scriptRows.length > 1) {
        const exactMatches = scriptRows.filter((r) => {
            const fId = r.script_file_id != null ? Number(r.script_file_id) : 0;
            const fullPath = fcPathMap.get(fId);
            return fullPath && fullPath.toLowerCase() === resolvedInputFcPath!.toLowerCase();
        });
        if (exactMatches.length > 0) {
            filteredScriptRows = exactMatches;
        }
    }

    const scriptInternalIds = filteredScriptRows
        .map((r) => Number(r.internal_id))
        .filter((id) => Number.isFinite(id) && id > 0);

    const deploymentsByScriptInternalId = await fetchDeploymentsByScriptInternalIds(scriptInternalIds);
    const objectsDir = path.join(sdfSrcDir, "Objects");
    const enrichedScripts: Record<string, any>[] = [];

    for (const r of filteredScriptRows) {
        const sInternalId = Number(r.internal_id);
        const rawSuiteQlScriptId = String(r.script_id || "").toLowerCase();
        const sCustomId = canonicalizeSuiteQlScriptId(
            rawSuiteQlScriptId,
            r.name != null ? String(r.name) : undefined,
            r.script_type != null ? String(r.script_type) : undefined
        );
        const isEventSubscriber =
            sCustomId.startsWith("custevsub_") ||
            String(r.script_type || "").toUpperCase().includes("EVENTSUBSCRIBER");
        const fId = r.script_file_id != null ? Number(r.script_file_id) : undefined;

        const localObjectXml = await findLocalScriptXmlById(objectsDir, sCustomId);

        let sdfDefinition: Record<string, any> | undefined;
        if (options.includeSdfXml && sCustomId) {
            try {
                sdfDefinition = await withTempSdfProject(
                    {
                        projectRoot,
                        projectConfig: resolvedConfig,
                        tempDirPrefix: "netsuite-mcp-script-read-"
                    },
                    async (tempProject) => {
                        const imported = await tryImportScriptInTempProject(
                            tempProject,
                            sCustomId,
                            isEventSubscriber ? "eventsubscriber" : undefined
                        );
                        if (!imported) return undefined;
                        const hydrated = await hydrateAccountSpecificValuesInParsedScript(
                            sCustomId,
                            imported,
                            localObjectXml
                        );
                        return {
                            rootElement: hydrated.rootElement,
                            parsedObject: hydrated.rootObj,
                            rawXml: hydrated.xmlContent
                        };
                    }
                );
            } catch {
                // Ignore SDF import failure if SDF is unavailable
            }
        }

        const xmlScriptFile =
            sdfDefinition?.parsedObject?.scriptfile ||
            sdfDefinition?.parsedObject?.scriptfilepath ||
            localObjectXml?.rootObj?.scriptfile ||
            localObjectXml?.rootObj?.scriptfilepath;
        const rawFcPath =
            (typeof xmlScriptFile === "string" && xmlScriptFile.trim()
                ? normalizeScriptFileCabinetPath(xmlScriptFile)
                : undefined) ||
            (fId ? fcPathMap.get(fId) : undefined) ||
            resolvedInputFcPath ||
            (r.script_file_name ? `/SuiteScripts/${r.script_file_name}` : undefined);
        const fcPath = rawFcPath ? normalizeScriptFileCabinetPath(rawFcPath) : undefined;

        const localFileInfo = fcPath
            ? await resolveLocalPathsFromFileCabinetPath(projectRoot, fcPath, resolvedConfig)
            : undefined;

        const isInactive = isSdfTrue(r.is_inactive);
        const scriptTypeStr = String(r.script_type || "");
        const deployments = (deploymentsByScriptInternalId.get(sInternalId) ?? []).map((d) => ({
            ...d,
            isEffectivelyActive: isDeploymentEffectivelyActive(
                isInactive,
                d.isDeployed,
                d.status,
                scriptTypeStr,
                sCustomId
            )
        }));

        const criteriaSummary = extractEventSubscriberCriteriaSummary(
            sdfDefinition?.parsedObject ?? localObjectXml?.rootObj
        );

        enrichedScripts.push({
            internalId: sInternalId,
            scriptId: sCustomId,
            ...(rawSuiteQlScriptId && rawSuiteQlScriptId !== sCustomId
                ? { suiteQlScriptId: rawSuiteQlScriptId }
                : {}),
            name: String(r.name || ""),
            scriptType: String(r.script_type || ""),
            description: r.description != null ? String(r.description) : undefined,
            isInactive,
            apiVersion: r.api_version != null ? String(r.api_version) : undefined,
            ownerId: r.owner_id != null ? Number(r.owner_id) : undefined,
            ownerName: r.owner_name != null ? String(r.owner_name) : undefined,
            notifyOwner: isSdfTrue(r.notify_owner),
            notifyUser: isSdfTrue(r.notify_user),
            notifyEmails: r.notify_emails != null ? String(r.notify_emails) : undefined,
            scriptFile: {
                fileId: fId,
                fileName: r.script_file_name != null ? String(r.script_file_name) : undefined,
                fileCabinetPath: localFileInfo?.fileCabinetPath ?? fcPath,
                ...(localFileInfo
                    ? {
                          localJsPath: localFileInfo.localJsPath,
                          localJsExists: localFileInfo.localJsExists,
                          ...(localFileInfo.localTsPath !== undefined
                              ? {
                                    localTsPath: localFileInfo.localTsPath,
                                    localTsExists: localFileInfo.localTsExists
                                }
                              : {})
                      }
                    : {})
            },
            localSdfObjectXml: localObjectXml
                ? {
                      exists: true,
                      path: (
                          path.relative(projectRoot, localObjectXml.xmlPath) ||
                          localObjectXml.xmlPath
                      ).replace(/\\/g, "/"),
                      rootElement: localObjectXml.rootElement
                  }
                : { exists: false },
            ...(criteriaSummary.length > 0 ? { criteria: criteriaSummary } : {}),
            deployments,
            ...(sdfDefinition ? { sdfDefinition } : {})
        });
    }

    if (enrichedScripts.length === 0) {
        const localFallbackMatches: Record<string, any>[] = [];
        if (rawScriptId && !/^\d+$/.test(rawScriptId)) {
            const normId = normalizeCustomScriptId(rawScriptId);
            let localXml = await findLocalScriptXmlById(objectsDir, normId);
            let matchedId = normId;
            if (
                !localXml &&
                !rawScriptId.toLowerCase().startsWith("customscript_") &&
                !rawScriptId.toLowerCase().startsWith("custevsub_")
            ) {
                try {
                    const evSubId = normalizeEventSubscriberId(rawScriptId);
                    const evSubXml = await findLocalScriptXmlById(objectsDir, evSubId);
                    if (evSubXml) {
                        localXml = evSubXml;
                        matchedId = evSubId;
                    }
                } catch {
                    // Ignore if rawScriptId exceeds 27 chars for custevsub_
                }
            }
            if (localXml) {
                const criteriaSummary = extractEventSubscriberCriteriaSummary(localXml.rootObj);
                localFallbackMatches.push({
                    scriptId: matchedId,
                    source: "local_sdf_only",
                    localXmlPath: (
                        path.relative(projectRoot, localXml.xmlPath) || localXml.xmlPath
                    ).replace(/\\/g, "/"),
                    rootElement: localXml.rootElement,
                    ...(criteriaSummary.length > 0 ? { criteria: criteriaSummary } : {}),
                    parsedObject: localXml.rootObj
                });
            }
        } else if (resolvedInputFcPath) {
            const localForFile = await findLocalScriptXmlsForFileCabinetPath(
                sdfSrcDir,
                resolvedInputFcPath
            );
            for (const lm of localForFile) {
                localFallbackMatches.push({
                    scriptId: lm.scriptId,
                    name: lm.name,
                    rootElement: lm.rootElement,
                    source: "local_sdf_only",
                    localXmlPath: (
                        path.relative(projectRoot, lm.xmlPath) || lm.xmlPath
                    ).replace(/\\/g, "/")
                });
            }
        }

        return {
            foundInNetsuite: false,
            foundLocally: localFallbackMatches.length > 0,
            message:
                localFallbackMatches.length > 0
                    ? "Script was not found in the active NetSuite environment, but matching SDF object XML file(s) exist locally."
                    : "No matching script record was found in NetSuite or locally.",
            scripts: localFallbackMatches
        };
    }

    return {
        foundInNetsuite: true,
        count: enrichedScripts.length,
        scripts: enrichedScripts
    };
};

/**
 * Maps a canonical `ScriptTypeKey` to common NetSuite `script.scripttype` SuiteQL tokens.
 */
const getSuiteQlScriptTypeTokens = (rawScriptType: string): string[] => {
    const key = normalizeScriptTypeKey(rawScriptType);
    switch (key) {
        case "USEREVENT":
            return ["USEREVENT", "SCRIPTLET_USEREVENT", "USEREVENTSCRIPT"];
        case "CLIENT":
            return ["CLIENT", "CLIENTSCRIPT"];
        case "MAPREDUCE":
            return ["MAPREDUCE", "MAPREDUCESCRIPT"];
        case "SCHEDULED":
            return ["SCHEDULED", "SCHEDULEDSCRIPT"];
        case "SUITELET":
            return ["SCRIPTLET", "SUITELET"];
        case "RESTLET":
            return ["RESTLET"];
        case "WORKFLOWACTION":
            return ["ACTION", "WORKFLOWACTION", "WORKFLOWACTIONSCRIPT"];
        case "MASSUPDATE":
            return ["MASSUPDATE", "MASSUPDATESCRIPT"];
        case "PORTLET":
            return ["PORTLET"];
        case "BUNDLEINSTALLATION":
            return ["BUNDLEINSTALLATION", "BUNDLEINSTALLATIONSCRIPT"];
        case "EVENTSUBSCRIBER":
            return ["EVENTSUBSCRIBER", "EVENTSUBSCRIBERSCRIPT"];
    }
};

/**
 * Searches scripts and their deployments in NetSuite via SuiteQL with flexible filters.
 */
export const searchScriptsInNetsuite = async (
    options: SearchScriptsOptions
): Promise<Record<string, any>> => {
    const whereClauses: string[] = [];

    if (!options.includeInactive) {
        whereClauses.push(`s.isinactive = 'F'`);
    }

    if (options.recordType && options.recordType.trim() !== "") {
        const cleanedRec = options.recordType
            .trim()
            .replace(/^\[scriptid=([^\]]+)\]$/i, "$1")
            .replace(/'/g, "''");
        whereClauses.push(`UPPER(d.recordtype) = UPPER('${cleanedRec}')`);
    }

    if (options.scriptType && options.scriptType.trim() !== "") {
        const tokens = getSuiteQlScriptTypeTokens(options.scriptType);
        const tokenList = tokens.map((t) => `'${t.replace(/'/g, "''")}'`).join(", ");
        const escapedRaw = options.scriptType.trim().toUpperCase().replace(/'/g, "''");
        whereClauses.push(
            `(UPPER(s.scripttype) IN (${tokenList}) OR UPPER(BUILTIN.DF(s.scripttype)) LIKE '%${escapedRaw}%')`
        );
    }

    if (options.fileName && options.fileName.trim() !== "") {
        const baseName = path.posix
            .basename(options.fileName.trim().replace(/\\/g, "/"))
            .replace(/\.ts$/i, ".js")
            .replace(/'/g, "''");
        whereClauses.push(`LOWER(f.name) LIKE LOWER('%${baseName}%')`);
    }

    if (options.isDeployed !== undefined) {
        if (options.isDeployed) {
            whereClauses.push(
                `(d.isdeployed = 'T' OR (UPPER(s.scripttype) = 'EVENTSUBSCRIBER' AND s.isinactive = 'F'))`
            );
        } else {
            whereClauses.push(
                `(d.isdeployed = 'F' AND UPPER(s.scripttype) <> 'EVENTSUBSCRIBER')`
            );
        }
    }

    if (options.status && options.status.trim() !== "") {
        const escapedStatus = options.status.trim().toUpperCase().replace(/'/g, "''");
        whereClauses.push(
            `(UPPER(d.status) = '${escapedStatus}' OR UPPER(BUILTIN.DF(d.status)) = '${escapedStatus}')`
        );
    }

    if (options.logLevel && options.logLevel.trim() !== "") {
        const escapedLevel = options.logLevel.trim().toUpperCase().replace(/'/g, "''");
        whereClauses.push(
            `(UPPER(d.loglevel) = '${escapedLevel}' OR UPPER(BUILTIN.DF(d.loglevel)) = '${escapedLevel}')`
        );
    }

    if (options.searchTerm && options.searchTerm.trim() !== "") {
        const term = options.searchTerm.trim().replace(/'/g, "''");
        whereClauses.push(
            `(LOWER(s.name) LIKE LOWER('%${term}%') OR LOWER(s.scriptid) LIKE LOWER('%${term}%') OR LOWER(d.scriptid) LIKE LOWER('%${term}%') OR LOWER(d.title) LIKE LOWER('%${term}%') OR LOWER(f.name) LIKE LOWER('%${term}%'))`
        );
    }

    const maxLimit = Math.min(Math.max(Number(options.limit) || 100, 1), 500);
    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

    const sql = `
        SELECT
            s.id AS script_internal_id,
            s.scriptid AS script_id,
            s.name AS script_name,
            s.scripttype AS script_type,
            s.description AS script_description,
            s.isinactive AS script_is_inactive,
            s.apiversion AS api_version,
            s.scriptfile AS script_file_id,
            f.name AS script_file_name,
            d.primarykey AS deploy_primary_key,
            d.version AS deploy_internal_id,
            d.scriptid AS deployment_id,
            d.title AS deployment_title,
            d.status AS deployment_status,
            d.isdeployed AS is_deployed,
            d.recordtype AS record_type,
            d.loglevel AS log_level
        FROM
            script s
            LEFT JOIN file f ON f.id = s.scriptfile
            LEFT JOIN scriptdeployment d ON d.script = s.id
        ${whereSql}
        ORDER BY
            s.id ASC,
            d.primarykey ASC
    `;

    const rows = await executeSuiteQlRows(sql);

    const scriptsMap = new Map<number, Record<string, any>>();
    const fileIds: number[] = [];

    for (const r of rows) {
        const sId = Number(r.script_internal_id);
        if (!scriptsMap.has(sId)) {
            if (scriptsMap.size >= maxLimit) {
                continue;
            }
            const fId = r.script_file_id != null ? Number(r.script_file_id) : undefined;
            if (fId) fileIds.push(fId);

            const rawSuiteQlScriptId = String(r.script_id || "").toLowerCase();
            const canonicalScriptId = canonicalizeSuiteQlScriptId(
                rawSuiteQlScriptId,
                r.script_name != null ? String(r.script_name) : undefined,
                r.script_type != null ? String(r.script_type) : undefined
            );

            scriptsMap.set(sId, {
                internalId: sId,
                scriptId: canonicalScriptId,
                ...(rawSuiteQlScriptId && rawSuiteQlScriptId !== canonicalScriptId
                    ? { suiteQlScriptId: rawSuiteQlScriptId }
                    : {}),
                name: String(r.script_name || ""),
                scriptType: String(r.script_type || ""),
                description: r.script_description != null ? String(r.script_description) : undefined,
                isInactive: isSdfTrue(r.script_is_inactive),
                apiVersion: r.api_version != null ? String(r.api_version) : undefined,
                scriptFileId: fId,
                scriptFileName: r.script_file_name != null ? String(r.script_file_name) : undefined,
                deployments: []
            });
        }

        const scriptEntry = scriptsMap.get(sId);
        if (scriptEntry && r.deployment_id) {
            const isDep = isSdfTrue(r.is_deployed);
            const statusStr = r.deployment_status != null ? String(r.deployment_status) : undefined;

            scriptEntry.deployments.push({
                ...(r.deploy_internal_id != null ? { internalId: Number(r.deploy_internal_id) } : {}),
                ...(r.deploy_primary_key != null ? { primaryKey: Number(r.deploy_primary_key) } : {}),
                deploymentId: String(r.deployment_id || "").toLowerCase(),
                title: r.deployment_title != null ? String(r.deployment_title) : undefined,
                status: statusStr,
                isDeployed: isDep,
                isEffectivelyActive: isDeploymentEffectivelyActive(
                    scriptEntry.isInactive,
                    isDep,
                    statusStr,
                    scriptEntry.scriptType,
                    scriptEntry.scriptId
                ),
                recordType: r.record_type != null ? String(r.record_type) : undefined,
                logLevel: r.log_level != null ? String(r.log_level) : undefined
            });
        }
    }

    const fcPathMap = await resolveRemoteFileCabinetPathsByFileIds(fileIds);
    const results = Array.from(scriptsMap.values()).map((s) => ({
        ...s,
        fileCabinetPath:
            (s.scriptFileId ? fcPathMap.get(s.scriptFileId) : undefined) ||
            (s.scriptFileName ? `/SuiteScripts/${s.scriptFileName}` : undefined)
    }));

    return {
        count: results.length,
        filtersApplied: {
            ...(options.recordType ? { recordType: options.recordType } : {}),
            ...(options.scriptType ? { scriptType: options.scriptType } : {}),
            ...(options.searchTerm ? { searchTerm: options.searchTerm } : {}),
            ...(options.fileName ? { fileName: options.fileName } : {}),
            ...(options.isDeployed !== undefined ? { isDeployed: options.isDeployed } : {}),
            ...(options.status ? { status: options.status } : {}),
            ...(options.logLevel ? { logLevel: options.logLevel } : {}),
            includeInactive: Boolean(options.includeInactive)
        },
        scripts: results
    };
};
