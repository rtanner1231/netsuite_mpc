import fs from "fs/promises";
import path from "path";
import util from "util";
import { exec } from "child_process";
import {
    ManifestDependencies,
    runSdfDeployInDir,
    updateManifestXml
} from "./deploy.js";
import { create } from "xmlbuilder2";
import { getProjectRoot } from "./mcp.js";
import {
    getProjectConfig,
    ObjectsFolderStrategy,
    ProjectConfig,
    resolveEffectiveSaveToProject
} from "./project.js";
import { TempSdfProject, withTempSdfProject } from "./tempSdfProject.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { ToolDefinition } from "../types/index.js";

const execAsync = util.promisify(exec);

type ToolReturnType = ReturnType<ToolDefinition["execute"]>;

export interface DeploySdfObjectOptions {
    /**
     * Optional per-call override for whether the deployed XML file (and manifest.xml dependencies)
     * should be copied into the local project after deployment succeeds.
     * If omitted, uses `projectConfig.saveObjectsToProject` (defaults to "auto").
     */
    saveToProject?: boolean;
    /**
     * Optional subfolder under `<sdfSourceDir>/Objects/` when saving a new object to the local project.
     * Overrides `projectConfig.objectsFolderStrategy`.
     */
    subFolder?: string;
    /**
     * Root XML element name (e.g. "customrecordtype", "customlist").
     * Used when `objectsFolderStrategy` is set to `"type"`.
     */
    rootElement?: string;
    /**
     * Optional pre-loaded project configuration.
     */
    projectConfig?: ProjectConfig;
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
 * Retrieves the current git branch and sanitizes it for use as a folder name.
 */
export const getSanitizedBranchName = async (projectRoot: string): Promise<string> => {
    try {
        const { stdout } = await execAsync("git rev-parse --abbrev-ref HEAD", { cwd: projectRoot });
        const branchName = stdout.trim();

        if (!branchName) {
            return "NoBranch";
        }

        // Replace illegal path characters
        return branchName.replace(/[\/\\:*?"<>|]/g, "_");
    } catch {
        // Fallback if the branch cannot be found
        return "NoBranch";
    }
};

/**
 * Recursively searches `<objectsDir>` for an existing `<scriptId>.xml` file.
 * If found, returns its full path so we can update it in-place rather than creating a duplicate.
 */
export const findExistingObjectFile = async (
    objectsDir: string,
    scriptId: string
): Promise<string | null> => {
    const targetFileName = (scriptId.toLowerCase().endsWith(".xml") ? scriptId : `${scriptId}.xml`).toLowerCase();

    const searchDir = async (dir: string): Promise<string | null> => {
        let entries;
        try {
            entries = await fs.readdir(dir, { withFileTypes: true });
        } catch {
            return null;
        }

        // Check files in current directory first
        for (const entry of entries) {
            if (entry.isFile() && entry.name.toLowerCase() === targetFileName) {
                return path.join(dir, entry.name);
            }
        }

        // Then recurse into subdirectories
        for (const entry of entries) {
            if (entry.isDirectory()) {
                const found = await searchDir(path.join(dir, entry.name));
                if (found) {
                    return found;
                }
            }
        }

        return null;
    };

    return searchDir(objectsDir);
};

/**
 * Resolves the destination file path inside `<sdfSrcDir>/Objects` when saving an SDF object to the local project.
 * 1. If `<scriptId>.xml` already exists anywhere under `<sdfSrcDir>/Objects`, returns that existing path.
 * 2. Otherwise, places the new file according to `explicitSubFolder` or `strategy` ("branch", "flat", or "type").
 */
export const resolveProjectObjectTargetPath = async (args: {
    projectRoot: string;
    sdfSrcDir: string;
    scriptId: string;
    strategy: ObjectsFolderStrategy;
    explicitSubFolder?: string;
    rootElement?: string;
}): Promise<{ targetPath: string; updatedExisting: boolean }> => {
    const { projectRoot, sdfSrcDir, scriptId, strategy, explicitSubFolder, rootElement } = args;
    const objectsRoot = path.join(sdfSrcDir, "Objects");
    const fileName = scriptId.toLowerCase().endsWith(".xml") ? scriptId : `${scriptId}.xml`;

    // 1. Check if this object XML already exists anywhere under Objects/
    const existingPath = await findExistingObjectFile(objectsRoot, scriptId);
    if (existingPath) {
        return { targetPath: existingPath, updatedExisting: true };
    }

    // 2. Determine target folder for a new object
    let subFolder: string | undefined = explicitSubFolder;
    if (subFolder === undefined) {
        if (strategy === "branch") {
            subFolder = await getSanitizedBranchName(projectRoot);
        } else if (strategy === "type") {
            subFolder = rootElement || undefined;
        } else {
            // "flat"
            subFolder = undefined;
        }
    }

    const targetDir = subFolder ? path.join(objectsRoot, subFolder) : objectsRoot;
    return {
        targetPath: path.join(targetDir, fileName),
        updatedExisting: false
    };
};

/**
 * Copies a deployed SDF object XML (and any manifest.xml dependencies) into the main project's SDF source directory.
 */
export const syncSdfObjectToMainProject = async (args: {
    projectRoot: string;
    sdfSrcDir: string;
    scriptId: string;
    xmlContent: string;
    strategy: ObjectsFolderStrategy;
    explicitSubFolder?: string;
    rootElement?: string;
    manifestDependencies?: ManifestDependencies;
}): Promise<{ savedPath: string; relativePath: string; updatedExisting: boolean; manifestUpdated: boolean }> => {
    const {
        projectRoot,
        sdfSrcDir,
        scriptId,
        xmlContent,
        strategy,
        explicitSubFolder,
        rootElement,
        manifestDependencies
    } = args;

    const { targetPath, updatedExisting } = await resolveProjectObjectTargetPath({
        projectRoot,
        sdfSrcDir,
        scriptId,
        strategy,
        explicitSubFolder,
        rootElement
    });

    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, xmlContent, "utf-8");

    let manifestUpdated = false;
    const hasDependencies =
        Boolean(manifestDependencies?.objects && manifestDependencies.objects.length > 0) ||
        Boolean(manifestDependencies?.features && manifestDependencies.features.length > 0) ||
        Boolean(manifestDependencies?.files && manifestDependencies.files.length > 0);
    if (manifestDependencies && hasDependencies) {
        const mainManifestPath = path.join(sdfSrcDir, "manifest.xml");
        if (await fileExists(mainManifestPath)) {
            await updateManifestXml(sdfSrcDir, manifestDependencies);
            manifestUpdated = true;
        }
    }

    const relativePath = path.relative(projectRoot, targetPath) || targetPath;
    return {
        savedPath: targetPath,
        relativePath,
        updatedExisting,
        manifestUpdated
    };
};

/**
 * Builds the standard inputSchema property definition for `saveToProject`,
 * dynamically embedding the current effective default for the active project so the AI agent
 * knows whether omitting it will save files to the local repo or deploy in the background.
 */
export const getSaveToProjectSchemaProperty = (effectiveInfo?: {
    effectiveDefault: boolean;
    reason: string;
    objectsFolderStrategy?: ObjectsFolderStrategy;
}) => {
    let description =
        "Optional override controlling whether the deployed SDF XML file (and any manifest.xml dependencies) is copied into the local project after deployment succeeds.";

    if (effectiveInfo) {
        const { effectiveDefault, reason, objectsFolderStrategy } = effectiveInfo;
        const strategyNote =
            effectiveDefault && objectsFolderStrategy
                ? ` using the '${objectsFolderStrategy}' Objects folder strategy`
                : "";
        const oppositeAction = effectiveDefault
            ? "Pass false to deploy in the background without saving files to the local project."
            : "Pass true to copy the deployed XML file into the local project after deployment.";
        description += ` Current effective default is ${effectiveDefault} (${reason}${strategyNote}). ${oppositeAction}`;
    } else {
        description +=
            " If omitted, uses the project's 'saveObjectsToProject' setting (defaults to 'auto', which copies files if an SDF manifest.xml or Objects directory exists locally).";
    }

    return {
        type: "boolean",
        description
    };
};

/**
 * Deploys an already-populated object inside an active `TempSdfProject` and optionally syncs it to the main project.
 */
export const deployObjectFromTempProject = async (args: {
    tempProject: TempSdfProject;
    projectRoot: string;
    scriptId: string;
    xmlContent: string;
    manifestDependencies?: ManifestDependencies;
    options?: DeploySdfObjectOptions;
}): Promise<string> => {
    const { tempProject, projectRoot, scriptId, xmlContent, manifestDependencies, options } = args;
    return deployObjectsFromTempProject({
        tempProject,
        projectRoot,
        objects: [
            {
                scriptId,
                xmlContent,
                rootElement: options?.rootElement
            }
        ],
        manifestDependencies,
        options
    });
};

export interface BatchDeploySdfObjectItem {
    scriptId: string;
    xmlContent: string;
    rootElement?: string;
    subFolder?: string;
}

/**
 * Deploys one or more SDF objects in a single `suitecloud project:deploy` pass inside an active `TempSdfProject`,
 * and optionally syncs all deployed XML files (and manifest.xml dependencies) to the main project.
 */
export const deployObjectsFromTempProject = async (args: {
    tempProject: TempSdfProject;
    projectRoot: string;
    objects: BatchDeploySdfObjectItem[];
    manifestDependencies?: ManifestDependencies;
    options?: DeploySdfObjectOptions;
}): Promise<string> => {
    const { tempProject, projectRoot, objects, manifestDependencies, options } = args;
    const projectConfig = options?.projectConfig ?? (await getProjectConfig(projectRoot));

    const deployObjectPaths: string[] = [];
    for (const item of objects) {
        const tempObjectPath = tempProject.getLocalObjectPath(item.scriptId);
        await fs.mkdir(path.dirname(tempObjectPath), { recursive: true });
        await fs.writeFile(tempObjectPath, item.xmlContent, "utf-8");

        const fileName = path.basename(tempObjectPath);
        deployObjectPaths.push(`~/Objects/${fileName}`);
    }

    await tempProject.setDeployConfig({
        objects: deployObjectPaths
    });

    if (manifestDependencies) {
        await tempProject.addManifestDependencies(manifestDependencies);
    }

    const deployResult = await runSdfDeployInDir(tempProject.tempDir);
    if (!deployResult.success) {
        return deployResult.output;
    }

    const effectiveSaveInfo = await resolveEffectiveSaveToProject(projectRoot, projectConfig);
    const shouldSave =
        typeof options?.saveToProject === "boolean"
            ? options.saveToProject
            : effectiveSaveInfo.effectiveDefault;

    if (shouldSave) {
        if (objects.length === 1) {
            const single = objects[0];
            const syncResult = await syncSdfObjectToMainProject({
                projectRoot,
                sdfSrcDir: effectiveSaveInfo.sdfSrcDir,
                scriptId: single.scriptId,
                xmlContent: single.xmlContent,
                strategy: effectiveSaveInfo.objectsFolderStrategy,
                explicitSubFolder: single.subFolder ?? options?.subFolder,
                rootElement: single.rootElement ?? options?.rootElement,
                manifestDependencies
            });

            const actionLabel = syncResult.updatedExisting
                ? "Updated existing project file"
                : "Saved to project";
            const manifestNote = syncResult.manifestUpdated ? " (and updated manifest.xml dependencies)" : "";

            return `${deployResult.output}\n[${actionLabel}: ${syncResult.relativePath}${manifestNote}]`;
        }

        const savedNotes: string[] = [];
        let anyManifestUpdated = false;
        for (let i = 0; i < objects.length; i++) {
            const item = objects[i];
            const isLast = i === objects.length - 1;
            const syncResult = await syncSdfObjectToMainProject({
                projectRoot,
                sdfSrcDir: effectiveSaveInfo.sdfSrcDir,
                scriptId: item.scriptId,
                xmlContent: item.xmlContent,
                strategy: effectiveSaveInfo.objectsFolderStrategy,
                explicitSubFolder: item.subFolder ?? options?.subFolder,
                rootElement: item.rootElement ?? options?.rootElement,
                manifestDependencies: isLast ? manifestDependencies : undefined
            });
            if (syncResult.manifestUpdated) {
                anyManifestUpdated = true;
            }
            const actionLabel = syncResult.updatedExisting ? "Updated" : "Saved";
            savedNotes.push(`${actionLabel} ${syncResult.relativePath}`);
        }

        const manifestNote = anyManifestUpdated ? " (and updated manifest.xml dependencies)" : "";
        return `${deployResult.output}\n[Project Sync (${objects.length} files): ${savedNotes.join(", ")}${manifestNote}]`;
    }

    const skipReason =
        typeof options?.saveToProject === "boolean"
            ? "saveToProject=false"
            : effectiveSaveInfo.reason;
    return `${deployResult.output}\n[Background deployment only — XML was not copied to the local project (${skipReason}).]`;
};

/**
 * Writes an XML string to a temporary SDF project, deploys it via SuiteCloud CLI,
 * and optionally copies the deployed XML file (and manifest dependencies) into the main project.
 */
export const deploySdfObject = async (
    projectRoot: string,
    scriptId: string,
    xmlContent: string,
    manifestDependencies?: ManifestDependencies,
    options?: DeploySdfObjectOptions
): Promise<string> => {
    const projectConfig = options?.projectConfig ?? (await getProjectConfig(projectRoot));

    return withTempSdfProject(
        {
            projectRoot,
            projectConfig,
            tempDirPrefix: "netsuite-mcp-obj-deploy-"
        },
        async (tempProject) => {
            return deployObjectFromTempProject({
                tempProject,
                projectRoot,
                scriptId,
                xmlContent,
                manifestDependencies,
                options: {
                    ...options,
                    projectConfig
                }
            });
        }
    );
};

/**
 * Downloads the latest XML representation of an object via SDF inside a temporary SDF project.
 * @returns The file path of the downloaded object inside `<tempProject.objectsDir>`.
 */
export const downloadSdfObjectInTempProject = async (
    tempProject: TempSdfProject,
    scriptId: string,
    type = "ALL"
): Promise<string> => {
    const command = `suitecloud object:import --type ${type} --scriptid ${scriptId} --destinationfolder /Objects`;
    await execAsync(command, { cwd: tempProject.tempDir });

    return tempProject.getLocalObjectPath(scriptId);
};

/**
 * Downloads the latest XML representation of an object via SDF using an isolated temporary SDF project.
 * @returns The XML content and the downloaded file name.
 */
export const downloadSdfObjectXml = async (
    projectRoot: string,
    scriptId: string,
    type = "ALL"
): Promise<string> => {
    const projectConfig = await getProjectConfig(projectRoot);
    return withTempSdfProject(
        {
            projectRoot,
            projectConfig,
            tempDirPrefix: "netsuite-mcp-obj-import-"
        },
        async (tempProject) => {
            const downloadedPath = await downloadSdfObjectInTempProject(tempProject, scriptId, type);
            return await fs.readFile(downloadedPath, "utf-8");
        }
    );
};

/**
 * Generates an SDF-compliant XML string from a JavaScript object.
 * @param rootElement The root XML element name (e.g., 'customrecordtype')
 * @param scriptId The internal ID of the object
 * @param data The nested object representing fields, nodes, and attributes
 */
export const generateSdfXml = (rootElement: string, scriptId: string, data: Record<string, any>): string => {
    const xmlObject = {
        [rootElement]: {
            "@scriptid": scriptId,
            ...data
        }
    };

    const doc = create({ version: "1.0", encoding: "UTF-8" }, xmlObject);
    return doc.end({ prettyPrint: true });
};

export const generateAndDeploySdf = async (args: {
    rootElement: string;
    scriptId: string;
    data: Record<string, any>;
    server: Server;
    manifestDependencies?: ManifestDependencies;
    saveToProject?: boolean;
    subFolder?: string;
}): ToolReturnType => {
    try {
        const { rootElement, scriptId, data, server, manifestDependencies, saveToProject, subFolder } = args;
        const xmlContent = generateSdfXml(rootElement, scriptId, data);
        const projectRoot = await getProjectRoot(server);

        const output = await deploySdfObject(projectRoot, scriptId, xmlContent, manifestDependencies, {
            saveToProject,
            subFolder,
            rootElement
        });
        return { content: [{ type: "text", text: output }] };
    } catch (error: any) {
        return { content: [{ type: "text", text: `Unexpected Tool Error: ${error.message}` }] };
    }
};
