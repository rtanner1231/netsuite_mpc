import { ToolDefinition } from "../types/index.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { getProjectRoot } from "../utils/mcp.js";
import { getProjectConfig } from "../utils/project.js";
import { listSdfTranslationCollections } from "../utils/translations.js";

export const listTranslationCollectionsTool: ToolDefinition = {
    name: "netsuite_list_translation_collections",
    description:
        "Lists all Translation Collections (custcollection_*) in the active NetSuite environment by running 'suitecloud object:list --type translationcollection' in an isolated temporary SDF project.",
    meta: {
        isDestructive: false,
        requiresSdf: true
    },
    inputSchema: {
        type: "object",
        properties: {}
    },
    execute: async (_args: Record<string, never>, server: Server) => {
        try {
            const projectRoot = await getProjectRoot(server);
            const projectConfig = await getProjectConfig(projectRoot);

            const { scriptIds } = await listSdfTranslationCollections(projectRoot, projectConfig);

            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(
                            {
                                count: scriptIds.length,
                                collections: scriptIds
                            },
                            null,
                            2
                        )
                    }
                ]
            };
        } catch (error: any) {
            return {
                content: [
                    {
                        type: "text",
                        text: `Error listing translation collections: ${error.message}`
                    }
                ]
            };
        }
    }
};
