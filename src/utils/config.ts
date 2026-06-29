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
export const CONFIG_PATH = path.join(MCP_DIR, "state.json");
export const ENV_PATH = path.join(MCP_DIR, "env.json");
export const APP_CONFIG_PATH = path.join(MCP_DIR, "config.json");

export const getActiveEnvironment = async (): Promise<string> => {
    try {
        const fileData = await fs.readFile(CONFIG_PATH, "utf-8");
        const configData = JSON.parse(fileData);

        return configData.environment;
    } catch (error: any) {
        if (error.code === "ENOENT") {
            throw new Error(`state file not found at ${CONFIG_PATH}. Please create it with {"environment": "Prod"}.`);
        }
        throw new Error(`Failed to read config.json: ${error.message}`);
    }
};

/**
 * Get the user defaults for a specific type of object
 * return null if no defaults are found
 */
export const getUserDefaults = async (type: string): Promise<Record<string, any> | null> => {
    try {
        const fileData = await fs.readFile(APP_CONFIG_PATH, "utf-8");
        const configData = JSON.parse(fileData);

        if (configData && configData.objectDefaults && configData.objectDefaults[type]) {
            return configData.objectDefaults[type];
        }
        return null;
    } catch (error: any) {
        if (error.code === "ENOENT") {
            return null; // Config file is optional
        }
        console.error(`Failed to read config.json for user defaults: ${error.message}`);
        return null;
    }
};
