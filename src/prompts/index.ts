import { PromptDefinition } from "../types/index.js";

export const openSettingsPrompt: PromptDefinition = {
    name: "open-settings",
    title: "Open NetSuite Settings",
    description:
        "Starts the local graphical settings web page and opens it in your browser to configure NetSuite environments, permissions, and global defaults.",
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
        "Lists all configured NetSuite environments from env.json and indicates which environment is currently active.",
    getMessages: async () => ({
        description: "List all configured NetSuite environments and the currently active environment.",
        messages: [
            {
                role: "user",
                content: {
                    type: "text",
                    text: "Please list all configured NetSuite environments and show which environment is currently active by calling the `netsuite_list_environments` tool."
                }
            }
        ]
    })
};

export const switchEnvironmentPrompt: PromptDefinition = {
    name: "switch-environment",
    title: "Switch NetSuite Environment",
    description:
        "Switches the active NetSuite environment in state.json (or lists available environments if none is specified).",
    arguments: [
        {
            name: "environment",
            description: "The name of the NetSuite environment to switch to (must match a key in env.json).",
            required: false
        }
    ],
    getMessages: async (args) => {
        const targetEnv = typeof args?.environment === "string" ? args.environment.trim() : "";

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

        return {
            description: "List available NetSuite environments and switch to a selected environment.",
            messages: [
                {
                    role: "user",
                    content: {
                        type: "text",
                        text: "I want to switch the active NetSuite environment. First call `netsuite_list_environments` to show the available environments and which one is currently active, then ask me which environment I would like to switch to before calling `netsuite_switch_environment`."
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
