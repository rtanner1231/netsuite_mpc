import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { toolsRegistry } from "./tools/index.js";
import { EnvironmentConfig, getEnvironmentConfig, getToolDisableReason } from "./utils/config.js";

const server = new Server(
    { name: "NetSuite Schema Provider TS", version: "1.0.0" },
    { capabilities: { tools: {} } }
);

// Register tools to MCP
server.setRequestHandler(ListToolsRequestSchema, async () => {
    let config: EnvironmentConfig | null = null;
    try {
        ({ config } = await getEnvironmentConfig());
    } catch (error: any) {
        console.error(`Warning: Could not load environment config for ListTools: ${error.message}`);
    }

    return {
        tools: toolsRegistry
            .filter(tool => !config || getToolDisableReason(tool, config) === null)
            .map(tool => ({
                name: tool.name,
                description: tool.description,
                inputSchema: tool.inputSchema
            }))
    };
});

// Handle Tool Execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const requestedTool = toolsRegistry.find(t => t.name === request.params.name);

    if (!requestedTool) {
        throw new Error(`Tool not found: ${request.params.name}`);
    }

    try {
        const { environment, config } = await getEnvironmentConfig();
        const disableReason = getToolDisableReason(requestedTool, config);
        if (disableReason) {
            return {
                content: [{ type: "text", text: `Tool '${requestedTool.name}' is disabled in the '${environment}' environment (${disableReason}).` }],
                isError: true
            };
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
