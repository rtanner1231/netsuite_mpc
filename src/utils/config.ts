import fs from "fs/promises";
import path from "path";
import os from "os";
import { ToolDefinition } from "../types/index.js";
import {
    DEFAULT_DISABLED_TOOLS,
    DEFAULT_ENABLED_CATEGORIES,
    TOOL_CATEGORIES,
    TOOL_CATEGORY_BY_NAME
} from "./settingsSchema.js";

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

export const DEFAULT_PROFILE_NAME = "default";

/**
 * Legacy per-environment tools configuration (supported for seamless migration into profiles.default).
 */
export interface EnvironmentToolsConfig {
    disableDestructive?: boolean;
    disableSdf?: boolean;
    disabledTools?: string[];
    blockedTools?: string[];
    allowedTools?: string[];
    enabledCategories?: string[];
    blockedCategories?: string[];
    enabledTools?: string[];
    allowDynamicActivation?: boolean;
}

export interface ToolProfileConfig {
    description?: string;
    disableDestructive?: boolean;
    disableSdf?: boolean;
    allowDynamicActivation?: boolean;
    enabledCategories?: string[];
    blockedCategories?: string[];
    enabledTools?: string[];
    disabledTools?: string[];
    blockedTools?: string[];
    allowedTools?: string[];
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
    profiles?: Record<string, ToolProfileConfig>;
    /** @deprecated Migrated automatically to profiles.default */
    tools?: EnvironmentToolsConfig;
    [key: string]: any;
}

export interface ActiveState {
    environment: string | null;
    profile: string;
}

const KNOWN_CATEGORY_IDS = new Set(TOOL_CATEGORIES.map(c => c.id));

// In-memory session toolset overrides (cleared when active environment or profile changes)
const sessionActivatedCategories = new Set<string>();
const sessionDeactivatedCategories = new Set<string>();
const sessionActivatedTools = new Set<string>();
const sessionDeactivatedTools = new Set<string>();

export const getSessionActivatedCategories = (): string[] => {
    return Array.from(sessionActivatedCategories);
};

export const getSessionDeactivatedCategories = (): string[] => {
    return Array.from(sessionDeactivatedCategories);
};

export const getSessionActivatedTools = (): string[] => {
    return Array.from(sessionActivatedTools);
};

export const getSessionDeactivatedTools = (): string[] => {
    return Array.from(sessionDeactivatedTools);
};

export const activateSessionCategories = (categories: string[]): string[] => {
    const added: string[] = [];
    for (const raw of categories) {
        const cat = typeof raw === "string" ? raw.trim() : "";
        if (!cat || !KNOWN_CATEGORY_IDS.has(cat)) continue;
        sessionDeactivatedCategories.delete(cat);
        if (!sessionActivatedCategories.has(cat)) {
            sessionActivatedCategories.add(cat);
            added.push(cat);
        }
    }
    return added;
};

export const deactivateSessionCategories = (categories: string[]): string[] => {
    const removed: string[] = [];
    for (const raw of categories) {
        const cat = typeof raw === "string" ? raw.trim() : "";
        if (!cat || !KNOWN_CATEGORY_IDS.has(cat)) continue;
        sessionActivatedCategories.delete(cat);
        if (!sessionDeactivatedCategories.has(cat)) {
            sessionDeactivatedCategories.add(cat);
            removed.push(cat);
        }
    }
    return removed;
};

export const activateSessionTools = (tools: string[]): string[] => {
    const added: string[] = [];
    for (const raw of tools) {
        const t = typeof raw === "string" ? raw.trim() : "";
        if (!t) continue;
        sessionDeactivatedTools.delete(t);
        if (!sessionActivatedTools.has(t)) {
            sessionActivatedTools.add(t);
            added.push(t);
        }
    }
    return added;
};

export const deactivateSessionTools = (tools: string[]): string[] => {
    const removed: string[] = [];
    for (const raw of tools) {
        const t = typeof raw === "string" ? raw.trim() : "";
        if (!t) continue;
        sessionActivatedTools.delete(t);
        if (!sessionDeactivatedTools.has(t)) {
            sessionDeactivatedTools.add(t);
            removed.push(t);
        }
    }
    return removed;
};

export const clearSessionCategories = (): void => {
    sessionActivatedCategories.clear();
    sessionDeactivatedCategories.clear();
    sessionActivatedTools.clear();
    sessionDeactivatedTools.clear();
};

export const getToolCategory = (tool: ToolDefinition): string => {
    const cat = tool.meta.category || TOOL_CATEGORY_BY_NAME[tool.name];
    return cat && KNOWN_CATEGORY_IDS.has(cat) ? cat : "other";
};

export const createDefaultProfileConfig = (overrides?: Partial<ToolProfileConfig>): ToolProfileConfig => {
    return {
        description: overrides?.description ?? "Core schema discovery and data querying tools",
        disableDestructive: Boolean(overrides?.disableDestructive ?? false),
        disableSdf: Boolean(overrides?.disableSdf ?? false),
        allowDynamicActivation: overrides?.allowDynamicActivation !== undefined
            ? Boolean(overrides.allowDynamicActivation)
            : true,
        enabledCategories: Array.isArray(overrides?.enabledCategories)
            ? Array.from(new Set(overrides.enabledCategories.filter((c): c is string => typeof c === "string" && c.trim() !== "")))
            : [...DEFAULT_ENABLED_CATEGORIES],
        blockedCategories: Array.isArray(overrides?.blockedCategories)
            ? Array.from(new Set(overrides.blockedCategories.filter((c): c is string => typeof c === "string" && c.trim() !== "")))
            : [],
        enabledTools: Array.isArray(overrides?.enabledTools)
            ? Array.from(new Set(overrides.enabledTools.filter((t): t is string => typeof t === "string" && t.trim() !== "")))
            : [],
        disabledTools: Array.isArray(overrides?.disabledTools)
            ? Array.from(new Set(overrides.disabledTools.filter((t): t is string => typeof t === "string" && t.trim() !== "")))
            : [...DEFAULT_DISABLED_TOOLS],
        blockedTools: Array.isArray(overrides?.blockedTools)
            ? Array.from(new Set(overrides.blockedTools.filter((t): t is string => typeof t === "string" && t.trim() !== "")))
            : [],
        allowedTools: Array.isArray(overrides?.allowedTools)
            ? Array.from(new Set(overrides.allowedTools.filter((t): t is string => typeof t === "string" && t.trim() !== "")))
            : []
    };
};

export const normalizeProfileConfig = (
    rawProfile?: Record<string, any> | null,
    isLegacyToolsMigration = false
): ToolProfileConfig => {
    if (!rawProfile || typeof rawProfile !== "object" || Array.isArray(rawProfile)) {
        return createDefaultProfileConfig();
    }

    const blockedCategories = Array.isArray(rawProfile.blockedCategories)
        ? Array.from(new Set(rawProfile.blockedCategories.filter((c: unknown): c is string => typeof c === "string" && c.trim() !== "")))
        : [];

    const enabledCategories = Array.isArray(rawProfile.enabledCategories)
        ? Array.from(new Set(rawProfile.enabledCategories.filter((c: unknown): c is string => typeof c === "string" && c.trim() !== "")))
        : [...DEFAULT_ENABLED_CATEGORIES];

    let blockedToolsRaw: unknown[] = [];
    let disabledToolsRaw: unknown[] = [];

    if (isLegacyToolsMigration && !Array.isArray(rawProfile.blockedTools) && Array.isArray(rawProfile.disabledTools)) {
        // Legacy env.tools had disabledTools acting as hard-disabled tools
        blockedToolsRaw = rawProfile.disabledTools;
        disabledToolsRaw = [...DEFAULT_DISABLED_TOOLS];
    } else {
        blockedToolsRaw = Array.isArray(rawProfile.blockedTools) ? rawProfile.blockedTools : [];
        disabledToolsRaw = Array.isArray(rawProfile.disabledTools)
            ? rawProfile.disabledTools
            : [...DEFAULT_DISABLED_TOOLS];
    }

    const normalizeToolList = (list: unknown[]): string[] => {
        const result: string[] = [];
        for (const item of list) {
            if (typeof item !== "string") continue;
            const trimmed = item.trim();
            if (!trimmed) continue;
            if (
                trimmed === "netsuite_rebuild_vector_database_status" ||
                trimmed === "netsuite_get_run_function_logs"
            ) {
                continue;
            }
            const mapped = trimmed === "netsuite_create_record" ? "netsuite_upsert_record" : trimmed;
            if (!result.includes(mapped)) {
                result.push(mapped);
            }
        }
        return result;
    };

    const blockedTools = normalizeToolList(blockedToolsRaw);
    const disabledTools = normalizeToolList(disabledToolsRaw);

    const enabledToolsRaw = Array.isArray(rawProfile.enabledTools) ? rawProfile.enabledTools : [];
    const enabledTools = normalizeToolList(enabledToolsRaw);

    const allowedToolsRaw = Array.isArray(rawProfile.allowedTools) ? rawProfile.allowedTools : [];
    const allowedTools = normalizeToolList(allowedToolsRaw);

    const normalized: ToolProfileConfig = {
        disableDestructive: Boolean(rawProfile.disableDestructive ?? false),
        disableSdf: Boolean(rawProfile.disableSdf ?? false),
        allowDynamicActivation: rawProfile.allowDynamicActivation !== undefined
            ? Boolean(rawProfile.allowDynamicActivation)
            : true,
        enabledCategories: enabledCategories.filter(c => !blockedCategories.includes(c)),
        blockedCategories,
        enabledTools: enabledTools.filter(t => !blockedTools.includes(t)),
        disabledTools: disabledTools.filter(t => !blockedTools.includes(t)),
        blockedTools,
        allowedTools: allowedTools.filter(t => !blockedTools.includes(t))
    };

    if (typeof rawProfile.description === "string" && rawProfile.description.trim() !== "") {
        normalized.description = rawProfile.description.trim();
    }

    return normalized;
};

/**
 * Normalizes an EnvironmentConfig so that `profiles.default` always exists,
 * seamlessly migrating any legacy `tools` block if present.
 */
export const normalizeEnvironmentConfig = (rawEnv: Record<string, any>): EnvironmentConfig => {
    const cloned: Record<string, any> = { ...rawEnv };
    const rawProfiles = (cloned.profiles && typeof cloned.profiles === "object" && !Array.isArray(cloned.profiles))
        ? cloned.profiles as Record<string, any>
        : {};

    const normalizedProfiles: Record<string, ToolProfileConfig> = {};

    for (const [profNameRaw, profVal] of Object.entries(rawProfiles)) {
        const profName = profNameRaw.trim();
        if (!profName) continue;
        normalizedProfiles[profName] = normalizeProfileConfig(profVal, false);
    }

    if (!normalizedProfiles[DEFAULT_PROFILE_NAME]) {
        if (cloned.tools && typeof cloned.tools === "object" && !Array.isArray(cloned.tools)) {
            normalizedProfiles[DEFAULT_PROFILE_NAME] = normalizeProfileConfig(cloned.tools, true);
        } else {
            normalizedProfiles[DEFAULT_PROFILE_NAME] = createDefaultProfileConfig();
        }
    }

    delete cloned.tools;
    cloned.profiles = normalizedProfiles;

    return cloned as EnvironmentConfig;
};

export const resolveEnvironmentProfile = (
    config: EnvironmentConfig,
    requestedProfile?: string | null
): { profileName: string; profile: ToolProfileConfig } => {
    const normalizedEnv = normalizeEnvironmentConfig(config);
    const profiles = normalizedEnv.profiles || { [DEFAULT_PROFILE_NAME]: createDefaultProfileConfig() };
    const targetName = typeof requestedProfile === "string" && requestedProfile.trim() !== ""
        ? requestedProfile.trim()
        : DEFAULT_PROFILE_NAME;

    if (profiles[targetName]) {
        return { profileName: targetName, profile: profiles[targetName] };
    }

    return {
        profileName: DEFAULT_PROFILE_NAME,
        profile: profiles[DEFAULT_PROFILE_NAME] || createDefaultProfileConfig()
    };
};

export const getActiveStateOrNull = async (): Promise<ActiveState> => {
    try {
        const fileData = await fs.readFile(CONFIG_PATH, "utf-8");
        const configData = JSON.parse(fileData);

        const environment =
            typeof configData?.environment === "string" && configData.environment.trim() !== ""
                ? configData.environment.trim()
                : null;
        const profile =
            typeof configData?.profile === "string" && configData.profile.trim() !== ""
                ? configData.profile.trim()
                : DEFAULT_PROFILE_NAME;

        return { environment, profile };
    } catch (error: any) {
        if (error.code === "ENOENT") {
            return { environment: null, profile: DEFAULT_PROFILE_NAME };
        }
        throw new Error(`Failed to read state.json: ${error.message}`);
    }
};

export const getActiveEnvironment = async (): Promise<string> => {
    try {
        const fileData = await fs.readFile(CONFIG_PATH, "utf-8");
        const configData = JSON.parse(fileData);

        if (typeof configData?.environment !== "string" || configData.environment.trim() === "") {
            throw new Error(`'environment' is not set in ${CONFIG_PATH}. Use 'netsuite_switch_environment' to select an environment.`);
        }

        return configData.environment.trim();
    } catch (error: any) {
        if (error.code === "ENOENT") {
            throw new Error(`state file not found at ${CONFIG_PATH}. Use 'netsuite_switch_environment' to initialize it or create it with {"environment": "Prod", "profile": "default"}.`);
        }
        throw new Error(`Failed to read state.json: ${error.message}`);
    }
};

export const getActiveEnvironmentOrNull = async (): Promise<string | null> => {
    const state = await getActiveStateOrNull();
    return state.environment;
};

export const getActiveProfileName = async (): Promise<string> => {
    const state = await getActiveStateOrNull();
    return state.profile || DEFAULT_PROFILE_NAME;
};

export const getAllEnvironments = async (): Promise<Record<string, EnvironmentConfig>> => {
    try {
        const envFile = await fs.readFile(ENV_PATH, "utf-8");
        const parsed = JSON.parse(envFile);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new Error("env.json must contain a top-level JSON object mapping environment names to configurations.");
        }
        const normalized: Record<string, EnvironmentConfig> = {};
        for (const [envName, envVal] of Object.entries(parsed)) {
            if (envVal && typeof envVal === "object" && !Array.isArray(envVal)) {
                normalized[envName] = normalizeEnvironmentConfig(envVal as Record<string, any>);
            }
        }
        return normalized;
    } catch (error: any) {
        throw new Error(`Failed to read env.json at ${ENV_PATH}: ${error.message}`);
    }
};

export const setActiveEnvironment = async (
    environment?: string | null,
    profile?: string | null
): Promise<{
    previousEnvironment: string | null;
    previousProfile: string;
    environment: string;
    profile: string;
}> => {
    const envData = await getAllEnvironments();

    let existingState: Record<string, any> = {};
    let previousEnvironment: string | null = null;
    let previousProfile: string = DEFAULT_PROFILE_NAME;

    try {
        const fileData = await fs.readFile(CONFIG_PATH, "utf-8");
        const parsed = JSON.parse(fileData);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            existingState = parsed;
            if (typeof parsed.environment === "string" && parsed.environment.trim() !== "") {
                previousEnvironment = parsed.environment.trim();
            }
            if (typeof parsed.profile === "string" && parsed.profile.trim() !== "") {
                previousProfile = parsed.profile.trim();
            }
        }
    } catch (error: any) {
        if (error.code !== "ENOENT") {
            throw new Error(`Failed to read existing state.json at ${CONFIG_PATH}: ${error.message}`);
        }
    }

    const targetEnvironment =
        typeof environment === "string" && environment.trim() !== ""
            ? environment.trim()
            : previousEnvironment;

    if (!targetEnvironment) {
        throw new Error("No active environment is currently set. Please provide an 'environment' name.");
    }

    const targetEnvConfig = envData[targetEnvironment];
    if (!targetEnvConfig) {
        const available = Object.keys(envData);
        const availableList = available.length > 0 ? available.join(", ") : "none";
        throw new Error(`Environment '${targetEnvironment}' not found in env.json. Available environments: ${availableList}`);
    }

    const profiles = targetEnvConfig.profiles || { [DEFAULT_PROFILE_NAME]: createDefaultProfileConfig() };
    let targetProfile: string;

    if (typeof profile === "string" && profile.trim() !== "") {
        targetProfile = profile.trim();
        if (!profiles[targetProfile]) {
            const availableProfiles = Object.keys(profiles).join(", ");
            throw new Error(
                `Profile '${targetProfile}' not found in environment '${targetEnvironment}'. Available profiles: ${availableProfiles}`
            );
        }
    } else if (targetEnvironment !== previousEnvironment) {
        targetProfile = DEFAULT_PROFILE_NAME;
    } else {
        targetProfile = profiles[previousProfile] ? previousProfile : DEFAULT_PROFILE_NAME;
    }

    await fs.mkdir(MCP_DIR, { recursive: true });
    const updatedState = {
        ...existingState,
        environment: targetEnvironment,
        profile: targetProfile
    };
    await fs.writeFile(CONFIG_PATH, JSON.stringify(updatedState, null, 2) + "\n", "utf-8");

    // Reset dynamic session toolset overrides whenever environment or profile switches
    if (previousEnvironment !== targetEnvironment || previousProfile !== targetProfile) {
        clearSessionCategories();
    }

    return {
        previousEnvironment,
        previousProfile,
        environment: targetEnvironment,
        profile: targetProfile
    };
};

export const getEnvironmentConfig = async (
    environment?: string,
    profile?: string
): Promise<{
    environment: string;
    config: EnvironmentConfig;
    profileName: string;
    profile: ToolProfileConfig;
}> => {
    const activeState = await getActiveStateOrNull();
    const activeEnv = environment ?? activeState.environment;
    if (!activeEnv) {
        throw new Error(`'environment' is not set in ${CONFIG_PATH}. Use 'netsuite_switch_environment' to select an environment.`);
    }

    const envData = await getAllEnvironments();
    const config = envData[activeEnv];
    if (!config) {
        throw new Error(`Credentials for environment '${activeEnv}' not found in env.json`);
    }

    const requestedProfile = profile ?? (environment && environment !== activeState.environment ? DEFAULT_PROFILE_NAME : activeState.profile);
    const { profileName, profile: resolvedProfile } = resolveEnvironmentProfile(config, requestedProfile);

    return {
        environment: activeEnv,
        config,
        profileName,
        profile: resolvedProfile
    };
};

/**
 * Checks only the hard guardrails (blockedCategories, blockedTools, disableDestructive, disableSdf, missing sdfId)
 * that cannot be bypassed by dynamic session toolset activation.
 * Tools explicitly listed in `profile.allowedTools` are exempted from `disableDestructive` and `disableSdf`
 * (but never from `blockedCategories`, `blockedTools`, or a missing `sdfId`).
 */
export const getToolHardGuardrailReason = (
    tool: ToolDefinition,
    config: EnvironmentConfig,
    profileName?: string | null
): string | null => {
    if (tool.meta.alwaysAvailable) {
        return null;
    }

    const { profile } = resolveEnvironmentProfile(config, profileName);
    const category = getToolCategory(tool);
    const blockedCategories = Array.isArray(profile.blockedCategories) ? profile.blockedCategories : [];

    if (blockedCategories.includes(category)) {
        return `category '${category}' is blocked in profile.blockedCategories`;
    }

    const blockedTools = Array.isArray(profile.blockedTools) ? profile.blockedTools : [];
    if (blockedTools.includes(tool.name)) {
        return "explicitly blocked in profile.blockedTools";
    }

    // Technical prerequisite: SDF tools cannot run without an sdfId configured on the environment
    if (tool.meta.requiresSdf && (typeof config.sdfId !== "string" || config.sdfId.trim() === "")) {
        return "sdfId is not configured for this environment";
    }

    const allowedTools = Array.isArray(profile.allowedTools) ? profile.allowedTools : [];
    const isExemptedFromGuardrails = allowedTools.includes(tool.name);

    if (tool.meta.isDestructive && profile.disableDestructive === true && !isExemptedFromGuardrails) {
        return "destructive tools are disabled in this profile";
    }

    if (tool.meta.requiresSdf && profile.disableSdf === true && !isExemptedFromGuardrails) {
        return "SDF tools are disabled in this profile";
    }

    return null;
};

/**
 * Prunes any in-memory session-activated/deactivated tools or categories that are no longer
 * eligible under the active profile's hard guardrails (e.g., after profile guardrails or
 * guardrailExceptions are updated in the Settings UI or env.json).
 */
export const pruneIneligibleSessionOverrides = (
    allTools: ToolDefinition[],
    config: EnvironmentConfig,
    profileName?: string | null
): void => {
    const { profileName: resolvedProfileName, profile } = resolveEnvironmentProfile(config, profileName);

    if (profile.allowDynamicActivation === false) {
        clearSessionCategories();
        return;
    }

    const selectableTools = allTools.filter(
        t => !t.meta.alwaysAvailable && t.name !== "netsuite_manage_toolsets"
    );
    const toolByName = new Map<string, ToolDefinition>(selectableTools.map(t => [t.name, t]));

    for (const tName of Array.from(sessionActivatedTools)) {
        const toolDef = toolByName.get(tName);
        if (!toolDef || getToolHardGuardrailReason(toolDef, config, resolvedProfileName) !== null) {
            sessionActivatedTools.delete(tName);
        }
    }

    for (const tName of Array.from(sessionDeactivatedTools)) {
        const toolDef = toolByName.get(tName);
        if (!toolDef || getToolHardGuardrailReason(toolDef, config, resolvedProfileName) !== null) {
            sessionDeactivatedTools.delete(tName);
        }
    }

    const blockedCategories = new Set(Array.isArray(profile.blockedCategories) ? profile.blockedCategories : []);

    for (const catId of Array.from(sessionActivatedCategories)) {
        if (blockedCategories.has(catId)) {
            sessionActivatedCategories.delete(catId);
            continue;
        }
        if (selectableTools.length > 0) {
            const catTools = selectableTools.filter(t => getToolCategory(t) === catId);
            if (
                catTools.length > 0 &&
                catTools.every(t => getToolHardGuardrailReason(t, config, resolvedProfileName) !== null)
            ) {
                sessionActivatedCategories.delete(catId);
            }
        }
    }

    for (const catId of Array.from(sessionDeactivatedCategories)) {
        if (blockedCategories.has(catId)) {
            sessionDeactivatedCategories.delete(catId);
        }
    }
};

export const getEffectiveEnabledCategories = (profile: ToolProfileConfig): string[] => {
    const blockedCategories = new Set(Array.isArray(profile.blockedCategories) ? profile.blockedCategories : []);
    const baseline = Array.isArray(profile.enabledCategories)
        ? profile.enabledCategories
        : DEFAULT_ENABLED_CATEGORIES;
    const effective = new Set<string>(baseline.filter(c => !blockedCategories.has(c)));

    if (profile.allowDynamicActivation !== false) {
        for (const cat of sessionActivatedCategories) {
            if (!blockedCategories.has(cat)) {
                effective.add(cat);
            }
        }
        for (const cat of sessionDeactivatedCategories) {
            effective.delete(cat);
        }
    }

    return Array.from(effective);
};

export const getToolDisableReason = (
    tool: ToolDefinition,
    config: EnvironmentConfig,
    profileName?: string | null
): string | null => {
    if (tool.meta.alwaysAvailable) {
        return null;
    }

    const { profileName: resolvedProfileName, profile } = resolveEnvironmentProfile(config, profileName);

    // Special visibility check for netsuite_manage_toolsets
    if (tool.name === "netsuite_manage_toolsets") {
        if (profile.allowDynamicActivation === false) {
            return `dynamic toolset activation is disabled in profile '${resolvedProfileName}'`;
        }
        return null;
    }

    // 1. Check hard guardrails first (never bypassed)
    const guardrailReason = getToolHardGuardrailReason(tool, config, resolvedProfileName);
    if (guardrailReason) {
        return guardrailReason;
    }

    const canDynamic = profile.allowDynamicActivation !== false;

    // 2. Check individual tool session overrides first
    if (canDynamic && sessionDeactivatedTools.has(tool.name)) {
        return `tool '${tool.name}' was deactivated for this session (can be re-activated via 'netsuite_manage_toolsets')`;
    }
    if (canDynamic && sessionActivatedTools.has(tool.name)) {
        return null;
    }

    const category = getToolCategory(tool);
    const isSessionActivated = canDynamic && sessionActivatedCategories.has(category);
    const isSessionDeactivated = canDynamic && sessionDeactivatedCategories.has(category);

    // 3. If the category was explicitly deactivated for this session, disable it
    if (isSessionDeactivated) {
        return `category '${category}' was deactivated for this session (can be re-activated via 'netsuite_manage_toolsets')`;
    }

    // 4. If the category was dynamically activated for this session, unlock all non-blocked tools in the category
    if (isSessionActivated) {
        return null;
    }

    // 5. Baseline profile evaluation:
    //    - If the category is enabled in the profile, the tool is enabled UNLESS it is in profile.disabledTools.
    //    - If the category is NOT enabled in the profile, the tool is enabled ONLY IF it is in profile.enabledTools.
    const baselineCategories = Array.isArray(profile.enabledCategories)
        ? profile.enabledCategories
        : DEFAULT_ENABLED_CATEGORIES;
    const isCategoryEnabledInProfile = baselineCategories.includes(category);

    if (isCategoryEnabledInProfile) {
        const disabledTools = Array.isArray(profile.disabledTools) ? profile.disabledTools : [];
        if (disabledTools.includes(tool.name)) {
            if (canDynamic) {
                return `disabled at startup in profile '${resolvedProfileName}' (can be activated for this session via 'netsuite_manage_toolsets' with tools: ['${tool.name}'])`;
            }
            return `disabled in profile '${resolvedProfileName}' (profile.disabledTools)`;
        }
        return null;
    } else {
        const enabledTools = Array.isArray(profile.enabledTools) ? profile.enabledTools : [];
        if (enabledTools.includes(tool.name)) {
            return null;
        }
        if (canDynamic) {
            return `category '${category}' is not enabled at startup in profile '${resolvedProfileName}' (can be activated for this session via 'netsuite_manage_toolsets' with tools: ['${tool.name}'] or categories: ['${category}'])`;
        }
        return `category '${category}' is not enabled in profile '${resolvedProfileName}'`;
    }
};

export const getAllEnvironmentsOrEmpty = async (): Promise<Record<string, EnvironmentConfig>> => {
    try {
        const envFile = await fs.readFile(ENV_PATH, "utf-8");
        const parsed = JSON.parse(envFile);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            return {};
        }
        const normalized: Record<string, EnvironmentConfig> = {};
        for (const [envName, envVal] of Object.entries(parsed)) {
            if (envVal && typeof envVal === "object" && !Array.isArray(envVal)) {
                normalized[envName] = normalizeEnvironmentConfig(envVal as Record<string, any>);
            }
        }
        return normalized;
    } catch (error: any) {
        if (error.code === "ENOENT") {
            return {};
        }
        throw new Error(`Failed to read env.json at ${ENV_PATH}: ${error.message}`);
    }
};

export const saveAllEnvironments = async (environments: Record<string, EnvironmentConfig>): Promise<void> => {
    await fs.mkdir(MCP_DIR, { recursive: true });
    const normalized: Record<string, EnvironmentConfig> = {};
    for (const [envName, envVal] of Object.entries(environments)) {
        normalized[envName] = normalizeEnvironmentConfig(envVal);
    }
    await fs.writeFile(ENV_PATH, JSON.stringify(normalized, null, 2) + "\n", "utf-8");
};

export const setOrClearActiveEnvironment = async (
    environment: string | null,
    profile?: string | null
): Promise<void> => {
    let existingState: Record<string, any> = {};
    let prevEnv: string | null = null;
    let prevProf: string = DEFAULT_PROFILE_NAME;

    try {
        const fileData = await fs.readFile(CONFIG_PATH, "utf-8");
        const parsed = JSON.parse(fileData);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            existingState = parsed;
            if (typeof parsed.environment === "string" && parsed.environment.trim() !== "") {
                prevEnv = parsed.environment.trim();
            }
            if (typeof parsed.profile === "string" && parsed.profile.trim() !== "") {
                prevProf = parsed.profile.trim();
            }
        }
    } catch (error: any) {
        if (error.code !== "ENOENT") {
            throw new Error(`Failed to read existing state.json at ${CONFIG_PATH}: ${error.message}`);
        }
    }

    const nextEnv = environment && environment.trim() !== "" ? environment.trim() : "";
    const nextProf =
        typeof profile === "string" && profile.trim() !== ""
            ? profile.trim()
            : nextEnv && nextEnv === prevEnv
                ? prevProf
                : DEFAULT_PROFILE_NAME;

    await fs.mkdir(MCP_DIR, { recursive: true });
    const updatedState = {
        ...existingState,
        environment: nextEnv,
        profile: nextProf
    };
    await fs.writeFile(CONFIG_PATH, JSON.stringify(updatedState, null, 2) + "\n", "utf-8");

    if (prevEnv !== (nextEnv || null) || prevProf !== nextProf) {
        clearSessionCategories();
    }
};

export const getAppConfigOrEmpty = async (): Promise<Record<string, any>> => {
    try {
        const fileData = await fs.readFile(APP_CONFIG_PATH, "utf-8");
        const parsed = JSON.parse(fileData);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            return parsed;
        }
        return {};
    } catch (error: any) {
        if (error.code === "ENOENT") {
            return {};
        }
        throw new Error(`Failed to read config.json at ${APP_CONFIG_PATH}: ${error.message}`);
    }
};

export const saveAppConfig = async (appConfig: Record<string, any>): Promise<void> => {
    await fs.mkdir(MCP_DIR, { recursive: true });
    await fs.writeFile(APP_CONFIG_PATH, JSON.stringify(appConfig, null, 2) + "\n", "utf-8");
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
