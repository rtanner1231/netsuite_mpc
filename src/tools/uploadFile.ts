import { ToolDefinition } from "../types/index.js";
import { getProjectRoot } from "../utils/mcp.js";
import {
    getProjectConfig,
    runProjectBuild,
    resolveProjectFiles
} from "../utils/project.js";
import { withTempSdfProject } from "../utils/tempSdfProject.js";
import fs from "fs/promises";
import path from "path";
import { exec } from "child_process";
import util from "util";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";

const execAsync = util.promisify(exec);

export const uploadFileTool: ToolDefinition = {
    name: "netsuite_upload_file",
    description:
        "Uploads an array of script files to the NetSuite File Cabinet using the SuiteCloud CLI inside an isolated temporary SDF project. " +
        "Conditionally builds the project first (auto-detected or configured via buildBeforeUpload / buildCommand), " +
        "resolves TypeScript (.ts) paths to their compiled JavaScript (.js) File Cabinet paths via tsconfig.json or configuration, " +
        "copies the files into the temporary SDF project configured with the active environment's sdfId, and uploads them without modifying the local project.json.",
    meta: {
        isDestructive: true,
        requiresSdf: true
    },
    inputSchema: {
        type: "object",
        properties: {
            filePaths: {
                type: "array",
                items: { type: "string" },
                description:
                    "Array of file paths to upload (e.g., ['/SuiteScripts/myScript.js'], ['TypeScripts/myScript.ts'], or ['src/FileCabinet/SuiteScripts/myScript.ts'])."
            },
            skipBuild: {
                type: "boolean",
                description: "Optional flag to skip running the project build step before uploading."
            }
        },
        required: ["filePaths"]
    },
    execute: async (args: { filePaths: string[]; skipBuild?: boolean }, server: Server) => {
        const { filePaths, skipBuild } = args;
        if (!Array.isArray(filePaths) || filePaths.length === 0) {
            return { content: [{ type: "text", text: "Failure: 'filePaths' must be a non-empty array of strings." }] };
        }

        try {
            const projectRoot = await getProjectRoot(server);
            const projectConfig = await getProjectConfig(projectRoot);

            // 1. Conditionally build the project first
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

            // 2. Resolve each file path to its compiled local disk path and NetSuite File Cabinet path
            const resolvedFiles = await resolveProjectFiles(projectRoot, filePaths, projectConfig);
            const missingLocal = resolvedFiles.filter(f => !f.existsOnDisk);
            if (missingLocal.length > 0) {
                const details = missingLocal
                    .map(f => `'${f.inputPath}' (expected at ${f.localOutputPath})`)
                    .join(", ");
                return {
                    content: [
                        {
                            type: "text",
                            text: `Failure: Local output file(s) not found on disk: ${details}`
                        }
                    ]
                };
            }

            // 3. Stage files in an isolated temporary SDF project and run suitecloud file:upload
            return await withTempSdfProject(
                {
                    projectRoot,
                    projectConfig,
                    tempDirPrefix: "netsuite-mcp-upload-"
                },
                async (tempProject) => {
                    for (const file of resolvedFiles) {
                        const destPath = tempProject.getLocalFileCabinetPath(file.fileCabinetPath);
                        await fs.mkdir(path.dirname(destPath), { recursive: true });
                        await fs.copyFile(file.localOutputPath, destPath);
                    }

                    const uniqueFcPaths = Array.from(
                        new Set(resolvedFiles.map(file => file.fileCabinetPath))
                    );
                    const cliPathsString = uniqueFcPaths.map(fcPath => `"${fcPath}"`).join(" ");

                    try {
                        const { stdout } = await execAsync(
                            `suitecloud file:upload --paths ${cliPathsString}`,
                            { cwd: tempProject.tempDir }
                        );
                        return { content: [{ type: "text", text: `Success!\nOutput:\n${stdout}` }] };
                    } catch (uploadError: any) {
                        const errDetails = uploadError.stdout || uploadError.stderr || uploadError.message;
                        return {
                            content: [
                                {
                                    type: "text",
                                    text: `Failure: Error uploading files:\n${errDetails}`
                                }
                            ]
                        };
                    }
                }
            );
        } catch (error: any) {
            return { content: [{ type: "text", text: `Failure: An unexpected error occurred: ${error.message}` }] };
        }
    }
};
