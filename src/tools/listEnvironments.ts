import { ToolDefinition } from "../types/index.js";
import { getActiveEnvironmentOrNull, getAllEnvironments } from "../utils/config.js";

export const listEnvironmentsTool: ToolDefinition = {
    name: "netsuite_list_environments",
    description: "Lists all configured NetSuite environments from env.json and indicates which environment is currently active.",
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
            let stateError: string | null = null;
            try {
                activeEnv = await getActiveEnvironmentOrNull();
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
                lines.push(`Current Environment: ${activeEnv}`);
                lines.push("");
            }

            lines.push("Available Environments:");
            for (const envName of envNames) {
                const isCurrent = envName === activeEnv;
                const marker = isCurrent ? "* " : "  ";
                const suffix = isCurrent ? " (current)" : "";
                lines.push(`${marker}${envName}${suffix}`);
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
