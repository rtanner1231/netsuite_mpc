import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { toolsRegistry } from "./tools/index.js";
import { getDisabledTools } from "./utils/config.js";

const server = new Server(
    { name: "NetSuite Schema Provider TS", version: "1.0.0" },
    { capabilities: { tools: {} } }
);

// Register tools to MCP
server.setRequestHandler(ListToolsRequestSchema, async () => {
    let disabledTools = new Set<string>();
    try {
        ({ disabledTools } = await getDisabledTools());
    } catch (error: any) {
        console.error(`Warning: Could not load disabledTools for ListTools: ${error.message}`);
    }

    return {
        tools: toolsRegistry
            .filter(tool => !disabledTools.has(tool.name))
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
        const { environment, disabledTools } = await getDisabledTools();
        if (disabledTools.has(requestedTool.name)) {
            return {
                content: [{ type: "text", text: `Tool '${requestedTool.name}' is disabled in the '${environment}' environment.` }],
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
