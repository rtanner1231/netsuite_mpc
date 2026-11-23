import { Server } from "@modelcontextprotocol/sdk/server/index.js";

export interface ToolMetadata {
    isDestructive: boolean;
    requiresSdf: boolean;
    alwaysAvailable?: boolean;
    category?: string;
}

export type ToolContentItem =
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
    | {
          type: "resource";
          resource:
              | { uri: string; mimeType?: string; text: string }
              | { uri: string; mimeType?: string; blob: string };
      };

export interface ToolDefinition {
    name: string;
    description: string;
    meta: ToolMetadata;
    inputSchema: {
        type: "object";
        properties: Record<string, any>;
        required?: string[];
    };
    execute: (args: any, server: Server) => Promise<{ content: ToolContentItem[]; isError?: boolean }>;
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
