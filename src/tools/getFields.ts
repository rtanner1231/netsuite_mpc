import fs from "fs/promises";
import path from "path";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import { ToolDefinition } from "../types/index.js";
import { getActiveEnvironment, MCP_DIR } from "../utils/config.js";

export const getNetsuiteFieldsTool: ToolDefinition = {
    name: "netsuite_get_fields",
    description: "Retrieve field definitions for a specific NetSuite table based on the locally configured environment.",
    inputSchema: {
        type: "object",
        properties: { table_id: { type: "string", description: "The internal ID of the NetSuite table" } },
        required: ["table_id"]
    },
    execute: async (args: { table_id: string }) => {
        const { table_id } = args;
        let environment;
        try { environment = await getActiveEnvironment(); }
        catch (error: any) { return { content: [{ type: "text", text: `Config Error: ${error.message}` }] }; }

        const schemaPath = path.join(MCP_DIR, `${environment}.db`);

        try {
            await fs.access(schemaPath);
        } catch (error: any) {
            return { content: [{ type: "text", text: `Error: Schema file missing at ${schemaPath}.` }] };
        }

        try {
            const db = await open({
                filename: schemaPath,
                driver: sqlite3.Database,
                mode: sqlite3.OPEN_READONLY
            });

            const rows = await db.all(
                'SELECT id, label, joins FROM tablefields WHERE tableid = ?',
                [table_id]
            );

            await db.close();

            if (!rows || rows.length === 0) {
                return { content: [{ type: "text", text: `Error: Table ID '${table_id}' not found in the ${environment} schema.` }] };
            }

            const lines = [`Fields for '${table_id}' in ${environment}:`];

            rows.forEach((row: any) => {
                lines.push(`- ${row.id || "unknown_id"} (${row.label || "No Label"})`);
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

            return { content: [{ type: "text", text: lines.join("\n") }] };
        } catch (error: any) {
            return { content: [{ type: "text", text: `Error reading/parsing schema: ${error.message}` }] };
        }
    }
};
