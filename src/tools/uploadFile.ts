import { ToolDefinition } from "../types/index.js";
import { getProjectRoot } from "../utils/mcp.js";
import { getActiveEnvironment, ENV_PATH } from "../utils/config.js";
import fs from "fs/promises";
import path from "path";
import { exec } from "child_process";
import util from "util";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";

const execAsync = util.promisify(exec);

export const uploadFileTool: ToolDefinition = {
    name: "netsuite_upload_file",
    description: "Uploads an array of specific script files to NetSuite using the SuiteCloud CLI.",
    inputSchema: {
        type: "object",
        properties: { filePaths: { type: "array", items: { type: "string" } } },
        required: ["filePaths"]
    },
    execute: async (args: { filePaths: string[] }, server: Server) => {
        const { filePaths } = args;
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

            if (projectJson.defaultAuthId !== targetSdfId) {
                originalAuthId = projectJson.defaultAuthId;
                projectJson.defaultAuthId = targetSdfId;
                await fs.writeFile(projectJsonPath, JSON.stringify(projectJson, null, 2));
            }

            try { await execAsync("npm run build", { cwd: projectRoot }); } catch (e) { }

            const mappedPaths = filePaths.map(filePath => {
                let finalPath = filePath;
                if (finalPath.startsWith('/TypeScripts/')) finalPath = '/SuiteScripts/' + finalPath.substring('/TypeScripts/'.length);
                else if (finalPath.startsWith('TypeScripts/')) finalPath = '/SuiteScripts/' + finalPath.substring('TypeScripts/'.length);

                if (!finalPath.startsWith('/')) finalPath = '/' + finalPath;
                if (finalPath.endsWith('.ts')) finalPath = finalPath.slice(0, -3) + '.js';
                return finalPath;
            });

            const cliPathsString = `"${mappedPaths.join(" ")}"`;

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
