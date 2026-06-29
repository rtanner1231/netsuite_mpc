import fs from "fs/promises";
import path from "path";
import { exec } from "child_process";
import util from "util";
import { create } from "xmlbuilder2"; // Added xmlbuilder2 import
import { getActiveEnvironment, ENV_PATH } from "./config.js";

const execAsync = util.promisify(exec);

export interface DeployConfig {
    objects?: string[];
    files?: string[];
}

export interface ManifestDependencies {
    objects?: string[];
}

/**
 * Reads the current deploy.xml and returns its content.
 * This acts as our backup state before running a specific deployment.
 */
export const backupDeployXml = async (projectRoot: string): Promise<string | null> => {
    const deployXmlPath = path.join(projectRoot, "deploy.xml");
    try {
        return await fs.readFile(deployXmlPath, "utf-8");
    } catch (error: any) {
        if (error.code === "ENOENT") {
            return null; // File doesn't exist (unlikely in a valid SDF project, but possible)
        }
        throw new Error(`Failed to read deploy.xml: ${error.message}`);
    }
};

/**
 * Overwrites deploy.xml with a temporary, minimal configuration 
 * targeting only the specific objects/files we want to deploy.
 */
export const writeTemporaryDeployXml = async (projectRoot: string, config: DeployConfig): Promise<void> => {
    const deployXmlPath = path.join(projectRoot, "deploy.xml");

    let tempXml = `<deploy>\n`;

    if (config.objects && config.objects.length > 0) {
        tempXml += `    <objects>\n`;
        config.objects.forEach(p => {
            tempXml += `        <path>${p}</path>\n`;
        });
        tempXml += `    </objects>\n`;
    }

    if (config.files && config.files.length > 0) {
        tempXml += `    <files>\n`;
        config.files.forEach(p => {
            tempXml += `        <path>${p}</path>\n`;
        });
        tempXml += `    </files>\n`;
    }

    tempXml += `</deploy>`;

    await fs.writeFile(deployXmlPath, tempXml, "utf-8");
};

/**
 * Reads, updates, and overwrites manifest.xml to ensure the requested dependency objects are present.
 */
export const updateManifestXml = async (projectRoot: string, dependencies: ManifestDependencies): Promise<void> => {
    if (!dependencies.objects || dependencies.objects.length === 0) return;

    const manifestPath = path.join(projectRoot, "manifest.xml");
    let xmlContent = "";

    try {
        xmlContent = await fs.readFile(manifestPath, "utf-8");
    } catch (error: any) {
        if (error.code === "ENOENT") {
            throw new Error(`manifest.xml not found at ${manifestPath}`);
        }
        throw new Error(`Failed to read manifest.xml: ${error.message}`);
    }

    const doc = create(xmlContent);
    const obj = doc.toObject() as any;

    // Ensure the node hierarchy exists
    if (!obj.manifest) {
        obj.manifest = {};
    }
    if (!obj.manifest.dependencies) {
        obj.manifest.dependencies = {};
    }
    if (!obj.manifest.dependencies.objects) {
        obj.manifest.dependencies.objects = {};
    }

    let currentObjects = obj.manifest.dependencies.objects.object;

    // Normalize to array since xmlbuilder2 maps a single node to an object and multiple to an array
    if (currentObjects === undefined) {
        currentObjects = [];
    } else if (!Array.isArray(currentObjects)) {
        currentObjects = [currentObjects];
    }

    let isModified = false;

    // Append new objects if they don't already exist
    for (const newObj of dependencies.objects) {
        if (!currentObjects.includes(newObj)) {
            currentObjects.push(newObj);
            isModified = true;
        }
    }

    if (isModified) {
        obj.manifest.dependencies.objects.object = currentObjects;

        // Convert the updated object back to formatted XML string, preserving the declaration
        const updatedXml = create({ version: "1.0", encoding: "UTF-8" }, obj).end({ prettyPrint: true });
        await fs.writeFile(manifestPath, updatedXml, "utf-8");
    }
};

/**
 * Restores the deploy.xml to its original state using the backup string.
 */
export const restoreDeployXml = async (srcPath: string, originalContent: string | null): Promise<void> => {
    const deployXmlPath = path.join(srcPath, "deploy.xml");

    if (originalContent === null) {
        // If it didn't exist originally, delete the temporary one
        try {
            await fs.unlink(deployXmlPath);
        } catch (e) {
            // Ignore if it's already gone
        }
    } else {
        await fs.writeFile(deployXmlPath, originalContent, "utf-8");
    }
};

const getSrcPath = (projectRoot: string): string => {
    //TODO: this should be configurable
    return path.join(projectRoot, "dist");
}

/**
 * Runs the full, safe deployment pipeline for specific objects/files.
 * 1. Swaps project.json defaultAuthId to the active environment.
 * 2. Backs up deploy.xml.
 * 3. Writes a temporary deploy.xml with the target objects.
 * 4. Updates manifest.xml with required dependencies (if provided).
 * 5. Executes `suitecloud project:deploy`.
 * 6. Restoration of deploy.xml and project.json in a finally block.
 */
export const runDeploymentPipeline = async (
    projectRoot: string,
    deployConfig: DeployConfig,
    manifestDependencies?: ManifestDependencies // New optional parameter
): Promise<{ success: boolean; output: string }> => {
    let originalAuthId: string | null = null;
    let projectJson: any = null;
    let originalDeployXml: string | null = null;

    const projectJsonPath = path.join(projectRoot, "project.json");
    const srcPath = getSrcPath(projectRoot);

    try {
        const environment = await getActiveEnvironment();
        const envFile = await fs.readFile(ENV_PATH, "utf-8");
        const envData = JSON.parse(envFile);

        if (!envData[environment]?.sdfId) {
            return { success: false, output: `Failure: 'sdfId' missing for environment '${environment}' in env.json.` };
        }
        const targetSdfId = envData[environment].sdfId;

        try {
            const projectJsonStr = await fs.readFile(projectJsonPath, "utf-8");
            projectJson = JSON.parse(projectJsonStr);
        } catch (e) {
            return { success: false, output: `Failure: Could not read project.json at ${projectJsonPath}.` };
        }

        if (projectJson.defaultAuthId !== targetSdfId) {
            originalAuthId = projectJson.defaultAuthId;
            projectJson.defaultAuthId = targetSdfId;
            await fs.writeFile(projectJsonPath, JSON.stringify(projectJson, null, 2));
        }

        originalDeployXml = await backupDeployXml(srcPath);
        await writeTemporaryDeployXml(srcPath, deployConfig);

        if (manifestDependencies) {
            await updateManifestXml(srcPath, manifestDependencies);
        }

        try {
            const { stdout } = await execAsync(`suitecloud project:deploy`, { cwd: projectRoot });
            return { success: true, output: `Success!\nOutput:\n${stdout}` };
        } catch (execError: any) {
            const errorOutput = execError.stdout || execError.stderr || execError.message;
            return { success: false, output: `Deployment Validation/Execution Failed:\n${errorOutput}` };
        }

    } catch (error: any) {
        return { success: false, output: `Pipeline setup error: ${error.message}` };
    } finally {
        //restore the deploy.xml and the sdf auth id if it was changes

        await restoreDeployXml(srcPath, originalDeployXml);

        if (originalAuthId !== null && projectJson !== null) {
            try {
                projectJson.defaultAuthId = originalAuthId;
                await fs.writeFile(projectJsonPath, JSON.stringify(projectJson, null, 2));
            } catch (e) {
                console.error("Warning: Failed to restore defaultAuthId in project.json");
            }
        }
    }
};
