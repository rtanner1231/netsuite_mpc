import fs from "fs/promises";
import path from "path";
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

        const schemaPath = path.join(MCP_DIR, `${environment}.json`);

        try {
            const fileData = await fs.readFile(schemaPath, "utf-8");
            const schemaData = JSON.parse(fileData);
            const tableFields = schemaData.schema || {};

            if (!tableFields[table_id]) {
                return { content: [{ type: "text", text: `Error: Table ID '${table_id}' not found in the ${environment} schema.` }] };
            }

            const fields = tableFields[table_id].fields;
            const lines = [`Fields for '${table_id}' in ${environment}:`];

            fields.forEach((field: any) => {
                lines.push(`- ${field.id || "unknown_id"} (${field.label || "No Label"})`);
                if (Array.isArray(field.joins) && field.joins.length > 0) {
                    field.joins.forEach((join: any) => {
                        lines.push(`  - Join: ${join.id || "unknown_join_id"} (${join.label || "No Label"})`);
                        if (Array.isArray(join.joinPairs)) {
                            join.joinPairs.forEach((pair: any) => {
                                lines.push(`    - Pair: ${pair.id || "unknown_pair_id"} [${pair.label || "No Label"}]`);
                            });
                        }
                    });
                }
            });

            return { content: [{ type: "text", text: lines.join("\n") }] };
        } catch (error: any) {
            if (error.code === "ENOENT") return { content: [{ type: "text", text: `Error: Schema file missing at ${schemaPath}.` }] };
            return { content: [{ type: "text", text: `Error reading/parsing schema: ${error.message}` }] };
        }
    }
};
