import fs from "fs/promises";
import path from "path";
import os from "os";
import { getEnvironmentConfig } from "./config.js";
import { getSdfSrcDir, ProjectConfig } from "./project.js";
import {
    DeployConfig,
    ManifestDependencies,
    writeTemporaryDeployXml,
    updateManifestXml
} from "./deploy.js";

export interface TempSdfProjectOptions {
    /**
     * Optional workspace project root. If provided, `manifest.xml` will be copied
     * from the workspace's SDF source directory when available.
     */
    projectRoot?: string;
    /**
     * Optional pre-loaded project configuration.
     */
    projectConfig?: ProjectConfig;
    /**
     * Optional target environment name (defaults to the active environment).
     */
    environment?: string;
    /**
     * Explicit SDF auth ID override. If omitted, resolved from the environment's `sdfId`.
     */
    sdfId?: string;
    /**
     * Optional project name used when generating a fallback `manifest.xml`.
     */
    projectName?: string;
    /**
     * Optional deploy.xml configuration (supports both `files` and `objects`).
     * Defaults to `{ files: ["~/FileCabinet/*"], objects: ["~/Objects/*"] }`.
     */
    deployConfig?: DeployConfig;
    /**
     * Optional manifest dependencies (e.g., `{ objects: [...] }`) to inject into `manifest.xml`.
     */
    manifestDependencies?: ManifestDependencies;
    /**
     * Prefix for the temporary directory in `os.tmpdir()`.
     */
    tempDirPrefix?: string;
}

export interface TempSdfProject {
    /** Root path of the temporary SDF project. */
    tempDir: string;
    /** Path to `<tempDir>/FileCabinet`. */
    fileCabinetDir: string;
    /** Path to `<tempDir>/FileCabinet/SuiteScripts`. */
    suiteScriptsDir: string;
    /** Path to `<tempDir>/Objects`. */
    objectsDir: string;
    /** Path to `<tempDir>/manifest.xml`. */
    manifestXmlPath: string;
    /** Path to `<tempDir>/deploy.xml`. */
    deployXmlPath: string;
    /** Path to `<tempDir>/project.json`. */
    projectJsonPath: string;
    /** The active environment name used for this project. */
    environment: string;
    /** The SDF Auth ID configured in `<tempDir>/project.json`. */
    sdfId: string;
    /** Updates `<tempDir>/deploy.xml` with specific files and/or objects. */
    setDeployConfig: (config: DeployConfig) => Promise<void>;
    /** Adds object dependencies to `<tempDir>/manifest.xml`. */
    addManifestDependencies: (dependencies: ManifestDependencies) => Promise<void>;
    /** Resolves a NetSuite File Cabinet path (e.g., `/SuiteScripts/foo.js`) to its local path inside the temp project. */
    getLocalFileCabinetPath: (fileCabinetPath: string) => string;
    /** Resolves an object scriptId (and optional subfolder) to its local XML path inside `<tempDir>/Objects`. */
    getLocalObjectPath: (scriptId: string, subFolder?: string) => string;
    /** Removes the temporary directory and all its contents. */
    cleanup: () => Promise<void>;
}

const DEFAULT_MANIFEST_XML = (projectName = "TempSdfProject"): string =>
    `<manifest projecttype="ACCOUNTCUSTOMIZATION">
  <projectname>${projectName}</projectname>
  <frameworkversion>1.0</frameworkversion>
  <dependencies>
    <features>
      <feature required="false">SERVERSIDESCRIPTING</feature>
      <feature required="false">CUSTOMRECORDS</feature>
    </features>
  </dependencies>
</manifest>
`;

const fileExists = async (targetPath: string): Promise<boolean> => {
    try {
        await fs.access(targetPath);
        return true;
    } catch {
        return false;
    }
};

/**
 * Resolves the SDF Auth ID (`sdfId`) for the target or active environment.
 */
const resolveSdfAuthInfo = async (
    options?: TempSdfProjectOptions
): Promise<{ environment: string; sdfId: string }> => {
    if (options?.sdfId && options.sdfId.trim() !== "") {
        return {
            environment: options.environment ?? "custom",
            sdfId: options.sdfId.trim()
        };
    }

    const { environment, config } = await getEnvironmentConfig(options?.environment);
    if (!config.sdfId || typeof config.sdfId !== "string" || config.sdfId.trim() === "") {
        throw new Error(`'sdfId' is missing for environment '${environment}' in env.json.`);
    }

    return {
        environment,
        sdfId: config.sdfId.trim()
    };
};

/**
 * Scaffolds a minimal, isolated SDF project in a temporary directory that supports
 * both File Cabinet operations (`FileCabinet`) and Custom Objects (`Objects`).
 */
export const createTempSdfProject = async (
    options?: TempSdfProjectOptions
): Promise<TempSdfProject> => {
    const { environment, sdfId } = await resolveSdfAuthInfo(options);
    const prefix = options?.tempDirPrefix || "netsuite-mcp-sdf-";
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));

    try {
        const fileCabinetDir = path.join(tempDir, "FileCabinet");
        const suiteScriptsDir = path.join(fileCabinetDir, "SuiteScripts");
        const objectsDir = path.join(tempDir, "Objects");
        const manifestXmlPath = path.join(tempDir, "manifest.xml");
        const deployXmlPath = path.join(tempDir, "deploy.xml");
        const projectJsonPath = path.join(tempDir, "project.json");

        await Promise.all([
            fs.mkdir(suiteScriptsDir, { recursive: true }),
            fs.mkdir(objectsDir, { recursive: true })
        ]);

        // 1. Write project.json with defaultAuthId
        await fs.writeFile(
            projectJsonPath,
            JSON.stringify({ defaultAuthId: sdfId }, null, 2) + "\n",
            "utf-8"
        );

        // 2. Copy manifest.xml from workspace SDF source dir if available, otherwise write minimal manifest.xml
        let manifestWritten = false;
        if (options?.projectRoot) {
            try {
                const sdfSrcDir = await getSdfSrcDir(options.projectRoot, options.projectConfig);
                const sourceManifest = path.join(sdfSrcDir, "manifest.xml");
                if (await fileExists(sourceManifest)) {
                    await fs.copyFile(sourceManifest, manifestXmlPath);
                    manifestWritten = true;
                }
            } catch {
                // Fallback to default manifest
            }
        }

        if (!manifestWritten) {
            await fs.writeFile(
                manifestXmlPath,
                DEFAULT_MANIFEST_XML(options?.projectName),
                "utf-8"
            );
        }

        // 3. Apply any additional manifest dependencies
        if (options?.manifestDependencies) {
            await updateManifestXml(tempDir, options.manifestDependencies);
        }

        // 4. Write deploy.xml supporting both files and objects
        const initialDeployConfig: DeployConfig = options?.deployConfig ?? {
            files: ["~/FileCabinet/*"],
            objects: ["~/Objects/*"]
        };
        await writeTemporaryDeployXml(tempDir, initialDeployConfig);

        const setDeployConfig = async (config: DeployConfig): Promise<void> => {
            await writeTemporaryDeployXml(tempDir, config);
        };

        const addManifestDependencies = async (dependencies: ManifestDependencies): Promise<void> => {
            await updateManifestXml(tempDir, dependencies);
        };

        const getLocalFileCabinetPath = (fileCabinetPath: string): string => {
            const normalized = fileCabinetPath.replace(/^[/\\]+/, "");
            return path.join(fileCabinetDir, normalized);
        };

        const getLocalObjectPath = (scriptId: string, subFolder?: string): string => {
            const fileName = scriptId.toLowerCase().endsWith(".xml") ? scriptId : `${scriptId}.xml`;
            return subFolder
                ? path.join(objectsDir, subFolder, fileName)
                : path.join(objectsDir, fileName);
        };

        const cleanup = async (): Promise<void> => {
            try {
                await fs.rm(tempDir, { recursive: true, force: true });
            } catch {
                // Ignore cleanup errors
            }
        };

        return {
            tempDir,
            fileCabinetDir,
            suiteScriptsDir,
            objectsDir,
            manifestXmlPath,
            deployXmlPath,
            projectJsonPath,
            environment,
            sdfId,
            setDeployConfig,
            addManifestDependencies,
            getLocalFileCabinetPath,
            getLocalObjectPath,
            cleanup
        };
    } catch (error) {
        try {
            await fs.rm(tempDir, { recursive: true, force: true });
        } catch {
            // Ignore cleanup errors on failed init
        }
        throw error;
    }
};

/**
 * Convenience wrapper that scaffolds a temporary SDF project, executes a callback
 * with the project handle, and guarantees cleanup when finished.
 */
export const withTempSdfProject = async <T>(
    options: TempSdfProjectOptions,
    fn: (project: TempSdfProject) => Promise<T>
): Promise<T> => {
    const project = await createTempSdfProject(options);
    try {
        return await fn(project);
    } finally {
        await project.cleanup();
    }
};
