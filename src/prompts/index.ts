import { PromptDefinition } from "../types/index.js";

export const openSettingsPrompt: PromptDefinition = {
    name: "open-settings",
    title: "Open NetSuite Settings",
    description:
        "Starts the local graphical settings web page and opens it in your browser to configure NetSuite environments, tool profiles, permissions, and global defaults.",
    getMessages: async () => ({
        description: "Open the NetSuite MCP graphical settings web interface.",
        messages: [
            {
                role: "user",
                content: {
                    type: "text",
                    text: "Please open the NetSuite MCP settings interface by calling the `netsuite_open_settings` tool and share the local settings URL and status."
                }
            }
        ]
    })
};

export const listEnvironmentsPrompt: PromptDefinition = {
    name: "list-environments",
    title: "List NetSuite Environments",
    description:
        "Lists all configured NetSuite environments and their tool profiles from env.json, and indicates which environment and profile are currently active.",
    getMessages: async () => ({
        description: "List all configured NetSuite environments, their tool profiles, and the currently active environment/profile.",
        messages: [
            {
                role: "user",
                content: {
                    type: "text",
                    text: "Please list all configured NetSuite environments and their tool profiles, and show which environment and profile are currently active by calling the `netsuite_list_environments` tool."
                }
            }
        ]
    })
};

export const switchEnvironmentPrompt: PromptDefinition = {
    name: "switch-environment",
    title: "Switch NetSuite Environment / Profile",
    description:
        "Switches the active NetSuite environment and/or tool profile in state.json (or lists available environments and profiles if none is specified).",
    arguments: [
        {
            name: "environment",
            description: "The name of the NetSuite environment to switch to (must match a key in env.json).",
            required: false
        },
        {
            name: "profile",
            description: "Optional name of the tool profile to activate on the environment (e.g., 'default', 'developer', 'admin').",
            required: false
        }
    ],
    getMessages: async (args) => {
        const targetEnv = typeof args?.environment === "string" ? args.environment.trim() : "";
        const targetProfile = typeof args?.profile === "string" ? args.profile.trim() : "";

        if (targetEnv && targetProfile) {
            return {
                description: `Switch the active NetSuite environment to '${targetEnv}' with profile '${targetProfile}'.`,
                messages: [
                    {
                        role: "user",
                        content: {
                            type: "text",
                            text: `Please switch the active NetSuite environment to "${targetEnv}" and profile "${targetProfile}" using the \`netsuite_switch_environment\` tool and confirm the change.`
                        }
                    }
                ]
            };
        }

        if (targetEnv) {
            return {
                description: `Switch the active NetSuite environment to '${targetEnv}'.`,
                messages: [
                    {
                        role: "user",
                        content: {
                            type: "text",
                            text: `Please switch the active NetSuite environment to "${targetEnv}" using the \`netsuite_switch_environment\` tool and confirm the change.`
                        }
                    }
                ]
            };
        }

        if (targetProfile) {
            return {
                description: `Switch the active tool profile to '${targetProfile}' on the current NetSuite environment.`,
                messages: [
                    {
                        role: "user",
                        content: {
                            type: "text",
                            text: `Please switch the active tool profile on the current NetSuite environment to "${targetProfile}" using the \`netsuite_switch_environment\` tool and confirm the change.`
                        }
                    }
                ]
            };
        }

        return {
            description: "List available NetSuite environments and tool profiles and switch to a selected one.",
            messages: [
                {
                    role: "user",
                    content: {
                        type: "text",
                        text: "I want to switch the active NetSuite environment or tool profile. First call `netsuite_list_environments` to show the available environments, their profiles, and which one is currently active, then ask me which environment and/or profile I would like to switch to before calling `netsuite_switch_environment`."
                    }
                }
            ]
        };
    }
};

export const promptsRegistry: PromptDefinition[] = [
    openSettingsPrompt,
    listEnvironmentsPrompt,
    switchEnvironmentPrompt
];
