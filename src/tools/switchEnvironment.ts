import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { ToolDefinition } from "../types/index.js";
import { setActiveEnvironment } from "../utils/config.js";

export const switchEnvironmentTool: ToolDefinition = {
    name: "netsuite_switch_environment",
    description:
        "Switches the active NetSuite environment and/or tool profile by updating (or initializing) state.json, resetting any temporary session toolset overrides, and notifying the client that available tools may have changed.",
    meta: {
        isDestructive: false,
        requiresSdf: false,
        alwaysAvailable: true
    },
    inputSchema: {
        type: "object",
        properties: {
            environment: {
                type: "string",
                description:
                    "The name of the environment to switch to (must match a key in env.json). If omitted, keeps the currently active environment and switches only the profile."
            },
            profile: {
                type: "string",
                description:
                    "Optional name of the tool profile to activate on the target environment (e.g., 'default', 'developer', 'admin'). Defaults to 'default' when switching to a different environment."
            }
        }
    },
    execute: async (args: { environment?: string; profile?: string }, server: Server) => {
        const targetEnv = typeof args?.environment === "string" ? args.environment.trim() : "";
        const targetProfile = typeof args?.profile === "string" ? args.profile.trim() : "";

        if (!targetEnv && !targetProfile) {
            return {
                content: [{
                    type: "text",
                    text: "Error: Provide at least one of 'environment' or 'profile' to switch."
                }],
                isError: true
            };
        }

        try {
            const {
                previousEnvironment,
                previousProfile,
                environment,
                profile
            } = await setActiveEnvironment(targetEnv || null, targetProfile || null);

            try {
                await server.sendToolListChanged();
            } catch (notifyError: any) {
                console.error(`Warning: Failed to send tool list changed notification: ${notifyError?.message || notifyError}`);
            }

            if (previousEnvironment === environment && previousProfile === profile) {
                return {
                    content: [{
                        type: "text",
                        text: `Active environment is already set to '${environment}' with profile '${profile}'.`
                    }]
                };
            }

            let message: string;
            if (!previousEnvironment) {
                message = `Initialized state.json and set active NetSuite environment to '${environment}' (profile: '${profile}').`;
            } else if (previousEnvironment === environment) {
                message = `Switched active tool profile on environment '${environment}' from '${previousProfile}' to '${profile}'.`;
            } else {
                message = `Switched active NetSuite environment from '${previousEnvironment}' (profile: '${previousProfile}') to '${environment}' (profile: '${profile}').`;
            }

            return {
                content: [{
                    type: "text",
                    text: message
                }]
            };
        } catch (error: any) {
            return {
                content: [{
                    type: "text",
                    text: `Error switching environment/profile: ${error.message}`
                }],
                isError: true
            };
        }
    }
};
