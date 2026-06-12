import { Server } from "@modelcontextprotocol/sdk/server/index.js";

export interface ToolDefinition {
    name: string;
    description: string;
    inputSchema: {
        type: "object";
        properties: Record<string, any>;
        required?: string[];
    };
    execute: (args: any, server: Server) => Promise<{ content: { type: "text"; text: string }[] }>;
}
