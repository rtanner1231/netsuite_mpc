import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { ToolDefinition } from "../types/index.js";
import { startOrGetSettingsServer } from "../utils/settingsServer.js";
import { toolsRegistry } from "./index.js";
import { MCP_DIR } from "../utils/config.js";

export const openSettingsTool: ToolDefinition = {
    name: "netsuite_open_settings",
    description:
        "Starts a local graphical settings web page and opens it in the user's browser to add, edit, or delete NetSuite environments, test connections, configure tool restrictions, and manage global config.json defaults. Automatically creates the config directory and files when saved.",
    meta: {
        isDestructive: false,
        requiresSdf: false,
        alwaysAvailable: true
    },
    inputSchema: {
        type: "object",
        properties: {}
    },
    execute: async (_args: any, server: Server) => {
        try {
            const { url, browserOpened } = await startOrGetSettingsServer(server, () => toolsRegistry);

            const lines = [
                `NetSuite MCP Settings UI is running at:`,
                url,
                "",
                browserOpened
                    ? `Opened the settings page in your default web browser.`
                    : `Could not automatically launch a browser—please open the URL above manually in your browser.`,
                "",
                `Configuration directory: ${MCP_DIR}`,
                `Note: If you add or disable tools and your AI client/harness does not immediately show the updated tool list after saving, toggle the NetSuite MCP server off and on again.`
            ];

            return {
                content: [{
                    type: "text",
                    text: lines.join("\n")
                }]
            };
        } catch (error: any) {
            return {
                content: [{
                    type: "text",
                    text: `Failed to start settings server: ${error.message}`
                }]
            };
        }
    }
};
