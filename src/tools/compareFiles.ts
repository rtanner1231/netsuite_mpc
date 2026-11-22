import { ToolDefinition } from "../types/index.js";
import { getProjectRoot } from "../utils/mcp.js";
import {
    getProjectConfig,
    runProjectBuild,
    resolveProjectFiles
} from "../utils/project.js";
import { withTempSdfProject } from "../utils/tempSdfProject.js";
import { createTwoFilesPatch } from "diff";
import fs from "fs/promises";
import { exec } from "child_process";
import util from "util";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";

const execAsync = util.promisify(exec);

export type FileComparisonStatus =
    | "identical"
    | "modified"
    | "missing_remote"
    | "missing_local"
    | "not_found";

export interface FileComparisonResult {
    inputPath: string;
    fileCabinetPath: string;
    localOutputPath: string;
    status: FileComparisonStatus;
    hasDifferences: boolean;
    diff: string;
    message?: string;
}

const fileExists = async (targetPath: string): Promise<boolean> => {
    try {
        await fs.access(targetPath);
        return true;
    } catch {
        return false;
    }
};

const normalizeLineEndings = (text: string): string => text.replace(/\r\n/g, "\n");

/**
 * Runs `suitecloud file:import` in the temporary SDF project.
 * Attempts a single batch import first; if the batch fails and multiple paths were requested,
 * falls back to importing each path individually so one missing remote file does not block others.
 */
const importFilesFromNetsuite = async (
    tempDir: string,
    fileCabinetPaths: string[]
): Promise<Record<string, string | undefined>> => {
    const uniquePaths = Array.from(new Set(fileCabinetPaths));
    const importErrors: Record<string, string | undefined> = {};

    if (uniquePaths.length === 0) {
        return importErrors;
    }

    const runImportCommand = async (pathsToImport: string[]) => {
        const quotedPaths = pathsToImport.map(p => `"${p}"`).join(" ");
        return execAsync(
            `suitecloud file:import --paths ${quotedPaths} --excludeproperties`,
            { cwd: tempDir }
        );
    };

    try {
        await runImportCommand(uniquePaths);
        return importErrors;
    } catch (batchError: any) {
        if (uniquePaths.length === 1) {
            const singlePath = uniquePaths[0];
            importErrors[singlePath] = (
                batchError.stdout ||
                batchError.stderr ||
                batchError.message ||
                ""
            ).trim();
            return importErrors;
        }

        // Fallback to individual imports so existing remote files still download
        for (const fcPath of uniquePaths) {
            try {
                await runImportCommand([fcPath]);
            } catch (singleError: any) {
                importErrors[fcPath] = (
                    singleError.stdout ||
                    singleError.stderr ||
                    singleError.message ||
                    ""
                ).trim();
            }
        }

        return importErrors;
    }
};

export const compareFilesTool: ToolDefinition = {
    name: "netsuite_compare_files",
    description:
        "Compares local files against the versions deployed in the NetSuite File Cabinet and returns an array of unified diffs. " +
        "Conditionally builds the project first, resolves TypeScript (.ts) or JavaScript (.js) paths to their NetSuite File Cabinet paths, " +
        "downloads the deployed files into a temporary SDF project via 'suitecloud file:import', and computes the diff for each file.",
    meta: {
        isDestructive: false,
        requiresSdf: true
    },
    inputSchema: {
        type: "object",
        properties: {
            filePaths: {
                type: "array",
                items: { type: "string" },
                description:
                    "Array of file paths to compare (e.g., ['/SuiteScripts/myScript.js'], ['TypeScripts/myScript.ts'], or ['src/FileCabinet/SuiteScripts/myScript.ts'])."
            },
            skipBuild: {
                type: "boolean",
                description: "Optional flag to skip running the project build step before comparing."
            },
            contextLines: {
                type: "number",
                description: "Optional number of context lines to include in unified diffs (defaults to 3)."
            }
        },
        required: ["filePaths"]
    },
    execute: async (
        args: { filePaths: string[]; skipBuild?: boolean; contextLines?: number },
        server: Server
    ) => {
        const { filePaths, skipBuild, contextLines = 3 } = args;
        if (!Array.isArray(filePaths) || filePaths.length === 0) {
            return {
                content: [
                    {
                        type: "text",
                        text: "Failure: 'filePaths' must be a non-empty array of strings."
                    }
                ]
            };
        }

        try {
            const projectRoot = await getProjectRoot(server);
            const projectConfig = await getProjectConfig(projectRoot);

            // 1. Build the project if needed
            const buildResult = await runProjectBuild(
                projectRoot,
                { skipBuild, filePaths },
                projectConfig
            );

            if (!buildResult.success) {
                return {
                    content: [{ type: "text", text: `Failure: ${buildResult.error}` }]
                };
            }

            // 2. Resolve each file path in the FileCabinet / SuiteScripts folder
            const resolvedFiles = await resolveProjectFiles(
                projectRoot,
                filePaths,
                projectConfig
            );

            // 3. Create minimal SDF project in a temp directory, import files, diff, and clean up
            const results = await withTempSdfProject(
                {
                    projectRoot,
                    projectConfig,
                    tempDirPrefix: "netsuite-mcp-compare-"
                },
                async tempProject => {
                    const fcPaths = resolvedFiles.map(f => f.fileCabinetPath);
                    const importErrors = await importFilesFromNetsuite(
                        tempProject.tempDir,
                        fcPaths
                    );

                    const comparisons: FileComparisonResult[] = [];

                    for (const file of resolvedFiles) {
                        const localExists = await fileExists(file.localOutputPath);
                        const downloadedPath = tempProject.getLocalFileCabinetPath(
                            file.fileCabinetPath
                        );
                        const remoteExists = await fileExists(downloadedPath);

                        if (!localExists && !remoteExists) {
                            comparisons.push({
                                inputPath: file.inputPath,
                                fileCabinetPath: file.fileCabinetPath,
                                localOutputPath: file.localOutputPath,
                                status: "not_found",
                                hasDifferences: true,
                                diff: "",
                                message:
                                    importErrors[file.fileCabinetPath] ||
                                    "File was not found locally or in the NetSuite File Cabinet."
                            });
                            continue;
                        }

                        if (localExists && !remoteExists) {
                            comparisons.push({
                                inputPath: file.inputPath,
                                fileCabinetPath: file.fileCabinetPath,
                                localOutputPath: file.localOutputPath,
                                status: "missing_remote",
                                hasDifferences: true,
                                diff: "",
                                message:
                                    importErrors[file.fileCabinetPath] ||
                                    "File exists locally but was not found in the NetSuite File Cabinet."
                            });
                            continue;
                        }

                        if (!localExists && remoteExists) {
                            comparisons.push({
                                inputPath: file.inputPath,
                                fileCabinetPath: file.fileCabinetPath,
                                localOutputPath: file.localOutputPath,
                                status: "missing_local",
                                hasDifferences: true,
                                diff: "",
                                message:
                                    "File exists in the NetSuite File Cabinet but was not found locally."
                            });
                            continue;
                        }

                        const [localRaw, remoteRaw] = await Promise.all([
                            fs.readFile(file.localOutputPath, "utf-8"),
                            fs.readFile(downloadedPath, "utf-8")
                        ]);

                        const localContent = normalizeLineEndings(localRaw);
                        const remoteContent = normalizeLineEndings(remoteRaw);

                        if (localContent === remoteContent) {
                            comparisons.push({
                                inputPath: file.inputPath,
                                fileCabinetPath: file.fileCabinetPath,
                                localOutputPath: file.localOutputPath,
                                status: "identical",
                                hasDifferences: false,
                                diff: ""
                            });
                        } else {
                            const patch = createTwoFilesPatch(
                                `netsuite:${file.fileCabinetPath}`,
                                `local:${file.fileCabinetPath}`,
                                remoteContent,
                                localContent,
                                "NetSuite Deployed",
                                "Local Build",
                                { context: contextLines }
                            );

                            comparisons.push({
                                inputPath: file.inputPath,
                                fileCabinetPath: file.fileCabinetPath,
                                localOutputPath: file.localOutputPath,
                                status: "modified",
                                hasDifferences: true,
                                diff: patch
                            });
                        }
                    }

                    return comparisons;
                }
            );

            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(results, null, 2)
                    }
                ]
            };
        } catch (error: any) {
            return {
                content: [
                    {
                        type: "text",
                        text: `Failure: An unexpected error occurred while comparing files: ${error.message}`
                    }
                ]
            };
        }
    }
};
