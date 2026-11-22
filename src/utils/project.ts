import fs from "fs/promises";
import path from "path";
import { exec } from "child_process";
import util from "util";
import ts from "typescript";
import { APP_CONFIG_PATH } from "./config.js";

const execAsync = util.promisify(exec);

export type ObjectsFolderStrategy = "branch" | "flat" | "type";

export interface ProjectConfig {
    /**
     * SDF project source folder relative to projectRoot (e.g., "dist", "src", ".").
     * If omitted, auto-detected from suitecloud.config.js or manifest.xml location.
     */
    sdfSourceDir?: string;
    /**
     * Whether to run the build command before uploading files.
     * - true: Always run the build command
     * - false: Never run the build command
     * - "auto" (default): Build if a build script/command exists and TypeScript is used
     */
    buildBeforeUpload?: boolean | "auto";
    /**
     * Command to execute when building the project (defaults to "npm run build").
     */
    buildCommand?: string;
    /**
     * Optional explicit TypeScript source directory (relative to projectRoot).
     * Overrides tsconfig.json rootDir detection.
     */
    tsRootDir?: string;
    /**
     * Optional explicit compiled JavaScript output directory (relative to projectRoot).
     * Overrides tsconfig.json outDir detection.
     */
    jsOutDir?: string;
    /**
     * Optional path to tsconfig.json (relative to projectRoot, defaults to "tsconfig.json").
     */
    tsconfigPath?: string;
    /**
     * Whether deployed SDF object XML files (and manifest.xml dependencies) should be copied
     * into the local project after a successful temporary SDF project deployment.
     * - "auto" (default): Copy if an SDF project structure (manifest.xml or Objects directory) exists locally
     * - true: Always copy into the local project's SDF Objects directory
     * - false: Never copy (deploy in the background only)
     */
    saveObjectsToProject?: boolean | "auto";
    /**
     * Subfolder organization strategy when saving new SDF object XML files to `<sdfSourceDir>/Objects/`.
     * (Note: If an object XML file already exists anywhere under `Objects/`, it is always updated in-place.)
     * - "branch" (default): `<sdfSourceDir>/Objects/<git_branch>/<scriptId>.xml`
     * - "flat": `<sdfSourceDir>/Objects/<scriptId>.xml`
     * - "type": `<sdfSourceDir>/Objects/<rootElement>/<scriptId>.xml`
     */
    objectsFolderStrategy?: ObjectsFolderStrategy;
}

export interface BuildOptions {
    /** Skip building even if configured to build. */
    skipBuild?: boolean;
    /** Force running the build command even if auto-detection would skip it. */
    forceBuild?: boolean;
    /** File paths being processed (used in "auto" mode to detect .ts inputs). */
    filePaths?: string[];
}

export interface BuildResult {
    built: boolean;
    success: boolean;
    command?: string;
    stdout?: string;
    stderr?: string;
    error?: string;
}

export interface ResolvedProjectFile {
    /** The original path passed by the caller. */
    inputPath: string;
    /** The normalized NetSuite File Cabinet path (e.g., "/SuiteScripts/myScript.js"). */
    fileCabinetPath: string;
    /** The expected absolute path to the deployable file on local disk. */
    localOutputPath: string;
    /** Whether localOutputPath currently exists on disk. */
    existsOnDisk: boolean;
}

const fileExists = async (targetPath: string): Promise<boolean> => {
    try {
        await fs.access(targetPath);
        return true;
    } catch {
        return false;
    }
};

const readJsonFileIfExists = async (filePath: string): Promise<Record<string, any> | null> => {
    try {
        const content = await fs.readFile(filePath, "utf-8");
        const parsed = JSON.parse(content);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            return parsed;
        }
        return null;
    } catch {
        return null;
    }
};

const extractProjectConfigSection = (raw: Record<string, any> | null): Partial<ProjectConfig> => {
    if (!raw) return {};

    // Support dedicated sections ("project", "upload", "sdf") or direct properties
    const candidate =
        (raw.project && typeof raw.project === "object" ? raw.project : null) ??
        (raw.upload && typeof raw.upload === "object" ? raw.upload : null) ??
        (raw.sdf && typeof raw.sdf === "object" ? raw.sdf : null) ??
        raw;

    const result: Partial<ProjectConfig> = {};

    if (typeof candidate.sdfSourceDir === "string" && candidate.sdfSourceDir.trim() !== "") {
        result.sdfSourceDir = candidate.sdfSourceDir.trim();
    }
    if (
        typeof candidate.buildBeforeUpload === "boolean" ||
        candidate.buildBeforeUpload === "auto"
    ) {
        result.buildBeforeUpload = candidate.buildBeforeUpload;
    }
    if (typeof candidate.buildCommand === "string" && candidate.buildCommand.trim() !== "") {
        result.buildCommand = candidate.buildCommand.trim();
    }
    if (typeof candidate.tsRootDir === "string" && candidate.tsRootDir.trim() !== "") {
        result.tsRootDir = candidate.tsRootDir.trim();
    }
    if (typeof candidate.jsOutDir === "string" && candidate.jsOutDir.trim() !== "") {
        result.jsOutDir = candidate.jsOutDir.trim();
    }
    if (typeof candidate.tsconfigPath === "string" && candidate.tsconfigPath.trim() !== "") {
        result.tsconfigPath = candidate.tsconfigPath.trim();
    }
    if (
        typeof candidate.saveObjectsToProject === "boolean" ||
        candidate.saveObjectsToProject === "auto"
    ) {
        result.saveObjectsToProject = candidate.saveObjectsToProject;
    } else if (candidate.saveObjectsToProject === "true") {
        result.saveObjectsToProject = true;
    } else if (candidate.saveObjectsToProject === "false") {
        result.saveObjectsToProject = false;
    }
    if (
        candidate.objectsFolderStrategy === "branch" ||
        candidate.objectsFolderStrategy === "flat" ||
        candidate.objectsFolderStrategy === "type"
    ) {
        result.objectsFolderStrategy = candidate.objectsFolderStrategy;
    }

    return result;
};

/**
 * Loads and merges project configuration from:
 * 1. Defaults
 * 2. Global MCP config (~/.config/netsuite_mcp/config.json)
 * 3. Project package.json ("netsuiteMcp" field)
 * 4. Project project.json ("netsuiteMcp" field)
 * 5. Project .netsuitemcp.json
 */
export const getProjectConfig = async (projectRoot: string): Promise<ProjectConfig> => {
    const defaults: ProjectConfig = {
        buildBeforeUpload: "auto",
        buildCommand: "npm run build",
        saveObjectsToProject: "auto",
        objectsFolderStrategy: "branch"
    };

    const globalJson = await readJsonFileIfExists(APP_CONFIG_PATH);
    const globalConfig = extractProjectConfigSection(globalJson);

    const packageJson = await readJsonFileIfExists(path.join(projectRoot, "package.json"));
    const packageConfig = extractProjectConfigSection(
        packageJson?.netsuiteMcp && typeof packageJson.netsuiteMcp === "object"
            ? packageJson.netsuiteMcp
            : null
    );

    const projectJson = await readJsonFileIfExists(path.join(projectRoot, "project.json"));
    const projectJsonConfig = extractProjectConfigSection(
        projectJson?.netsuiteMcp && typeof projectJson.netsuiteMcp === "object"
            ? projectJson.netsuiteMcp
            : null
    );

    const dotConfigJson = await readJsonFileIfExists(path.join(projectRoot, ".netsuitemcp.json"));
    const dotConfig = extractProjectConfigSection(dotConfigJson);

    return {
        ...defaults,
        ...globalConfig,
        ...packageConfig,
        ...projectJsonConfig,
        ...dotConfig
    };
};

/**
 * Resolves the SDF source directory (where manifest.xml, deploy.xml, FileCabinet, and Objects live).
 * Order of precedence:
 * 1. Explicit `sdfSourceDir` from configuration
 * 2. `defaultProjectFolder` from `<projectRoot>/suitecloud.config.js`
 * 3. Directory containing `manifest.xml` (`dist`, `src`, or `.`)
 * 4. Directory containing `FileCabinet` (`dist`, `src`, or `.`)
 * 5. Fallback to `<projectRoot>/dist`
 */
export const getSdfSrcDir = async (projectRoot: string, config?: ProjectConfig): Promise<string> => {
    const resolvedConfig = config ?? (await getProjectConfig(projectRoot));

    if (resolvedConfig.sdfSourceDir) {
        return path.resolve(projectRoot, resolvedConfig.sdfSourceDir);
    }

    // Check suitecloud.config.js for defaultProjectFolder
    const suitecloudConfigPath = path.join(projectRoot, "suitecloud.config.js");
    try {
        const content = await fs.readFile(suitecloudConfigPath, "utf-8");
        const match = content.match(/defaultProjectFolder\s*:\s*['"]([^'"]+)['"]/);
        if (match && match[1]) {
            const candidate = path.resolve(projectRoot, match[1]);
            if (await fileExists(candidate)) {
                return candidate;
            }
        }
    } catch {
        // suitecloud.config.js is optional
    }

    const candidates = ["dist", "src", "."];

    for (const rel of candidates) {
        const dir = path.resolve(projectRoot, rel);
        if (await fileExists(path.join(dir, "manifest.xml"))) {
            return dir;
        }
    }

    for (const rel of candidates) {
        const dir = path.resolve(projectRoot, rel);
        if (await fileExists(path.join(dir, "FileCabinet"))) {
            return dir;
        }
    }

    return path.join(projectRoot, "dist");
};

/**
 * Checks whether a local SDF project structure exists at the resolved SDF source directory
 * (specifically whether `manifest.xml` or an `Objects` directory is present).
 */
export const hasLocalSdfObjectsStructure = async (
    projectRoot: string,
    config?: ProjectConfig
): Promise<{ exists: boolean; sdfSrcDir: string; reason: string }> => {
    const resolvedConfig = config ?? (await getProjectConfig(projectRoot));
    const sdfSrcDir = await getSdfSrcDir(projectRoot, resolvedConfig);
    const relSdfDir = path.relative(projectRoot, sdfSrcDir) || ".";

    if (await fileExists(path.join(sdfSrcDir, "manifest.xml"))) {
        return {
            exists: true,
            sdfSrcDir,
            reason: `manifest.xml found in '${relSdfDir}'`
        };
    }

    if (await fileExists(path.join(sdfSrcDir, "Objects"))) {
        return {
            exists: true,
            sdfSrcDir,
            reason: `Objects directory found in '${relSdfDir}'`
        };
    }

    return {
        exists: false,
        sdfSrcDir,
        reason: `no manifest.xml or Objects directory found in '${relSdfDir}'`
    };
};

export interface EffectiveSaveToProjectInfo {
    /** The raw configured mode ("auto", true, or false). */
    configuredMode: boolean | "auto";
    /** What the default resolves to right now (true or false). */
    effectiveDefault: boolean;
    /** Resolved SDF source directory. */
    sdfSrcDir: string;
    /** Resolved folder strategy for new objects ("branch", "flat", or "type"). */
    objectsFolderStrategy: ObjectsFolderStrategy;
    /** Human-readable explanation of why effectiveDefault is true or false. */
    reason: string;
}

/**
 * Resolves whether SDF objects should be saved to the local project by default
 * (when a tool caller does not explicitly pass `saveToProject`).
 */
export const resolveEffectiveSaveToProject = async (
    projectRoot: string,
    config?: ProjectConfig
): Promise<EffectiveSaveToProjectInfo> => {
    const resolvedConfig = config ?? (await getProjectConfig(projectRoot));
    const configuredMode = resolvedConfig.saveObjectsToProject ?? "auto";
    const objectsFolderStrategy = resolvedConfig.objectsFolderStrategy ?? "branch";

    if (configuredMode === true) {
        const sdfSrcDir = await getSdfSrcDir(projectRoot, resolvedConfig);
        return {
            configuredMode: true,
            effectiveDefault: true,
            sdfSrcDir,
            objectsFolderStrategy,
            reason: "configured as true"
        };
    }

    if (configuredMode === false) {
        const sdfSrcDir = await getSdfSrcDir(projectRoot, resolvedConfig);
        return {
            configuredMode: false,
            effectiveDefault: false,
            sdfSrcDir,
            objectsFolderStrategy,
            reason: "configured as false"
        };
    }

    const structure = await hasLocalSdfObjectsStructure(projectRoot, resolvedConfig);
    return {
        configuredMode: "auto",
        effectiveDefault: structure.exists,
        sdfSrcDir: structure.sdfSrcDir,
        objectsFolderStrategy,
        reason: `configured as 'auto' (${structure.reason})`
    };
};

/**
 * Determines whether the project should be built before uploading or deploying files.
 */
export const shouldBuildProject = async (
    projectRoot: string,
    options?: BuildOptions,
    config?: ProjectConfig
): Promise<boolean> => {
    if (options?.skipBuild) {
        return false;
    }
    if (options?.forceBuild) {
        return true;
    }

    const resolvedConfig = config ?? (await getProjectConfig(projectRoot));
    const mode = resolvedConfig.buildBeforeUpload ?? "auto";

    if (mode === false) {
        return false;
    }
    if (mode === true) {
        return true;
    }

    // "auto" mode:
    // Check if there is an explicit custom buildCommand in config or a "build" script in package.json
    const globalOrProjectRawBuildCommand = await hasConfiguredBuildCommandOrScript(projectRoot);
    if (!globalOrProjectRawBuildCommand) {
        return false;
    }

    // Build if any input file is a .ts file
    if (options?.filePaths?.some(p => p.trim().toLowerCase().endsWith(".ts"))) {
        return true;
    }

    // Build if tsconfig.json or explicit tsRootDir exists in the project
    const tsconfigPath = path.resolve(projectRoot, resolvedConfig.tsconfigPath || "tsconfig.json");
    if (await fileExists(tsconfigPath)) {
        return true;
    }

    if (resolvedConfig.tsRootDir && (await fileExists(path.resolve(projectRoot, resolvedConfig.tsRootDir)))) {
        return true;
    }

    return false;
};

const hasConfiguredBuildCommandOrScript = async (projectRoot: string): Promise<boolean> => {
    // Check if user explicitly configured buildCommand in any config file
    const globalJson = await readJsonFileIfExists(APP_CONFIG_PATH);
    const packageJson = await readJsonFileIfExists(path.join(projectRoot, "package.json"));
    const projectJson = await readJsonFileIfExists(path.join(projectRoot, "project.json"));
    const dotConfigJson = await readJsonFileIfExists(path.join(projectRoot, ".netsuitemcp.json"));

    const explicitBuildCommand =
        extractProjectConfigSection(dotConfigJson).buildCommand ??
        extractProjectConfigSection(projectJson?.netsuiteMcp).buildCommand ??
        extractProjectConfigSection(packageJson?.netsuiteMcp).buildCommand ??
        extractProjectConfigSection(globalJson).buildCommand;

    if (explicitBuildCommand) {
        return true;
    }

    if (typeof packageJson?.scripts?.build === "string" && packageJson.scripts.build.trim() !== "") {
        return true;
    }

    return false;
};

/**
 * Conditionally runs the project's build command and reports back success or failure details.
 */
export const runProjectBuild = async (
    projectRoot: string,
    options?: BuildOptions,
    config?: ProjectConfig
): Promise<BuildResult> => {
    const resolvedConfig = config ?? (await getProjectConfig(projectRoot));
    const shouldBuild = await shouldBuildProject(projectRoot, options, resolvedConfig);

    if (!shouldBuild) {
        return {
            built: false,
            success: true
        };
    }

    const command = resolvedConfig.buildCommand || "npm run build";

    try {
        const { stdout, stderr } = await execAsync(command, { cwd: projectRoot });
        return {
            built: true,
            success: true,
            command,
            stdout,
            stderr
        };
    } catch (execError: any) {
        const stdout = execError.stdout ? String(execError.stdout).trim() : "";
        const stderr = execError.stderr ? String(execError.stderr).trim() : "";
        const details = [stdout, stderr].filter(Boolean).join("\n") || execError.message;

        return {
            built: true,
            success: false,
            command,
            stdout,
            stderr,
            error: `Build failed while running '${command}':\n${details}`
        };
    }
};

interface ParsedTsProject {
    tsconfigPath: string;
    tsconfigDir: string;
    commandLine: ts.ParsedCommandLine;
    rootDir?: string;
    outDir?: string;
}

const loadTsProject = async (
    projectRoot: string,
    config: ProjectConfig
): Promise<ParsedTsProject | null> => {
    const tsconfigPath = path.resolve(projectRoot, config.tsconfigPath || "tsconfig.json");
    if (!(await fileExists(tsconfigPath))) {
        return null;
    }

    const tsconfigDir = path.dirname(tsconfigPath);
    const readResult = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
    if (readResult.error) {
        return null;
    }

    const commandLine = ts.parseJsonConfigFileContent(
        readResult.config,
        ts.sys,
        tsconfigDir
    );

    const outDir = commandLine.options.outDir
        ? path.resolve(tsconfigDir, commandLine.options.outDir)
        : undefined;

    let rootDir = commandLine.options.rootDir
        ? path.resolve(tsconfigDir, commandLine.options.rootDir)
        : undefined;

    if (!rootDir) {
        // Infer common source root from include patterns or parsed fileNames
        const rawInclude: unknown = readResult.config?.include;
        if (Array.isArray(rawInclude) && rawInclude.length === 1 && typeof rawInclude[0] === "string") {
            const firstWildcardSection = rawInclude[0].split(/[*?]/)[0].replace(/[/\\]+$/, "");
            if (firstWildcardSection) {
                const candidate = path.resolve(tsconfigDir, firstWildcardSection);
                if (await fileExists(candidate)) {
                    rootDir = candidate;
                }
            }
        }
        if (!rootDir && commandLine.fileNames.length > 0) {
            rootDir = computeCommonDirectory(commandLine.fileNames.map(f => path.dirname(path.resolve(f))));
        }
        if (!rootDir) {
            rootDir = tsconfigDir;
        }
    }

    return {
        tsconfigPath,
        tsconfigDir,
        commandLine,
        rootDir,
        outDir
    };
};

const computeCommonDirectory = (dirs: string[]): string | undefined => {
    if (dirs.length === 0) return undefined;
    const splitDirs = dirs.map(d => path.resolve(d).split(path.sep));
    const first = splitDirs[0];
    let commonLength = first.length;

    for (let i = 1; i < splitDirs.length; i++) {
        const current = splitDirs[i];
        commonLength = Math.min(commonLength, current.length);
        for (let j = 0; j < commonLength; j++) {
            if (first[j] !== current[j]) {
                commonLength = j;
                break;
            }
        }
    }

    return first.slice(0, commonLength).join(path.sep) || path.sep;
};

const toPosixPath = (p: string): string => p.replace(/\\/g, "/");

/**
 * Extracts the NetSuite File Cabinet path (starting with "/") from a local or relative path
 * if it contains a "FileCabinet" segment or is inside the SDF FileCabinet root.
 */
const extractFileCabinetPath = (
    targetPath: string,
    fileCabinetRoot: string
): string | null => {
    const absTarget = path.resolve(targetPath);
    const absFcRoot = path.resolve(fileCabinetRoot);

    if (absTarget.startsWith(absFcRoot + path.sep)) {
        const rel = toPosixPath(path.relative(absFcRoot, absTarget));
        return "/" + rel;
    }

    const posixTarget = toPosixPath(targetPath);
    const fcMatch = posixTarget.match(/(?:^|\/)FileCabinet\/(.+)$/);
    if (fcMatch && fcMatch[1]) {
        return "/" + fcMatch[1];
    }

    return null;
};

/**
 * Finds the actual TypeScript source file on disk corresponding to an input path.
 */
const locateTypeScriptSourceFile = async (
    inputPath: string,
    projectRoot: string,
    fileCabinetRoot: string,
    config: ProjectConfig,
    tsProject: ParsedTsProject | null
): Promise<string | null> => {
    if (path.isAbsolute(inputPath) && (await fileExists(inputPath))) {
        return path.resolve(inputPath);
    }

    const stripped = inputPath.replace(/^[/\\]+/, "");
    const candidates: string[] = [
        path.resolve(projectRoot, stripped)
    ];

    if (config.tsRootDir) {
        candidates.push(path.resolve(projectRoot, config.tsRootDir, stripped));
    }
    if (tsProject?.rootDir) {
        candidates.push(path.resolve(tsProject.rootDir, stripped));
    }

    candidates.push(
        path.resolve(fileCabinetRoot, stripped),
        path.resolve(projectRoot, "src", "FileCabinet", stripped),
        path.resolve(projectRoot, "FileCabinet", stripped)
    );

    for (const candidate of candidates) {
        if (await fileExists(candidate)) {
            return candidate;
        }
    }

    // Check if any file in tsconfig matches the suffix
    if (tsProject) {
        const normalizedSuffix = "/" + toPosixPath(stripped);
        const matched = tsProject.commandLine.fileNames.find(f =>
            toPosixPath(path.resolve(f)).endsWith(normalizedSuffix)
        );
        if (matched) {
            return path.resolve(matched);
        }
    }

    return null;
};

/**
 * Resolves a single input file path (either .ts or .js, workspace-relative or FileCabinet-relative)
 * to its compiled JavaScript local path and NetSuite File Cabinet path.
 */
export const resolveProjectFile = async (
    projectRoot: string,
    inputPath: string,
    config?: ProjectConfig,
    sdfSrcDir?: string,
    tsProject?: ParsedTsProject | null
): Promise<ResolvedProjectFile> => {
    const resolvedConfig = config ?? (await getProjectConfig(projectRoot));
    const resolvedSdfSrcDir = sdfSrcDir ?? (await getSdfSrcDir(projectRoot, resolvedConfig));
    const fileCabinetRoot = path.join(resolvedSdfSrcDir, "FileCabinet");
    const resolvedTsProject =
        tsProject !== undefined ? tsProject : await loadTsProject(projectRoot, resolvedConfig);

    const trimmedInput = inputPath.trim();
    const isTsInput = trimmedInput.toLowerCase().endsWith(".ts");

    let resolvedLocalJsPath: string | null = null;

    if (isTsInput) {
        const sourceTsPath = await locateTypeScriptSourceFile(
            trimmedInput,
            projectRoot,
            fileCabinetRoot,
            resolvedConfig,
            resolvedTsProject
        );

        // 1. Explicit config tsRootDir / jsOutDir mapping
        if (resolvedConfig.tsRootDir || resolvedConfig.jsOutDir) {
            const tsRoot = path.resolve(
                projectRoot,
                resolvedConfig.tsRootDir || resolvedTsProject?.rootDir || "."
            );
            const jsOut = path.resolve(
                projectRoot,
                resolvedConfig.jsOutDir || resolvedTsProject?.outDir || path.join(fileCabinetRoot, "SuiteScripts")
            );

            const effectiveSource = sourceTsPath ?? path.resolve(projectRoot, trimmedInput.replace(/^[/\\]+/, ""));
            const relToRoot = effectiveSource.startsWith(tsRoot + path.sep)
                ? path.relative(tsRoot, effectiveSource)
                : trimmedInput.replace(/^[/\\]+/, "");
            resolvedLocalJsPath = path.resolve(jsOut, relToRoot.replace(/\.ts$/i, ".js"));
        }

        // 2. tsconfig.json resolution
        if (!resolvedLocalJsPath && resolvedTsProject && sourceTsPath) {
            // Try TypeScript's built-in getOutputFileNames first (when noEmit is not enabled)
            if (!resolvedTsProject.commandLine.options.noEmit) {
                try {
                    const outputs = ts.getOutputFileNames(
                        resolvedTsProject.commandLine,
                        sourceTsPath,
                        !ts.sys.useCaseSensitiveFileNames
                    );
                    const jsOutput = outputs.find(o => o.endsWith(".js"));
                    if (jsOutput) {
                        resolvedLocalJsPath = path.resolve(jsOutput);
                    }
                } catch {
                    // Fallback to manual rootDir/outDir mapping below if file was outside rootDir
                }
            }

            if (!resolvedLocalJsPath) {
                if (resolvedTsProject.outDir && resolvedTsProject.rootDir) {
                    if (sourceTsPath.startsWith(resolvedTsProject.rootDir + path.sep)) {
                        const rel = path.relative(resolvedTsProject.rootDir, sourceTsPath);
                        resolvedLocalJsPath = path.resolve(
                            resolvedTsProject.outDir,
                            rel.replace(/\.ts$/i, ".js")
                        );
                    }
                } else if (!resolvedTsProject.outDir) {
                    // Intermingled / in-place compilation (no outDir in tsconfig)
                    resolvedLocalJsPath = sourceTsPath.replace(/\.ts$/i, ".js");
                }
            }
        }

        // 3. If sourceTsPath was found inside a FileCabinet directory (intermingled without tsconfig)
        if (!resolvedLocalJsPath && sourceTsPath) {
            const fcPath = extractFileCabinetPath(sourceTsPath, fileCabinetRoot);
            if (fcPath) {
                const jsFcPath = fcPath.replace(/\.ts$/i, ".js");
                resolvedLocalJsPath = path.join(fileCabinetRoot, jsFcPath.slice(1));
            }
        }
    } else {
        // Non-TS file (e.g., .js)
        const stripped = trimmedInput.replace(/^[/\\]+/, "");
        const directCandidate = path.isAbsolute(trimmedInput)
            ? trimmedInput
            : path.resolve(projectRoot, stripped);

        if (await fileExists(directCandidate)) {
            resolvedLocalJsPath = directCandidate;
        } else {
            const fcPathFromInput = extractFileCabinetPath(trimmedInput, fileCabinetRoot);
            if (fcPathFromInput) {
                resolvedLocalJsPath = path.join(fileCabinetRoot, fcPathFromInput.slice(1));
            }
        }
    }

    // Derive File Cabinet path and local output path
    if (resolvedLocalJsPath) {
        const fcPath = extractFileCabinetPath(resolvedLocalJsPath, fileCabinetRoot);
        if (fcPath) {
            // Check if the file exists at resolvedLocalJsPath or inside fileCabinetRoot
            const primaryLocalPath = (await fileExists(resolvedLocalJsPath))
                ? resolvedLocalJsPath
                : path.join(fileCabinetRoot, fcPath.slice(1));

            return {
                inputPath,
                fileCabinetPath: fcPath,
                localOutputPath: primaryLocalPath,
                existsOnDisk: await fileExists(primaryLocalPath)
            };
        }
    }

    // Fallback (includes legacy /TypeScripts/* -> /SuiteScripts/* mapping and direct FileCabinet paths like /SuiteScripts/foo.js)
    let fallbackPath = toPosixPath(trimmedInput);
    if (fallbackPath.startsWith("/TypeScripts/")) {
        fallbackPath = "/SuiteScripts/" + fallbackPath.substring("/TypeScripts/".length);
    } else if (fallbackPath.startsWith("TypeScripts/")) {
        fallbackPath = "/SuiteScripts/" + fallbackPath.substring("TypeScripts/".length);
    } else {
        const fcExtracted = extractFileCabinetPath(fallbackPath, fileCabinetRoot);
        if (fcExtracted) {
            fallbackPath = fcExtracted;
        }
    }

    if (!fallbackPath.startsWith("/")) {
        fallbackPath = "/" + fallbackPath;
    }
    if (fallbackPath.toLowerCase().endsWith(".ts")) {
        fallbackPath = fallbackPath.slice(0, -3) + ".js";
    }

    const fallbackLocalPath = path.join(fileCabinetRoot, fallbackPath.slice(1));

    return {
        inputPath,
        fileCabinetPath: fallbackPath,
        localOutputPath: fallbackLocalPath,
        existsOnDisk: await fileExists(fallbackLocalPath)
    };
};

/**
 * Resolves an array of input file paths to their NetSuite File Cabinet paths and local disk paths.
 */
export const resolveProjectFiles = async (
    projectRoot: string,
    filePaths: string[],
    config?: ProjectConfig
): Promise<ResolvedProjectFile[]> => {
    const resolvedConfig = config ?? (await getProjectConfig(projectRoot));
    const sdfSrcDir = await getSdfSrcDir(projectRoot, resolvedConfig);
    const tsProject = await loadTsProject(projectRoot, resolvedConfig);

    return Promise.all(
        filePaths.map(fp =>
            resolveProjectFile(projectRoot, fp, resolvedConfig, sdfSrcDir, tsProject)
        )
    );
};

/**
 * Convenience helper that resolves an array of input file paths directly to NetSuite File Cabinet paths.
 */
export const resolveFileCabinetPaths = async (
    projectRoot: string,
    filePaths: string[],
    config?: ProjectConfig
): Promise<string[]> => {
    const resolved = await resolveProjectFiles(projectRoot, filePaths, config);
    return resolved.map(r => r.fileCabinetPath);
};
