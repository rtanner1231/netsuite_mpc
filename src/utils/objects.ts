import fs from "fs/promises";
import path from "path";
import util from "util";
import { exec } from "child_process";
import { runDeploymentPipeline, ManifestDependencies } from "./deploy.js";
import { create } from "xmlbuilder2";
import { getProjectRoot } from "./mcp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { ToolDefinition } from "../types/index.js";

const execAsync = util.promisify(exec);

type ToolReturnType = ReturnType<ToolDefinition["execute"]>

/**
 * Retrieves the current git branch and sanitizes it for use as a folder name.
 */
const getSanitizedBranchName = async (projectRoot: string): Promise<string> => {
    try {
        const { stdout } = await execAsync("git rev-parse --abbrev-ref HEAD", { cwd: projectRoot });
        const branchName = stdout.trim();

        if (!branchName) {
            return "NoBranch";
        }

        //replace illegal characters
        return branchName.replace(/[\/\\:*?"<>|]/g, "_");
    } catch (error) {
        // Fallback if the branch cannot be found
        return "NoBranch";
    }
}

/**
 * Writes an XML string to the Objects directory and deploys it via SDF.
 */
export const deploySdfObject = async (
    projectRoot: string,
    scriptId: string,
    xmlContent: string,
    manifestDependencies?: ManifestDependencies // New optional parameter
): Promise<string> => {
    const branchFolder = await getSanitizedBranchName(projectRoot);
    const objectsDir = path.join(projectRoot, "dist", "Objects", branchFolder);

    try {
        await fs.access(objectsDir);
    } catch {
        await fs.mkdir(objectsDir, { recursive: true });
    }

    const fileName = `${scriptId}.xml`;
    const filePath = path.join(objectsDir, fileName);

    await fs.writeFile(filePath, xmlContent, "utf-8");

    const deployPath = `~/Objects/${branchFolder}/${fileName}`; //TODO: this is ugly

    const deployResult = await runDeploymentPipeline(
        projectRoot,
        { objects: [deployPath] },
        manifestDependencies
    );

    return deployResult.output;
}

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
}

export const generateAndDeploySdf = async (args: {
    rootElement: string,
    scriptId: string,
    data: Record<string, any>,
    server: Server,
    manifestDependencies?: ManifestDependencies
}): ToolReturnType => {
    try {
        const { rootElement, scriptId, data, server, manifestDependencies } = args;
        const xmlContent = generateSdfXml(rootElement, scriptId, data);
        const projectRoot = await getProjectRoot(server);

        const output = await deploySdfObject(projectRoot, scriptId, xmlContent, manifestDependencies);
        return { content: [{ type: "text", text: output }] };

    } catch (error: any) {
        return { content: [{ type: "text", text: `Unexpected Tool Error: ${error.message}` }] };
    }
}
