import { ToolDefinition } from "../types/index.js";
import {
    DEFAULT_PROFILE_NAME,
    getActiveStateOrNull,
    getAllEnvironments,
    getSessionActivatedCategories,
    getSessionActivatedTools,
    getSessionDeactivatedCategories,
    getSessionDeactivatedTools,
    resolveEnvironmentProfile
} from "../utils/config.js";

export const listEnvironmentsTool: ToolDefinition = {
    name: "netsuite_list_environments",
    description:
        "Lists all configured NetSuite environments and their tool profiles from env.json, and indicates which environment and profile are currently active.",
    meta: {
        isDestructive: false,
        requiresSdf: false,
        alwaysAvailable: true
    },
    inputSchema: {
        type: "object",
        properties: {}
    },
    execute: async () => {
        try {
            const environments = await getAllEnvironments();
            const envNames = Object.keys(environments);

            if (envNames.length === 0) {
                return {
                    content: [{
                        type: "text",
                        text: "No environments are configured in env.json."
                    }]
                };
            }

            let activeEnv: string | null = null;
            let requestedProfile = DEFAULT_PROFILE_NAME;
            let stateError: string | null = null;
            try {
                const state = await getActiveStateOrNull();
                activeEnv = state.environment;
                requestedProfile = state.profile || DEFAULT_PROFILE_NAME;
            } catch (error: any) {
                stateError = error.message;
            }

            const lines: string[] = [];

            if (stateError) {
                lines.push(`Warning: ${stateError}`);
                lines.push("");
            } else if (!activeEnv) {
                lines.push("Current Environment: None (state.json is not initialized. Use 'netsuite_switch_environment' to select one.)");
                lines.push("");
            } else if (!environments[activeEnv]) {
                lines.push(`Current Environment: '${activeEnv}' (Warning: not found in env.json. Use 'netsuite_switch_environment' to select a valid environment.)`);
                lines.push("");
            } else {
                const { profileName: resolvedActiveProfile } = resolveEnvironmentProfile(environments[activeEnv], requestedProfile);
                lines.push(`Current Environment: ${activeEnv} (Active Profile: ${resolvedActiveProfile})`);
                const sessionAdded = getSessionActivatedCategories();
                const sessionRemoved = getSessionDeactivatedCategories();
                const sessionAddedTools = getSessionActivatedTools();
                const sessionRemovedTools = getSessionDeactivatedTools();
                if (sessionAdded.length > 0) {
                    lines.push(`Session-Activated Categories: ${sessionAdded.join(", ")}`);
                }
                if (sessionRemoved.length > 0) {
                    lines.push(`Session-Deactivated Categories: ${sessionRemoved.join(", ")}`);
                }
                if (sessionAddedTools.length > 0) {
                    lines.push(`Session-Activated Tools: ${sessionAddedTools.join(", ")}`);
                }
                if (sessionRemovedTools.length > 0) {
                    lines.push(`Session-Deactivated Tools: ${sessionRemovedTools.join(", ")}`);
                }
                lines.push("");
            }

            lines.push("Available Environments & Profiles:");
            for (const envName of envNames) {
                const envCfg = environments[envName];
                const isCurrentEnv = envName === activeEnv;
                const marker = isCurrentEnv ? "* " : "  ";
                const suffix = isCurrentEnv ? " (current environment)" : "";
                lines.push(`${marker}${envName}${suffix}`);

                const profiles = envCfg.profiles || {};
                const { profileName: activeProfForEnv } = isCurrentEnv
                    ? resolveEnvironmentProfile(envCfg, requestedProfile)
                    : { profileName: "" };

                for (const [profName, profCfg] of Object.entries(profiles)) {
                    const isCurrentProf = isCurrentEnv && profName === activeProfForEnv;
                    const profMarker = isCurrentProf ? "    * " : "      ";
                    const profSuffix = isCurrentProf ? " (active profile)" : "";
                    const cats = Array.isArray(profCfg.enabledCategories) && profCfg.enabledCategories.length > 0
                        ? profCfg.enabledCategories.join(", ")
                        : "none";
                    const flags: string[] = [];
                    if (profCfg.disableDestructive) flags.push("disableDestructive");
                    if (profCfg.disableSdf) flags.push("disableSdf");
                    if (
                        (profCfg.disableDestructive || profCfg.disableSdf) &&
                        Array.isArray(profCfg.allowedTools) &&
                        profCfg.allowedTools.length > 0
                    ) {
                        flags.push(`exceptions: ${profCfg.allowedTools.join(", ")}`);
                    }
                    if (profCfg.allowDynamicActivation === false) flags.push("dynamicActivationOff");
                    const flagStr = flags.length > 0 ? ` [${flags.join(", ")}]` : "";
                    const descStr = profCfg.description ? ` — ${profCfg.description}` : "";

                    lines.push(`${profMarker}Profile '${profName}'${profSuffix}${descStr} (categories: ${cats})${flagStr}`);
                }
            }

            return {
                content: [{
                    type: "text",
                    text: lines.join("\n")
                }]
            };
        } catch (error: any) {
            return {
                content: [{
                    type: "text",
                    text: `Config Error: ${error.message}`
                }]
            };
        }
    }
};
