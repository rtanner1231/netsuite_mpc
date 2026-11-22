import { Server } from "@modelcontextprotocol/sdk/server/index.js";

export interface ToolMetadata {
    isDestructive: boolean;
    requiresSdf: boolean;
    alwaysAvailable?: boolean;
}

export interface ToolDefinition {
    name: string;
    description: string;
    meta: ToolMetadata;
    inputSchema: {
        type: "object";
        properties: Record<string, any>;
        required?: string[];
    };
    execute: (args: any, server: Server) => Promise<{ content: { type: "text"; text: string }[] }>;
}

export interface PromptArgumentDefinition {
    name: string;
    description?: string;
    required?: boolean;
}

export interface PromptMessageDefinition {
    role: "user" | "assistant";
    content: {
        type: "text";
        text: string;
    };
}

export interface PromptDefinition {
    name: string;
    title: string;
    description: string;
    arguments?: PromptArgumentDefinition[];
    getMessages: (args?: Record<string, string>) => Promise<{
        description?: string;
        messages: PromptMessageDefinition[];
    }>;
}
