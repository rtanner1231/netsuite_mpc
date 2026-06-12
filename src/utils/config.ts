import fs from "fs/promises";
import path from "path";
import os from "os";

export const getConfigDir = (): string => {
    const appName = "netsuite_mcp";
    if (process.platform === "win32") {
        const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
        return path.join(appData, appName);
    } else {
        const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
        return path.join(configHome, appName);
    }
};

export const MCP_DIR = getConfigDir();
export const CONFIG_PATH = path.join(MCP_DIR, "config.json");
export const ENV_PATH = path.join(MCP_DIR, "env.json");

export const getActiveEnvironment = async (): Promise<string> => {
    try {
        const fileData = await fs.readFile(CONFIG_PATH, "utf-8");
        const configData = JSON.parse(fileData);

        const validEnvs = ["SB1", "SB2", "Prod"];
        if (!validEnvs.includes(configData.environment)) {
            throw new Error(`Invalid environment '${configData.environment}' in config.json. Must be one of ${validEnvs.join(", ")}.`);
        }

        return configData.environment;
    } catch (error: any) {
        if (error.code === "ENOENT") {
            throw new Error(`Configuration file not found at ${CONFIG_PATH}. Please create it with {"environment": "Prod"}.`);
        }
        throw new Error(`Failed to read config.json: ${error.message}`);
    }
};
