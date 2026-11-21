import { ToolDefinition } from "../types/index.js";
import { getProjectRoot } from "../utils/mcp.js";
import { getActiveEnvironment, ENV_PATH } from "../utils/config.js";
import {
    getProjectConfig,
    runProjectBuild,
    resolveProjectFiles
} from "../utils/project.js";
import fs from "fs/promises";
import path from "path";
import { exec } from "child_process";
import util from "util";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";

const execAsync = util.promisify(exec);

export const uploadFileTool: ToolDefinition = {
    name: "netsuite_upload_file",
    description:
        "Uploads an array of script files to the NetSuite File Cabinet using the SuiteCloud CLI. " +
        "Conditionally builds the project first (auto-detected or configured via buildBeforeUpload / buildCommand), " +
        "resolves TypeScript (.ts) paths to their compiled JavaScript (.js) File Cabinet paths via tsconfig.json or configuration, " +
        "and temporarily aligns 'defaultAuthId' in project.json with the active environment's sdfId.",
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

        const projectRoot = await getProjectRoot(server);
        const projectJsonPath = path.join(projectRoot, "project.json");
        let originalAuthId: string | null = null;
        let projectJson: any = null;

        try {
            const environment = await getActiveEnvironment();
            const envFile = await fs.readFile(ENV_PATH, "utf-8");
            const envData = JSON.parse(envFile);

            if (!envData[environment]?.sdfId) {
                return { content: [{ type: "text", text: `Failure: 'sdfId' missing for environment '${environment}' in env.json.` }] };
            }
            const targetSdfId = envData[environment].sdfId;

            try {
                const projectJsonStr = await fs.readFile(projectJsonPath, "utf-8");
                projectJson = JSON.parse(projectJsonStr);
            } catch (e) {
                return { content: [{ type: "text", text: `Failure: Could not read project.json at ${projectJsonPath}.` }] };
            }

            const projectConfig = await getProjectConfig(projectRoot);
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

            const resolvedFiles = await resolveProjectFiles(projectRoot, filePaths, projectConfig);
            const mappedPaths = resolvedFiles.map(file => `"${file.fileCabinetPath}"`);
            const cliPathsString = mappedPaths.join(" ");

            if (projectJson.defaultAuthId !== targetSdfId) {
                originalAuthId = projectJson.defaultAuthId;
                projectJson.defaultAuthId = targetSdfId;
                await fs.writeFile(projectJsonPath, JSON.stringify(projectJson, null, 2));
            }

            try {
                const { stdout } = await execAsync(`suitecloud file:upload --paths ${cliPathsString}`, { cwd: projectRoot });
                return { content: [{ type: "text", text: `Success!\nOutput:\n${stdout}` }] };
            } catch (uploadError: any) {
                return { content: [{ type: "text", text: `Failure: Error uploading files: ${uploadError.message}\n${uploadError.stderr || ""}` }] };
            }
        } catch (error: any) {
            return { content: [{ type: "text", text: `Failure: An unexpected error occurred: ${error.message}` }] };
        } finally {
            if (originalAuthId !== null && projectJson !== null) {
                try {
                    projectJson.defaultAuthId = originalAuthId;
                    await fs.writeFile(projectJsonPath, JSON.stringify(projectJson, null, 2));
                } catch (e) {
                    console.error("Warning: Failed to restore defaultAuthId in project.json");
                }
            }
        }
    }
};
