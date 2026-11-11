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

export interface EnvironmentConfig {
    accountId: string;
    sdfId?: string;
    scriptId: string;
    deploymentId: string;
    consumerKey: string;
    consumerSecret: string;
    token: string;
    tokenSecret: string;
    disabledTools?: string[];
    [key: string]: any;
}

export const getEnvironmentConfig = async (environment?: string): Promise<{ environment: string; config: EnvironmentConfig }> => {
    const activeEnv = environment ?? await getActiveEnvironment();

    let envData: Record<string, EnvironmentConfig>;
    try {
        const envFile = await fs.readFile(ENV_PATH, "utf-8");
        envData = JSON.parse(envFile);
    } catch (error: any) {
        throw new Error(`Failed to read env.json at ${ENV_PATH}: ${error.message}`);
    }

    const config = envData[activeEnv];
    if (!config) {
        throw new Error(`Credentials for environment '${activeEnv}' not found in env.json`);
    }

    return { environment: activeEnv, config };
};

export const getDisabledTools = async (): Promise<{ environment: string; disabledTools: Set<string> }> => {
    const { environment, config } = await getEnvironmentConfig();
    const rawDisabled = Array.isArray(config.disabledTools) ? config.disabledTools : [];
    const disabledTools = new Set(
        rawDisabled.filter((item): item is string => typeof item === "string")
    );
    return { environment, disabledTools };
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
