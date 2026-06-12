import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { toolsRegistry } from "./tools/index.js";

const server = new Server(
    { name: "NetSuite Schema Provider TS", version: "1.0.0" },
    { capabilities: { tools: {} } }
);

// Register tools to MCP
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: toolsRegistry.map(tool => ({
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
