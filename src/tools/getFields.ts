import fs from "fs/promises";
import path from "path";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import { ToolDefinition } from "../types/index.js";
import { getActiveEnvironment, MCP_DIR } from "../utils/config.js";
import { fetchNetsuiteMetadata } from "../utils/api.js";

export interface NetsuiteField {
    id: string;
    fieldType: string;
    label: string;
}

/**
 * Extracts a list of fields from a NetSuite REST API metadata response.
 * 
 * @param tableid - The internal ID of the table/custom record (e.g., 'customrecord_test_mcp_branch')
 * @param responseData - The JSON string response from the NetSuite metadata service
 * @returns An array of mapped field objects
 */
export function extractNetsuiteFields(tableid: string, responseData: string): NetsuiteField[] {
    try {
        const parsedData = JSON.parse(responseData);

        // Navigate safely to the properties object for the given tableid
        const schemas = parsedData?.components?.schemas;
        if (!schemas || !schemas[tableid] || !schemas[tableid].properties) {
            return [];
        }

        const properties = schemas[tableid].properties;

        // Map the object entries directly into the expected array format
        return Object.entries<any>(properties).map(([fieldId, fieldConfig]) => ({
            id: fieldId,
            fieldType: fieldConfig.type || 'Select',
            label: fieldConfig.title || fieldId
        }));

    } catch (error) {
        console.error("Failed to parse NetSuite metadata response:", error);
        return [];
    }
}

function formatApiFields(table_id: string, environment: string, fields: NetsuiteField[]): string {
    const lines = [`Fields for '${table_id}' in ${environment} (via API):`];
    fields.forEach(field => {
        const typeStr = field.fieldType ? ` [Type: ${field.fieldType}]` : "";
        lines.push(`- ${field.id}${typeStr} (${field.label})`);
    });
    return lines.join("\n");
}

function formatDbFields(table_id: string, environment: string, tableInfo: any | undefined, rows: any[]): string {
    const lines = [`Fields for '${table_id}' in ${environment}:`];
    if (tableInfo) {
        if (tableInfo.label) {
            lines.push(`Table Label: ${tableInfo.label}`);
        }
        if (tableInfo.description) {
            lines.push(`Table Description: ${String(tableInfo.description).replace(/\s+/g, " ").trim()}`);
        }
        if (tableInfo.is_custom !== undefined && tableInfo.is_custom !== null) {
            lines.push(`Custom Record: ${tableInfo.is_custom ? "Yes" : "No"}`);
        }
        if (tableInfo.include_name !== undefined && tableInfo.include_name !== null) {
            lines.push(`Include Name Field: ${tableInfo.include_name ? "Yes" : "No"}`);
        }
    }
    rows.forEach((row: any) => {
        const typeStr = row.fieldtype ? ` [Type: ${row.fieldtype}]` : "";
        const descStr = row.description ? ` - ${String(row.description).replace(/\s+/g, " ").trim()}` : "";
        lines.push(`- ${row.id || "unknown_id"}${typeStr} (${row.label || "No Label"})${descStr}`);
        if (row.joins) {
            try {
                const parsedJoins = JSON.parse(row.joins);
                if (Array.isArray(parsedJoins) && parsedJoins.length > 0) {
                    parsedJoins.forEach((join: any) => {
                        lines.push(`  - Join: ${join.id || "unknown_join_id"} (${join.label || "No Label"})`);
                        if (Array.isArray(join.joinPairs)) {
                            join.joinPairs.forEach((pair: any) => {
                                lines.push(`    - Pair: ${pair.id || "unknown_pair_id"} [${pair.label || "No Label"}]`);
                            });
                        }
                    });
                }
            } catch (e) {
                // ignore JSON parse error for joins
            }
        }
    });
    return lines.join("\n");
}

async function fetchFromDatabase(schemaPath: string, table_id: string): Promise<{ tableInfo: any; rows: any[] }> {
    await fs.access(schemaPath);
    const db = await open({
        filename: schemaPath,
        driver: sqlite3.Database,
        mode: sqlite3.OPEN_READONLY
    });

    try {
        const tableInfo = await db.get(
            'SELECT id, label, description, is_custom, include_name FROM tables WHERE id = ?',
            [table_id]
        );
        const rows = await db.all(
            'SELECT id, label, description, joins, fieldtype FROM tablefields WHERE tableid = ?',
            [table_id]
        );

        return { tableInfo, rows };
    } finally {
        await db.close();
    }
}

export const getNetsuiteFieldsTool: ToolDefinition = {
    name: "netsuite_get_fields",
    description: "Retrieve field definitions for a specific NetSuite table based on the locally configured environment.",
    meta: {
        isDestructive: false,
        requiresSdf: false
    },
    inputSchema: {
        type: "object",
        properties: { 
            table_id: { type: "string", description: "The internal ID of the NetSuite table" },
            useFallback: { type: "boolean", description: "If true, skips looking for the database and directly calls the NetSuite metadata endpoint. Only set this to true if the user explicitly requests it." }
        },
        required: ["table_id"]
    },
    execute: async (args: { table_id: string; useFallback?: boolean }) => {
        const { table_id, useFallback } = args;
        let environment;
        try { environment = await getActiveEnvironment(); }
        catch (error: any) { return { content: [{ type: "text", text: `Config Error: ${error.message}` }] }; }

        const schemaPath = path.join(MCP_DIR, `${environment}.db`);
        let fallbackTriggered = useFallback || false;
        let tableInfo: any = undefined;
        let rows: any[] = [];

        if (!fallbackTriggered) {
            try {
                const dbResult = await fetchFromDatabase(schemaPath, table_id);
                tableInfo = dbResult.tableInfo;
                rows = dbResult.rows;
                if (!rows || rows.length === 0) {
                    fallbackTriggered = true;
                }
            } catch (error: any) {
                fallbackTriggered = true;
            }
        }

        if (fallbackTriggered) {
            try {
                const responseData = await fetchNetsuiteMetadata(table_id);
                const fields = extractNetsuiteFields(table_id, responseData);
                
                if (fields.length === 0) {
                    return { content: [{ type: "text", text: `Error: Table ID '${table_id}' not found locally or via NetSuite Metadata API.` }] };
                }

                return { content: [{ type: "text", text: formatApiFields(table_id, environment, fields) }] };
            } catch (error: any) {
                return { content: [{ type: "text", text: `Error fetching metadata fallback: ${error.message}` }] };
            }
        }

        return { content: [{ type: "text", text: formatDbFields(table_id, environment, tableInfo, rows) }] };
    }
};
