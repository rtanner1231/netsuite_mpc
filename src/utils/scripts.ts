import fs from "fs/promises";
import path from "path";
import { ManifestDependencies, runSdfDeployInDir } from "./deploy.js";
import { syncSdfObjectToMainProject } from "./objects.js";
import {
    getProjectConfig,
    getSdfSrcDir,
    ProjectConfig,
    ResolvedProjectFile,
    resolveEffectiveSaveToProject,
    resolveProjectFile,
    runProjectBuild
} from "./project.js";
import { TempSdfProject, withTempSdfProject } from "./tempSdfProject.js";
import {
    DeployScriptInput,
    inspectScriptSourceFile,
    normalizeCustomScriptId,
    normalizeScriptTypeKey,
    ParsedScriptXml,
    SCRIPT_TYPE_METADATA,
    ScriptTypeKey,
    scriptTypeKeyFromSdfRoot,
    SourceInspectionResult,
    SUPPORTED_SCRIPT_TYPES
} from "./scriptTypes.js";
import { buildMergedScriptXml } from "./scriptXml.js";
import {
    findLocalScriptXmlById,
    findLocalScriptXmlsForFileCabinetPath,
    findRemoteScriptsForFileCabinetPath,
    hydrateAccountSpecificValuesInParsedScript,
    resolveNetsuiteAccountTimeZone,
    tryImportScriptInTempProject
} from "./scriptQueries.js";

// Re-export all types and helpers so callers can continue importing from `./scripts.js`
export * from "./scriptTypes.js";
export * from "./scriptXml.js";
export * from "./scriptQueries.js";

const fileExists = async (targetPath: string): Promise<boolean> => {
    try {
        await fs.access(targetPath);
        return true;
    } catch {
        return false;
    }
};

/**
 * Step 1 of `deployScriptInSdf`: When `filePath` is provided, conditionally builds the project,
 * resolves the primary script file and any `additionalFiles` to local disk + File Cabinet paths,
 * and inspects the source file for `@NScriptType`, `@NApiVersion`, and exported entry-point functions.
 */
const buildAndResolveScriptFiles = async (args: {
    projectRoot: string;
    sdfSrcDir: string;
    input: DeployScriptInput;
    projectConfig: ProjectConfig;
}): Promise<{
    primaryResolvedFile?: ResolvedProjectFile;
    additionalResolvedFiles: ResolvedProjectFile[];
    sourceInspection: SourceInspectionResult;
}> => {
    const { projectRoot, sdfSrcDir, input, projectConfig } = args;
    const hasFilePath = Boolean(input.filePath && input.filePath.trim() !== "");

    if (!hasFilePath) {
        return {
            additionalResolvedFiles: [],
            sourceInspection: { detectedExports: new Set() }
        };
    }

    const trimmedPrimary = input.filePath!.trim();
    const extraInputs = Array.isArray(input.additionalFiles)
        ? input.additionalFiles.map((f) => f.trim()).filter(Boolean)
        : [];

    if (!input.skipFileUpload) {
        const buildResult = await runProjectBuild(
            projectRoot,
            { skipBuild: input.skipBuild, filePaths: [trimmedPrimary, ...extraInputs] },
            projectConfig
        );
        if (!buildResult.success) {
            throw new Error(buildResult.error || "Project build failed.");
        }
    }

    const primaryResolvedFile = await resolveProjectFile(
        projectRoot,
        trimmedPrimary,
        projectConfig,
        sdfSrcDir
    );

    if (!input.skipFileUpload && !primaryResolvedFile.existsOnDisk) {
        throw new Error(
            `Local compiled output file not found on disk for '${primaryResolvedFile.inputPath}' (expected at ${primaryResolvedFile.localOutputPath}).`
        );
    }

    const additionalResolvedFiles: ResolvedProjectFile[] = [];
    for (const extraPath of extraInputs) {
        const resolvedExtra = await resolveProjectFile(
            projectRoot,
            extraPath,
            projectConfig,
            sdfSrcDir
        );
        if (!input.skipFileUpload && !resolvedExtra.existsOnDisk) {
            throw new Error(
                `Additional local output file not found on disk for '${resolvedExtra.inputPath}' (expected at ${resolvedExtra.localOutputPath}).`
            );
        }
        additionalResolvedFiles.push(resolvedExtra);
    }

    const strippedPrimary = trimmedPrimary.replace(/^[/\\]+/, "");
    const workspacePrimaryCandidate = path.resolve(projectRoot, strippedPrimary);
    const fileToInspect =
        path.isAbsolute(trimmedPrimary) && (await fileExists(trimmedPrimary))
            ? path.resolve(trimmedPrimary)
            : (await fileExists(workspacePrimaryCandidate))
              ? workspacePrimaryCandidate
              : primaryResolvedFile.localOutputPath;
    const sourceInspection = await inspectScriptSourceFile(fileToInspect);

    return {
        primaryResolvedFile,
        additionalResolvedFiles,
        sourceInspection
    };
};

/**
 * Step 2 of `deployScriptInSdf`: Checks NetSuite (via SuiteQL) and the local SDF project (`Objects/`)
 * for any existing script records linked to `primaryResolvedFile.fileCabinetPath`.
 * Enforces duplicate-script protection or auto-resolves `scriptId` when omitted.
 */
const resolveOrValidateTargetScriptId = async (args: {
    projectRoot: string;
    sdfSrcDir: string;
    input: DeployScriptInput;
    primaryResolvedFile?: ResolvedProjectFile;
}): Promise<{ scriptId?: string; conflictMessage?: string }> => {
    const { projectRoot, sdfSrcDir, input, primaryResolvedFile } = args;
    const hasScriptId = Boolean(input.scriptId && input.scriptId.trim() !== "");
    let requestedScriptId = hasScriptId ? normalizeCustomScriptId(input.scriptId!) : undefined;

    if (!primaryResolvedFile) {
        return { scriptId: requestedScriptId };
    }

    const [remoteMatches, localMatches] = await Promise.all([
        findRemoteScriptsForFileCabinetPath(primaryResolvedFile.fileCabinetPath),
        findLocalScriptXmlsForFileCabinetPath(sdfSrcDir, primaryResolvedFile.fileCabinetPath)
    ]);

    const existingByScriptId = new Map<
        string,
        { scriptId: string; name?: string; scriptType?: string; source: string }
    >();

    for (const rm of remoteMatches) {
        if (rm.scriptId) {
            existingByScriptId.set(rm.scriptId.toLowerCase(), {
                scriptId: rm.scriptId.toLowerCase(),
                name: rm.name,
                scriptType: rm.scriptType,
                source: "NetSuite"
            });
        }
    }

    for (const lm of localMatches) {
        const key = lm.scriptId.toLowerCase();
        const existing = existingByScriptId.get(key);
        if (existing) {
            existing.source = "NetSuite & local SDF project";
        } else {
            existingByScriptId.set(key, {
                scriptId: key,
                name: lm.name,
                scriptType: lm.rootElement,
                source: `local project (${path.relative(projectRoot, lm.xmlPath)})`
            });
        }
    }

    const existingScriptsForFile = Array.from(existingByScriptId.values());

    if (requestedScriptId) {
        const conflictingScripts = existingScriptsForFile.filter(
            (s) => s.scriptId !== requestedScriptId
        );

        if (
            conflictingScripts.length > 0 &&
            !existingByScriptId.has(requestedScriptId) &&
            !input.forceCreateNewScript
        ) {
            const conflictList = conflictingScripts
                .map(
                    (s) =>
                        `- '${s.scriptId}' (${s.name ? `name: "${s.name}", ` : ""}type: ${s.scriptType || "unknown"}, found in ${s.source})`
                )
                .join("\n");

            return {
                conflictMessage:
                    `Duplicate Script Conflict Detected: The script file '${primaryResolvedFile.fileCabinetPath}' already has existing script record(s):\n` +
                    `${conflictList}\n\n` +
                    `You passed scriptId '${requestedScriptId}', which would create a duplicate script record pointing to the same file.\n` +
                    `- If you intended to update the existing script, call netsuite_deploy_script again with scriptId set to '${conflictingScripts[0].scriptId}' (or omit scriptId).\n` +
                    `- If you intentionally want to create an additional script record for the same file, call netsuite_deploy_script again with 'forceCreateNewScript: true'.`
            };
        }

        return { scriptId: requestedScriptId };
    }

    // Caller omitted scriptId: auto-resolve if unambiguous
    if (existingScriptsForFile.length === 1) {
        return { scriptId: existingScriptsForFile[0].scriptId };
    }

    if (existingScriptsForFile.length > 1) {
        const optionsList = existingScriptsForFile
            .map((s) => `- '${s.scriptId}' (${s.name || s.scriptType || s.source})`)
            .join("\n");
        return {
            conflictMessage:
                `Ambiguous Script Target: Multiple existing script records are linked to '${primaryResolvedFile.fileCabinetPath}':\n` +
                `${optionsList}\n` +
                `Please specify the target 'scriptId' parameter explicitly.`
        };
    }

    throw new Error(
        `No existing script record was found for '${primaryResolvedFile.fileCabinetPath}'. Please provide a 'scriptId' (e.g. 'customscript_...') and 'name' to create a new script record.`
    );
};

/**
 * Step 3 of `deployScriptInSdf`: Loads any existing script XML definition from NetSuite (via `suitecloud object:import`)
 * or from the local project's `Objects/` directory, and resolves the canonical `ScriptTypeKey`.
 */
const loadExistingAndResolveScriptType = async (args: {
    tempProject: TempSdfProject;
    sdfSrcDir: string;
    finalScriptId: string;
    input: DeployScriptInput;
    sourceInspection: SourceInspectionResult;
}): Promise<{
    existingImport: ParsedScriptXml | null;
    scriptTypeKey: ScriptTypeKey;
}> => {
    const { tempProject, sdfSrcDir, finalScriptId, input, sourceInspection } = args;

    const explicitTypeKey = input.scriptType
        ? normalizeScriptTypeKey(input.scriptType)
        : sourceInspection.scriptType;
    const knownRootElement = explicitTypeKey
        ? SCRIPT_TYPE_METADATA[explicitTypeKey].sdfRootElement
        : undefined;

    const objectsDir = path.join(sdfSrcDir, "Objects");
    const localXml = await findLocalScriptXmlById(objectsDir, finalScriptId);

    let existingImport = await tryImportScriptInTempProject(
        tempProject,
        finalScriptId,
        knownRootElement
    );

    if (existingImport) {
        existingImport = await hydrateAccountSpecificValuesInParsedScript(
            finalScriptId,
            existingImport,
            localXml
        );
    } else if (localXml) {
        existingImport = localXml;
    }

    if (existingImport) {
        const importedTypeKey = scriptTypeKeyFromSdfRoot(existingImport.rootElement);
        if (!importedTypeKey) {
            throw new Error(
                `Unsupported SDF root element '<${existingImport.rootElement}>' on existing script '${finalScriptId}'.`
            );
        }
        if (explicitTypeKey && explicitTypeKey !== importedTypeKey) {
            throw new Error(
                `Script type mismatch for '${finalScriptId}': existing script is '${importedTypeKey}' (<${existingImport.rootElement}>), but '${explicitTypeKey}' was requested.`
            );
        }
        return { existingImport, scriptTypeKey: importedTypeKey };
    }

    if (explicitTypeKey) {
        return { existingImport: null, scriptTypeKey: explicitTypeKey };
    }

    throw new Error(
        `Could not determine script type for new script '${finalScriptId}'. Please provide 'scriptType' (one of: ${SUPPORTED_SCRIPT_TYPES.join(", ")}) or ensure the script file has an @NScriptType JSDoc tag.`
    );
};

/**
 * Step 4 of `deployScriptInSdf`: Stages the XML object and `.js` file(s) in `tempProject`,
 * configures `deploy.xml` and `manifest.xml`, executes `suitecloud project:deploy`,
 * and optionally syncs the deployed XML back to the main project (`saveToProject`).
 */
const stageAndExecuteScriptDeploy = async (args: {
    tempProject: TempSdfProject;
    projectRoot: string;
    projectConfig: ProjectConfig;
    finalScriptId: string;
    rootElement: string;
    orderedRootObj: Record<string, any>;
    xmlContent: string;
    objectDependencies: Set<string>;
    primaryResolvedFile?: ResolvedProjectFile;
    additionalResolvedFiles: ResolvedProjectFile[];
    skipFileUpload?: boolean;
    saveToProject?: boolean;
}): Promise<string> => {
    const {
        tempProject,
        projectRoot,
        projectConfig,
        finalScriptId,
        rootElement,
        orderedRootObj,
        xmlContent,
        objectDependencies,
        primaryResolvedFile,
        additionalResolvedFiles,
        skipFileUpload,
        saveToProject
    } = args;

    const tempObjectPath = tempProject.getLocalObjectPath(finalScriptId);
    await fs.mkdir(path.dirname(tempObjectPath), { recursive: true });
    await fs.writeFile(tempObjectPath, xmlContent, "utf-8");

    const deployFilesList: string[] = [];
    const manifestFilesList: string[] = [];

    if (primaryResolvedFile && !skipFileUpload) {
        for (const file of [primaryResolvedFile, ...additionalResolvedFiles]) {
            const destPath = tempProject.getLocalFileCabinetPath(file.fileCabinetPath);
            await fs.mkdir(path.dirname(destPath), { recursive: true });
            await fs.copyFile(file.localOutputPath, destPath);
            deployFilesList.push(`~/FileCabinet${file.fileCabinetPath}`);
        }
    } else {
        const rawScriptFile = String(orderedRootObj.scriptfile || "").trim();
        if (rawScriptFile.startsWith("[") && rawScriptFile.endsWith("]")) {
            const fcPath = rawScriptFile.slice(1, -1).trim();
            if (fcPath) {
                manifestFilesList.push(fcPath.startsWith("/") ? fcPath : `/${fcPath}`);
            }
        }
    }

    const objectFileName = path.basename(tempObjectPath);
    await tempProject.setDeployConfig({
        ...(deployFilesList.length > 0 ? { files: Array.from(new Set(deployFilesList)) } : {}),
        objects: [`~/Objects/${objectFileName}`]
    });

    const manifestDependencies: ManifestDependencies = {
        features: ["SERVERSIDESCRIPTING"],
        ...(objectDependencies.size > 0 ? { objects: Array.from(objectDependencies) } : {}),
        ...(manifestFilesList.length > 0 ? { files: manifestFilesList } : {})
    };
    await tempProject.addManifestDependencies(manifestDependencies);

    const deployResult = await runSdfDeployInDir(tempProject.tempDir);
    if (!deployResult.success) {
        return deployResult.output;
    }

    const effectiveSaveInfo = await resolveEffectiveSaveToProject(projectRoot, projectConfig);
    const shouldSave =
        typeof saveToProject === "boolean" ? saveToProject : effectiveSaveInfo.effectiveDefault;

    if (shouldSave) {
        const syncManifestDeps: ManifestDependencies = {
            features: ["SERVERSIDESCRIPTING"],
            ...(objectDependencies.size > 0 ? { objects: Array.from(objectDependencies) } : {})
        };

        const syncResult = await syncSdfObjectToMainProject({
            projectRoot,
            sdfSrcDir: effectiveSaveInfo.sdfSrcDir,
            scriptId: finalScriptId,
            xmlContent,
            strategy: effectiveSaveInfo.objectsFolderStrategy,
            rootElement,
            manifestDependencies: syncManifestDeps
        });

        const actionLabel = syncResult.updatedExisting
            ? "Updated existing project file"
            : "Saved to project";
        const manifestNote = syncResult.manifestUpdated
            ? " (and updated manifest.xml dependencies)"
            : "";

        return `${deployResult.output}\n[${actionLabel}: ${syncResult.relativePath}${manifestNote}]`;
    }

    const skipReason =
        typeof saveToProject === "boolean" ? "saveToProject=false" : effectiveSaveInfo.reason;
    return `${deployResult.output}\n[Background deployment only — XML was not copied to the local project (${skipReason}).]`;
};

/**
 * Full pipeline to create or update a NetSuite Script record (`customscript_*`), its parameters (`custscript_*`),
 * its deployments/schedules (`customdeploy_*`), and optionally compile & upload its script file (`.ts`/`.js`)
 * inside an isolated temporary SDF project.
 *
 * Includes duplicate-script protection: if `filePath` is already associated with an existing script record
 * whose `scriptId` differs from the passed `scriptId`, returns a conflict message unless `forceCreateNewScript: true`.
 */
export const deployScriptInSdf = async (
    projectRoot: string,
    input: DeployScriptInput,
    projectConfig?: ProjectConfig
): Promise<string> => {
    const resolvedConfig = projectConfig ?? (await getProjectConfig(projectRoot));
    const sdfSrcDir = await getSdfSrcDir(projectRoot, resolvedConfig);

    const hasFilePath = Boolean(input.filePath && input.filePath.trim() !== "");
    const hasScriptId = Boolean(input.scriptId && input.scriptId.trim() !== "");

    if (!hasFilePath && !hasScriptId) {
        throw new Error(
            "Either 'filePath' or 'scriptId' (or both) must be provided to netsuite_deploy_script."
        );
    }

    if (input.name !== undefined) {
        if (!input.name.trim()) {
            throw new Error("'name' cannot be empty.");
        }
        if (input.name.trim().length > 40) {
            throw new Error(
                `Script 'name' ('${input.name.trim()}') is ${input.name.trim().length} characters long, exceeding the NetSuite SDF limit of 40 characters.`
            );
        }
    }

    // 1. Build project and resolve local + File Cabinet script paths
    const { primaryResolvedFile, additionalResolvedFiles, sourceInspection } =
        await buildAndResolveScriptFiles({
            projectRoot,
            sdfSrcDir,
            input,
            projectConfig: resolvedConfig
        });

    // 2. Check for duplicate scripts or auto-resolve omitted scriptId
    const { scriptId: resolvedScriptId, conflictMessage } =
        await resolveOrValidateTargetScriptId({
            projectRoot,
            sdfSrcDir,
            input,
            primaryResolvedFile
        });

    if (conflictMessage) {
        return conflictMessage;
    }

    const finalScriptId = resolvedScriptId!;

    // 3. Import existing XML, merge updates, and deploy inside an isolated temporary SDF project
    return withTempSdfProject(
        {
            projectRoot,
            projectConfig: resolvedConfig,
            tempDirPrefix: "netsuite-mcp-script-deploy-"
        },
        async (tempProject) => {
            const { existingImport, scriptTypeKey } = await loadExistingAndResolveScriptType({
                tempProject,
                sdfSrcDir,
                finalScriptId,
                input,
                sourceInspection
            });

            const accountTimeZone = SCRIPT_TYPE_METADATA[scriptTypeKey].supportsSchedule
                ? await resolveNetsuiteAccountTimeZone(tempProject.environment)
                : undefined;

            const { rootElement, orderedRootObj, xmlContent, objectDependencies } =
                buildMergedScriptXml({
                    finalScriptId,
                    scriptTypeKey,
                    input,
                    existingImport,
                    fileCabinetPath: primaryResolvedFile?.fileCabinetPath,
                    sourceInspection,
                    accountTimeZone
                });

            return stageAndExecuteScriptDeploy({
                tempProject,
                projectRoot,
                projectConfig: resolvedConfig,
                finalScriptId,
                rootElement,
                orderedRootObj,
                xmlContent,
                objectDependencies,
                primaryResolvedFile,
                additionalResolvedFiles,
                skipFileUpload: input.skipFileUpload,
                saveToProject: input.saveToProject
            });
        }
    );
};
