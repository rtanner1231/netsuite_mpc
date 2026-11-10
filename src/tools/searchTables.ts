import fs from "fs/promises";
import * as lancedb from "@lancedb/lancedb";
import { ToolDefinition } from "../types/index.js";
import { getActiveEnvironment } from "../utils/config.js";
import {
    LANCEDB_TABLE_NAME,
    generateEmbedding,
    getLanceDbPath
} from "../utils/vectorDb.js";
import { getRebuildState } from "./rebuildVectorDatabase.js";

export async function searchTablesInLanceDb(
    lancePath: string,
    query: string,
    limit = 5
): Promise<any[]> {
    const queryVector = await generateEmbedding(query);
    const vectordb = await lancedb.connect(lancePath);
    const table = await vectordb.openTable(LANCEDB_TABLE_NAME);

    const results = await table
        .vectorSearch(queryVector)
        .limit(limit)
        .toArray();

    return results;
}

function formatSearchResults(query: string, environment: string, results: any[]): string {
    if (!results || results.length === 0) {
        return `No matching tables found for query "${query}" in ${environment}.`;
    }

    const lines: string[] = [
        `Top ${results.length} matching tables for "${query}" in ${environment}:`,
        ""
    ];

    results.forEach((row: any, idx: number) => {
        const customBadge = row.is_custom ? " [Custom Record]" : "";
        const includeNameStr = row.is_custom && row.include_name !== undefined
            ? ` (Include Name: ${row.include_name ? "Yes" : "No"})`
            : "";
        const distanceStr = typeof row._distance === "number"
            ? ` [Distance: ${row._distance.toFixed(4)}]`
            : "";

        lines.push(`${idx + 1}. ${row.id} (${row.label || row.id})${customBadge}${includeNameStr}${distanceStr}`);
        if (row.description) {
            lines.push(`   Description: ${row.description}`);
        }
        if (row.columns_summary) {
            const maxPreviewLen = 500;
            const preview = row.columns_summary.length > maxPreviewLen
                ? `${row.columns_summary.slice(0, maxPreviewLen)}...`
                : row.columns_summary;
            lines.push(`   Columns: ${preview}`);
        }
        lines.push("");
    });

    lines.push("Tip: Use 'netsuite_get_fields' with a table_id to inspect full field definitions and joins.");
    return lines.join("\n");
}

export const searchTablesTool: ToolDefinition = {
    name: "netsuite_search_tables",
    description: "Performs a semantic search against the NetSuite vector database and returns the top 5 matching tables.",
    inputSchema: {
        type: "object",
        properties: {
            query: {
                type: "string",
                description: "Natural language search query describing the NetSuite table or data you are looking for."
            }
        },
        required: ["query"]
    },
    execute: async (args: { query: string }) => {
        const query = args?.query?.trim();
        if (!query) {
            return {
                content: [{ type: "text", text: "Error: 'query' must be a non-empty string." }]
            };
        }

        let environment: string;
        try {
            environment = await getActiveEnvironment();
        } catch (error: any) {
            return { content: [{ type: "text", text: `Config Error: ${error.message}` }] };
        }

        const lancePath = getLanceDbPath(environment);

        try {
            await fs.access(lancePath);
        } catch {
            const rebuildState = getRebuildState(environment);
            if (rebuildState && rebuildState.status === "in_progress") {
                return {
                    content: [{
                        type: "text",
                        text: `Error: Vector database for environment '${environment}' is currently being rebuilt. Check 'netsuite_rebuild_vector_database_status' for progress.`
                    }]
                };
            }

            return {
                content: [{
                    type: "text",
                    text: `Error: Vector database not found for environment '${environment}'. Please run 'netsuite_rebuild_vector_database' first.`
                }]
            };
        }

        try {
            const results = await searchTablesInLanceDb(lancePath, query, 5);
            return {
                content: [{
                    type: "text",
                    text: formatSearchResults(query, environment, results)
                }]
            };
        } catch (error: any) {
            return {
                content: [{
                    type: "text",
                    text: `Error searching vector database: ${error.message}`
                }]
            };
        }
    }
};
