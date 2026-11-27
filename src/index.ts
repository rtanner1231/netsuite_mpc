import fs from "fs";
import fsPromises from "fs/promises";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    CallToolRequestSchema,
    GetPromptRequestSchema,
    ListPromptsRequestSchema,
    ListToolsRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import { promptsRegistry } from "./prompts/index.js";
import { toolsRegistry } from "./tools/index.js";
import { buildManageToolsetsDescription } from "./tools/manageToolsets.js";
import {
    APP_CONFIG_PATH,
    CONFIG_PATH,
    ENV_PATH,
    EnvironmentConfig,
    MCP_DIR,
    clearSessionCategories,
    getActiveStateOrNull,
    getEnvironmentConfig,
    getToolDisableReason
} from "./utils/config.js";
import { getProjectRoot } from "./utils/mcp.js";
import { resolveEffectiveSaveToProject } from "./utils/project.js";
import { getSaveToProjectSchemaProperty } from "./utils/objects.js";
import {
    notifySettingsClientsOfConfigChange,
    resumeSettingsServerIfPersisted
} from "./utils/settingsServer.js";

const server = new Server(
    { name: "NetSuite Schema Provider TS", version: "1.0.0" },
    { capabilities: { tools: { listChanged: true }, prompts: {} } }
);

// Register prompts to MCP
server.setRequestHandler(ListPromptsRequestSchema, async () => {
    return {
        prompts: promptsRegistry.map(prompt => ({
            name: prompt.name,
            title: prompt.title,
            description: prompt.description,
            arguments: prompt.arguments
        }))
    };
});

server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const requestedPrompt = promptsRegistry.find(p => p.name === request.params.name);

    if (!requestedPrompt) {
        throw new Error(`Prompt not found: ${request.params.name}`);
    }

    return await requestedPrompt.getMessages(request.params.arguments);
});

// Register tools to MCP
server.setRequestHandler(ListToolsRequestSchema, async () => {
    let environment: string | null = null;
    let config: EnvironmentConfig | null = null;
    let profileName: string | null = null;
    try {
        ({ environment, config, profileName } = await getEnvironmentConfig());
    } catch (error: any) {
        console.error(`Warning: Could not load environment config for ListTools: ${error.message}`);
    }

    let effectiveSaveInfo: Awaited<ReturnType<typeof resolveEffectiveSaveToProject>> | undefined;
    try {
        const projectRoot = await getProjectRoot(server);
        effectiveSaveInfo = await resolveEffectiveSaveToProject(projectRoot);
    } catch {
        // Fallback if project root or config cannot be resolved during ListTools
    }

    return {
        tools: toolsRegistry
            .filter(tool => config
                ? getToolDisableReason(tool, config, profileName) === null
                : tool.meta.alwaysAvailable === true
            )
            .map(tool => {
                let inputSchema = tool.inputSchema;
                let description = tool.description;

                if (tool.name === "netsuite_manage_toolsets") {
                    description = buildManageToolsetsDescription(
                        toolsRegistry,
                        environment,
                        config,
                        profileName
                    );
                }

                // Dynamically populate the saveToProject property description with the active project's effective default
                if (
                    effectiveSaveInfo &&
                    inputSchema &&
                    typeof inputSchema === "object" &&
                    inputSchema.properties &&
                    typeof inputSchema.properties === "object" &&
                    "saveToProject" in inputSchema.properties
                ) {
                    inputSchema = {
                        ...inputSchema,
                        properties: {
                            ...inputSchema.properties,
                            saveToProject: getSaveToProjectSchemaProperty(effectiveSaveInfo)
                        }
                    };
                }

                return {
                    name: tool.name,
                    description,
                    inputSchema
                };
            })
    };
});

// Handle Tool Execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const requestedTool = toolsRegistry.find(t => t.name === request.params.name);

    if (!requestedTool) {
        throw new Error(`Tool not found: ${request.params.name}`);
    }

    try {
        if (!requestedTool.meta.alwaysAvailable) {
            const { environment, config, profileName } = await getEnvironmentConfig();
            const disableReason = getToolDisableReason(requestedTool, config, profileName);
            if (disableReason) {
                return {
                    content: [{
                        type: "text",
                        text: `Tool '${requestedTool.name}' is disabled in the '${environment}' environment under profile '${profileName}' (${disableReason}).`
                    }],
                    isError: true
                };
            }
        }

        // Pass arguments and the server instance (for things like getProjectRoot)
        return await requestedTool.execute(request.params.arguments, server);
    } catch (error: any) {
        return {
            content: [{ type: "text", text: `Tool execution error: ${error.message}` }]
        };
    }
});

const computeConfigFilesSignature = async (): Promise<string> => {
    const readSafe = async (filePath: string): Promise<string> => {
        try {
            return await fsPromises.readFile(filePath, "utf-8");
        } catch {
            return "";
        }
    };
    const [stateContent, envContent, appConfigContent] = await Promise.all([
        readSafe(CONFIG_PATH),
        readSafe(ENV_PATH),
        readSafe(APP_CONFIG_PATH)
    ]);
    return `${stateContent}\n---ENV---\n${envContent}\n---CFG---\n${appConfigContent}`;
};

const startConfigWatcher = async (mcpServer: Server): Promise<void> => {
    try {
        await fsPromises.mkdir(MCP_DIR, { recursive: true });
    } catch {
        // Ignore if directory cannot be created yet
    }

    let lastSignature = await computeConfigFilesSignature();
    let lastActiveState = await getActiveStateOrNull().catch(() => ({ environment: null, profile: "default" }));
    let debounceTimer: NodeJS.Timeout | null = null;

    const checkAndNotify = async () => {
        try {
            const currentSignature = await computeConfigFilesSignature();
            if (currentSignature !== lastSignature) {
                lastSignature = currentSignature;
                const currentState = await getActiveStateOrNull().catch(() => ({ environment: null, profile: "default" }));
                if (
                    currentState.environment !== lastActiveState.environment ||
                    currentState.profile !== lastActiveState.profile
                ) {
                    lastActiveState = currentState;
                    clearSessionCategories();
                }
                await mcpServer.sendToolListChanged();
                void notifySettingsClientsOfConfigChange();
            }
        } catch (err: any) {
            console.error(`Warning: Config watcher failed to send tool list changed notification: ${err?.message || err}`);
        }
    };

    try {
        const watcher = fs.watch(MCP_DIR, (_eventType, filename) => {
            if (filename && filename !== "state.json" && filename !== "env.json" && filename !== "config.json") {
                return;
            }
            if (debounceTimer) {
                clearTimeout(debounceTimer);
            }
            debounceTimer = setTimeout(() => {
                void checkAndNotify();
            }, 100);
        });
        watcher.unref();
    } catch (err: any) {
        console.error(`Warning: Could not start fs.watch on ${MCP_DIR}: ${err?.message || err}`);
    }

    // Periodic fallback check (every 2 seconds) in case atomic file renames or OS fs.watch quirks miss an event
    const pollInterval = setInterval(() => {
        void checkAndNotify();
    }, 2000);
    pollInterval.unref();
};

// Boot up transport
async function run() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    void resumeSettingsServerIfPersisted(server, () => toolsRegistry);
    void startConfigWatcher(server);

    // Ensure the process exits cleanly if the client closes stdio
    process.stdin.on("end", () => process.exit(0));
    process.stdin.on("close", () => process.exit(0));

    console.error("NetSuite MCP Server (TS) running on stdio");
}

run().catch((error) => {
    console.error("Server failed to start:", error);
    process.exit(1);
});
