import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { ToolDefinition } from "../types/index.js";
import { setActiveEnvironment } from "../utils/config.js";

export const switchEnvironmentTool: ToolDefinition = {
    name: "netsuite_switch_environment",
    description: "Switches the active NetSuite environment by updating (or initializing) state.json and notifies the client that available tools may have changed.",
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
                description: "The name of the environment to switch to (must match a key in env.json)."
            }
        },
        required: ["environment"]
    },
    execute: async (args: { environment: string }, server: Server) => {
        const targetEnv = typeof args?.environment === "string" ? args.environment.trim() : "";
        if (!targetEnv) {
            return {
                content: [{
                    type: "text",
                    text: "Error: 'environment' must be a non-empty string."
                }]
            };
        }

        try {
            const { previousEnvironment, environment } = await setActiveEnvironment(targetEnv);

            try {
                await server.sendToolListChanged();
            } catch (notifyError: any) {
                console.error(`Warning: Failed to send tool list changed notification: ${notifyError?.message || notifyError}`);
            }

            if (previousEnvironment === environment) {
                return {
                    content: [{
                        type: "text",
                        text: `Environment is already set to '${environment}'.`
                    }]
                };
            }

            const message = previousEnvironment
                ? `Switched active NetSuite environment from '${previousEnvironment}' to '${environment}'.`
                : `Initialized state.json and set active NetSuite environment to '${environment}'.`;

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
                    text: `Error switching environment: ${error.message}`
                }]
            };
        }
    }
};
