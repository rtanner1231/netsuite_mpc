import fs from "fs/promises";
import path from "path";
import os from "os";
import { ToolDefinition } from "../types/index.js";

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

        if (typeof configData?.environment !== "string" || configData.environment.trim() === "") {
            throw new Error(`'environment' is not set in ${CONFIG_PATH}. Use 'netsuite_switch_environment' to select an environment.`);
        }

        return configData.environment;
    } catch (error: any) {
        if (error.code === "ENOENT") {
            throw new Error(`state file not found at ${CONFIG_PATH}. Use 'netsuite_switch_environment' to initialize it or create it with {"environment": "Prod"}.`);
        }
        throw new Error(`Failed to read state.json: ${error.message}`);
    }
};

export const getActiveEnvironmentOrNull = async (): Promise<string | null> => {
    try {
        const fileData = await fs.readFile(CONFIG_PATH, "utf-8");
        const configData = JSON.parse(fileData);

        if (typeof configData?.environment === "string" && configData.environment.trim() !== "") {
            return configData.environment;
        }
        return null;
    } catch (error: any) {
        if (error.code === "ENOENT") {
            return null;
        }
        throw new Error(`Failed to read state.json: ${error.message}`);
    }
};

export interface EnvironmentToolsConfig {
    disableDestructive?: boolean;
    disableSdf?: boolean;
    disabledTools?: string[];
}

export interface EnvironmentConfig {
    accountId: string;
    sdfId?: string;
    scriptId: string;
    deploymentId: string;
    consumerKey: string;
    consumerSecret: string;
    token: string;
    tokenSecret: string;
    tools?: EnvironmentToolsConfig;
    [key: string]: any;
}

export const getAllEnvironments = async (): Promise<Record<string, EnvironmentConfig>> => {
    try {
        const envFile = await fs.readFile(ENV_PATH, "utf-8");
        const parsed = JSON.parse(envFile);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new Error("env.json must contain a top-level JSON object mapping environment names to configurations.");
        }
        return parsed as Record<string, EnvironmentConfig>;
    } catch (error: any) {
        throw new Error(`Failed to read env.json at ${ENV_PATH}: ${error.message}`);
    }
};

export const setActiveEnvironment = async (environment: string): Promise<{ previousEnvironment: string | null; environment: string }> => {
    const envData = await getAllEnvironments();
    if (!envData[environment]) {
        const available = Object.keys(envData);
        const availableList = available.length > 0 ? available.join(", ") : "none";
        throw new Error(`Environment '${environment}' not found in env.json. Available environments: ${availableList}`);
    }

    let existingState: Record<string, any> = {};
    let previousEnvironment: string | null = null;

    try {
        const fileData = await fs.readFile(CONFIG_PATH, "utf-8");
        const parsed = JSON.parse(fileData);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            existingState = parsed;
            if (typeof parsed.environment === "string" && parsed.environment.trim() !== "") {
                previousEnvironment = parsed.environment;
            }
        }
    } catch (error: any) {
        if (error.code !== "ENOENT") {
            throw new Error(`Failed to read existing state.json at ${CONFIG_PATH}: ${error.message}`);
        }
    }

    await fs.mkdir(MCP_DIR, { recursive: true });
    const updatedState = {
        ...existingState,
        environment
    };
    await fs.writeFile(CONFIG_PATH, JSON.stringify(updatedState, null, 2) + "\n", "utf-8");

    return { previousEnvironment, environment };
};

export const getEnvironmentConfig = async (environment?: string): Promise<{ environment: string; config: EnvironmentConfig }> => {
    const activeEnv = environment ?? await getActiveEnvironment();
    const envData = await getAllEnvironments();

    const config = envData[activeEnv];
    if (!config) {
        throw new Error(`Credentials for environment '${activeEnv}' not found in env.json`);
    }

    return { environment: activeEnv, config };
};

export const getToolDisableReason = (tool: ToolDefinition, config: EnvironmentConfig): string | null => {
    if (tool.meta.alwaysAvailable) {
        return null;
    }

    const toolsConfig = config.tools;
    const rawDisabled = Array.isArray(toolsConfig?.disabledTools) ? toolsConfig.disabledTools : [];
    if (rawDisabled.some((item): item is string => typeof item === "string" && item === tool.name)) {
        return "explicitly listed in tools.disabledTools";
    }

    if (tool.meta.isDestructive && toolsConfig?.disableDestructive === true) {
        return "destructive tools are disabled";
    }

    if (tool.meta.requiresSdf) {
        if (toolsConfig?.disableSdf === true) {
            return "SDF tools are disabled";
        }
        if (typeof config.sdfId !== "string" || config.sdfId.trim() === "") {
            return "sdfId is not configured";
        }
    }

    return null;
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
