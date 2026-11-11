import fs from "fs/promises";
import path from "path";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import { ToolDefinition } from "../types/index.js";
import { getActiveEnvironment, MCP_DIR } from "../utils/config.js";

const DEFAULT_MAX_DEPTH = 2;
const MIN_MAX_DEPTH = 1;
const MAX_MAX_DEPTH = 5;
const MAX_CONDITIONS_PER_TABLE = 5;
const SQLITE_CHUNK_SIZE = 500;

interface TableMetadata {
    id: string;
    label: string;
    isCustom: boolean;
}

interface JoinPair {
    id?: string;
    label?: string;
}

interface RawJoinEntry {
    id?: string;
    label?: string;
    joinPairs?: JoinPair[];
}

export interface RelatedTableNode {
    tableId: string;
    label: string;
    isCustom: boolean;
    depth: number;
    viaTable: string;
    conditions: string[];
}

export interface RelatedTablesResult {
    rootTable: TableMetadata;
    maxDepth: number;
    nodesByDepth: Map<number, RelatedTableNode[]>;
    totalRelated: number;
}

function isCustomListTable(tableId: string): boolean {
    return tableId.toLowerCase().startsWith("customlist");
}

function formatJoinCondition(
    sourceTableId: string,
    fieldId: string,
    targetTableId: string,
    joinEntry: RawJoinEntry
): string {
    const pairs = Array.isArray(joinEntry.joinPairs) ? joinEntry.joinPairs : [];
    if (pairs.length === 0) {
        return `${sourceTableId}.${fieldId} = ${targetTableId}.id`;
    }

    const formattedPairs = pairs.map((pair) => {
        const label = pair.label ? String(pair.label).trim() : "";
        if (label.includes("=")) {
            return label;
        }
        if (pair.id === "mapone") {
            return `${sourceTableId}.id = ${targetTableId}.mapone`;
        }
        const targetCol = pair.id ? String(pair.id).trim() : "id";
        return `${sourceTableId}.${fieldId} = ${targetTableId}.${targetCol}`;
    });

    return formattedPairs.join(" AND ");
}

async function fetchTablesMetadataMap(
    db: any,
    tableIds: Iterable<string>
): Promise<Map<string, TableMetadata>> {
    const ids = Array.from(new Set(Array.from(tableIds, (id) => id.toLowerCase())));
    const map = new Map<string, TableMetadata>();
    if (ids.length === 0) {
        return map;
    }

    for (let i = 0; i < ids.length; i += SQLITE_CHUNK_SIZE) {
        const chunk = ids.slice(i, i + SQLITE_CHUNK_SIZE);
        const placeholders = chunk.map(() => "?").join(",");
        const rows = await db.all(
            `SELECT id, label, is_custom FROM tables WHERE LOWER(id) IN (${placeholders})`,
            chunk
        );
        for (const row of rows) {
            if (!row.id) continue;
            const normId = String(row.id).toLowerCase();
            map.set(normId, {
                id: normId,
                label: row.label ? String(row.label).trim() : normId,
                isCustom: Boolean(row.is_custom) || normId.startsWith("customrecord")
            });
        }
    }

    return map;
}

async function fetchFieldsWithJoinsForTables(
    db: any,
    tableIds: string[]
): Promise<{ tableid: string; id: string; label: string | null; joins: string }[]> {
    const results: { tableid: string; id: string; label: string | null; joins: string }[] = [];
    if (tableIds.length === 0) {
        return results;
    }

    for (let i = 0; i < tableIds.length; i += SQLITE_CHUNK_SIZE) {
        const chunk = tableIds.slice(i, i + SQLITE_CHUNK_SIZE);
        const placeholders = chunk.map(() => "?").join(",");
        const rows = await db.all(
            `SELECT tableid, id, label, joins
             FROM tablefields
             WHERE LOWER(tableid) IN (${placeholders})
               AND joins IS NOT NULL
               AND joins != ''
               AND joins != '[]'`,
            chunk
        );
        results.push(...rows);
    }

    return results;
}

export async function buildRelatedTablesMap(
    schemaPath: string,
    startTableId: string,
    options?: {
        maxDepth?: number;
        includeCustomLists?: boolean;
        includePolymorphicSubtypes?: boolean;
    }
): Promise<RelatedTablesResult | null> {
    await fs.access(schemaPath);

    const normalizedStart = startTableId.trim().toLowerCase();
    const rawDepth = options?.maxDepth ?? DEFAULT_MAX_DEPTH;
    const maxDepth = Math.max(MIN_MAX_DEPTH, Math.min(MAX_MAX_DEPTH, Math.floor(rawDepth)));
    const includeCustomLists = options?.includeCustomLists ?? true;
    const includePolymorphicSubtypes = options?.includePolymorphicSubtypes ?? false;

    const db = await open({
        filename: schemaPath,
        driver: sqlite3.Database,
        mode: sqlite3.OPEN_READONLY
    });

    try {
        const rootRow = await db.get(
            "SELECT id, label, is_custom FROM tables WHERE LOWER(id) = ?",
            [normalizedStart]
        );

        if (!rootRow) {
            const fieldCheck = await db.get(
                "SELECT tableid FROM tablefields WHERE LOWER(tableid) = ? LIMIT 1",
                [normalizedStart]
            );
            if (!fieldCheck) {
                return null;
            }
        }

        const rootTable: TableMetadata = {
            id: rootRow?.id ? String(rootRow.id).toLowerCase() : normalizedStart,
            label: rootRow?.label ? String(rootRow.label).trim() : normalizedStart,
            isCustom: Boolean(rootRow?.is_custom) || normalizedStart.startsWith("customrecord")
        };

        const visited = new Set<string>([rootTable.id]);
        const discoveredNodes = new Map<string, RelatedTableNode>();
        let currentFrontier: string[] = [rootTable.id];

        for (let depth = 1; depth <= maxDepth && currentFrontier.length > 0; depth++) {
            const rows = await fetchFieldsWithJoinsForTables(db, currentFrontier);
            const nextFrontier: string[] = [];

            for (const row of rows) {
                if (!row.tableid || !row.joins) continue;
                const sourceTable = String(row.tableid).toLowerCase();
                const fieldId = row.id ? String(row.id).toLowerCase() : "unknown_field";

                let parsedJoins: RawJoinEntry[];
                try {
                    parsedJoins = JSON.parse(row.joins);
                } catch {
                    continue;
                }

                if (!Array.isArray(parsedJoins) || parsedJoins.length === 0) {
                    continue;
                }

                const entriesToProcess = includePolymorphicSubtypes
                    ? parsedJoins
                    : [parsedJoins[0]];

                for (const joinEntry of entriesToProcess) {
                    if (!joinEntry || !joinEntry.id) continue;
                    const targetId = String(joinEntry.id).trim().toLowerCase();
                    if (!targetId || targetId === rootTable.id) continue;

                    if (!includeCustomLists && isCustomListTable(targetId)) {
                        continue;
                    }

                    const condition = formatJoinCondition(
                        sourceTable,
                        fieldId,
                        targetId,
                        joinEntry
                    );

                    if (!visited.has(targetId)) {
                        visited.add(targetId);
                        const node: RelatedTableNode = {
                            tableId: targetId,
                            label: joinEntry.label ? String(joinEntry.label).trim() : targetId,
                            isCustom: targetId.startsWith("customrecord"),
                            depth,
                            viaTable: sourceTable,
                            conditions: [condition]
                        };
                        discoveredNodes.set(targetId, node);

                        if (!isCustomListTable(targetId)) {
                            nextFrontier.push(targetId);
                        }
                    } else {
                        const existingNode = discoveredNodes.get(targetId);
                        if (
                            existingNode &&
                            existingNode.depth === depth &&
                            existingNode.viaTable === sourceTable &&
                            !existingNode.conditions.includes(condition)
                        ) {
                            existingNode.conditions.push(condition);
                        }
                    }
                }
            }

            currentFrontier = nextFrontier;
        }

        const metadataMap = await fetchTablesMetadataMap(db, discoveredNodes.keys());
        const nodesByDepth = new Map<number, RelatedTableNode[]>();

        for (const node of discoveredNodes.values()) {
            const meta = metadataMap.get(node.tableId);
            if (meta) {
                if (meta.label && meta.label !== node.tableId) {
                    node.label = meta.label;
                }
                node.isCustom = meta.isCustom;
            }

            let list = nodesByDepth.get(node.depth);
            if (!list) {
                list = [];
                nodesByDepth.set(node.depth, list);
            }
            list.push(node);
        }

        return {
            rootTable,
            maxDepth,
            nodesByDepth,
            totalRelated: discoveredNodes.size
        };
    } finally {
        await db.close();
    }
}

export function formatRelatedTablesMap(
    environment: string,
    result: RelatedTablesResult
): string {
    const { rootTable, maxDepth, nodesByDepth, totalRelated } = result;
    const rootCustomBadge = rootTable.isCustom ? " [Custom Record]" : "";

    const lines: string[] = [
        `Related tables map for '${rootTable.id}' in ${environment} (max_depth: ${maxDepth}, total related tables: ${totalRelated}):`,
        `Root Table: ${rootTable.id} (${rootTable.label})${rootCustomBadge}`
    ];

    if (totalRelated === 0) {
        lines.push("");
        lines.push("No related tables found via outgoing joins.");
        return lines.join("\n");
    }

    for (let depth = 1; depth <= maxDepth; depth++) {
        const nodes = nodesByDepth.get(depth);
        if (!nodes || nodes.length === 0) continue;

        lines.push("");
        const depthHeader =
            depth === 1
                ? `Depth 1 (${nodes.length} table${nodes.length === 1 ? "" : "s"} - direct joins from '${rootTable.id}'):`
                : `Depth ${depth} (${nodes.length} table${nodes.length === 1 ? "" : "s"} - reached via Depth ${depth - 1} tables):`;
        lines.push(depthHeader);

        for (const node of nodes) {
            const customBadge = node.isCustom ? " [Custom Record]" : "";
            const fromClause = depth > 1 ? ` [from ${node.viaTable}]` : "";

            const visibleConditions = node.conditions.slice(0, MAX_CONDITIONS_PER_TABLE);
            const remainingCount = node.conditions.length - visibleConditions.length;
            const moreSuffix = remainingCount > 0 ? ` (+${remainingCount} more)` : "";

            lines.push(`- ${node.tableId} (${node.label})${customBadge}${fromClause}`);
            lines.push(`  - via: ${visibleConditions.join(" | ")}${moreSuffix}`);
        }
    }

    return lines.join("\n");
}

export const getRelatedTablesTool: ToolDefinition = {
    name: "netsuite_get_related_tables",
    description:
        "Builds a map of related NetSuite tables starting from a specific table ID by traversing field joins across hop levels.",
    inputSchema: {
        type: "object",
        properties: {
            table_id: {
                type: "string",
                description: "The internal ID of the starting NetSuite table (e.g., 'transaction', 'customer', or a custom record ID)."
            },
            max_depth: {
                type: "number",
                description: "Maximum number of join hops to traverse from the starting table (1 to 5, default: 2)."
            },
            include_custom_lists: {
                type: "boolean",
                description: "Whether to include custom list lookup tables (customlist_*) in the results. Defaults to true."
            },
            include_polymorphic_subtypes: {
                type: "boolean",
                description: "Whether to expand polymorphic joins into all subtype record tables (e.g., all 87 transaction subtypes instead of collapsing to 'transaction'). Defaults to false."
            }
        },
        required: ["table_id"]
    },
    execute: async (args: {
        table_id: string;
        max_depth?: number;
        include_custom_lists?: boolean;
        include_polymorphic_subtypes?: boolean;
    }) => {
        const tableId = args?.table_id?.trim();
        if (!tableId) {
            return {
                content: [{ type: "text", text: "Error: 'table_id' must be a non-empty string." }]
            };
        }

        let environment: string;
        try {
            environment = await getActiveEnvironment();
        } catch (error: any) {
            return { content: [{ type: "text", text: `Config Error: ${error.message}` }] };
        }

        const schemaPath = path.join(MCP_DIR, `${environment}.db`);

        try {
            await fs.access(schemaPath);
        } catch {
            return {
                content: [{
                    type: "text",
                    text: `Error: Schema database not found for environment '${environment}'.`
                }]
            };
        }

        try {
            const result = await buildRelatedTablesMap(schemaPath, tableId, {
                maxDepth: args.max_depth,
                includeCustomLists: args.include_custom_lists,
                includePolymorphicSubtypes: args.include_polymorphic_subtypes
            });

            if (!result) {
                return {
                    content: [{
                        type: "text",
                        text: `Error: Table ID '${tableId}' not found in the local schema database for environment '${environment}'.`
                    }]
                };
            }

            return {
                content: [{
                    type: "text",
                    text: formatRelatedTablesMap(environment, result)
                }]
            };
        } catch (error: any) {
            return {
                content: [{
                    type: "text",
                    text: `Error building related tables map: ${error.message}`
                }]
            };
        }
    }
};
