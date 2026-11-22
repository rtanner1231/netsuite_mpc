import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { toolsRegistry } from "./tools/index.js";
import { EnvironmentConfig, getEnvironmentConfig, getToolDisableReason } from "./utils/config.js";
import { getProjectRoot } from "./utils/mcp.js";
import { resolveEffectiveSaveToProject } from "./utils/project.js";
import { getSaveToProjectSchemaProperty } from "./utils/objects.js";

const server = new Server(
    { name: "NetSuite Schema Provider TS", version: "1.0.0" },
    { capabilities: { tools: { listChanged: true } } }
);

// Register tools to MCP
server.setRequestHandler(ListToolsRequestSchema, async () => {
    let config: EnvironmentConfig | null = null;
    try {
        ({ config } = await getEnvironmentConfig());
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
                ? getToolDisableReason(tool, config) === null
                : tool.meta.alwaysAvailable === true
            )
            .map(tool => {
                let inputSchema = tool.inputSchema;

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
                    description: tool.description,
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
            const { environment, config } = await getEnvironmentConfig();
            const disableReason = getToolDisableReason(requestedTool, config);
            if (disableReason) {
                return {
                    content: [{ type: "text", text: `Tool '${requestedTool.name}' is disabled in the '${environment}' environment (${disableReason}).` }],
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

// Boot up transport
async function run() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("NetSuite MCP Server (TS) running on stdio");
}

run().catch((error) => {
    console.error("Server failed to start:", error);
    process.exit(1);
});
