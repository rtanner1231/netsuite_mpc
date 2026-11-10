import fs from "fs/promises";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import * as lancedb from "@lancedb/lancedb";
import { ToolDefinition } from "../types/index.js";
import { MCP_DIR, getActiveEnvironment } from "../utils/config.js";
import {
    LANCEDB_TABLE_NAME,
    TableFieldRow,
    TableRow,
    VectorTableRecord,
    buildTableEmbeddingText,
    generateEmbeddingsBatch,
    getLanceDbPath,
    getSqliteDbPath,
    sanitizeText
} from "../utils/vectorDb.js";

export type RebuildStatus = "idle" | "in_progress" | "completed" | "failed";
export type RebuildPhase =
    | "loading_schema"
    | "generating_embeddings"
    | "writing_database"
    | "done"
    | "error";

export interface RebuildJobState {
    status: RebuildStatus;
    environment: string;
    phase: RebuildPhase;
    startedAt: number;
    completedAt?: number;
    totalTables: number;
    processedTables: number;
    skippedEmptyCount: number;
    error?: string;
}

const rebuildStates = new Map<string, RebuildJobState>();

export function getRebuildState(environment: string): RebuildJobState | undefined {
    return rebuildStates.get(environment);
}

function stripPathsFromError(message: string, pathsToStrip: string[]): string {
    let sanitized = message;
    for (const p of pathsToStrip) {
        if (p) {
            sanitized = sanitized.split(p).join("<redacted_path>");
        }
    }
    if (MCP_DIR) {
        sanitized = sanitized.split(MCP_DIR).join("<redacted_dir>");
    }
    return sanitized;
}

function formatPhaseLabel(phase: RebuildPhase): string {
    switch (phase) {
        case "loading_schema":
            return "Loading schema tables and fields";
        case "generating_embeddings":
            return "Generating table embeddings";
        case "writing_database":
            return "Writing vector database";
        case "done":
            return "Completed";
        case "error":
            return "Failed";
    }
}

export function formatRebuildStatusMessage(state: RebuildJobState): string {
    const endTime = state.completedAt ?? Date.now();
    const elapsedSeconds = ((endTime - state.startedAt) / 1000).toFixed(2);

    if (state.status === "in_progress") {
        const progressLine = state.totalTables > 0
            ? `- Progress: ${state.processedTables} / ${state.totalTables} tables (${Math.round((state.processedTables / state.totalTables) * 100)}%)`
            : `- Progress: Preparing tables...`;

        return [
            `Vector database rebuild for environment '${state.environment}' is currently IN PROGRESS.`,
            `- Phase: ${formatPhaseLabel(state.phase)}`,
            progressLine,
            `- Elapsed time: ${elapsedSeconds}s`
        ].join("\n");
    }

    if (state.status === "completed") {
        return [
            `Vector database rebuild for environment '${state.environment}' is COMPLETED.`,
            `- Tables indexed: ${state.processedTables}`,
            `- Empty tables skipped: ${state.skippedEmptyCount}`,
            `- Elapsed time: ${elapsedSeconds}s`
        ].join("\n");
    }

    if (state.status === "failed") {
        return [
            `Vector database rebuild for environment '${state.environment}' FAILED.`,
            `- Error: ${state.error || "Unknown error"}`,
            `- Elapsed time: ${elapsedSeconds}s`
        ].join("\n");
    }

    return `No vector database rebuild is currently running for environment '${state.environment}'.`;
}

async function loadTablesAndFields(sqlitePath: string): Promise<{
    tables: TableRow[];
    fieldsByTable: Map<string, TableFieldRow[]>;
}> {
    const db = await open({
        filename: sqlitePath,
        driver: sqlite3.Database,
        mode: sqlite3.OPEN_READONLY
    });

    try {
        const tables = await db.all<TableRow[]>(
            "SELECT id, label, description, is_custom, include_name FROM tables"
        );
        const allFields = await db.all<TableFieldRow[]>(
            "SELECT tableid, id, label, description, fieldtype FROM tablefields"
        );

        const fieldsByTable = new Map<string, TableFieldRow[]>();
        for (const field of allFields) {
            if (!field.tableid) continue;
            let list = fieldsByTable.get(field.tableid);
            if (!list) {
                list = [];
                fieldsByTable.set(field.tableid, list);
            }
            list.push(field);
        }

        return { tables, fieldsByTable };
    } finally {
        await db.close();
    }
}

export interface RebuildCallbacks {
    onSchemaLoaded?: (totalTables: number, skippedEmptyCount: number) => void;
    onEmbeddingProgress?: (processedTables: number, totalTables: number) => void;
    onWritingDatabase?: () => void;
}

export async function rebuildVectorDatabaseForPaths(
    sqlitePath: string,
    lancePath: string,
    callbacks?: RebuildCallbacks
): Promise<{
    indexedCount: number;
    skippedEmptyCount: number;
    elapsedSeconds: string;
}> {
    const startTime = Date.now();

    await fs.access(sqlitePath);
    const { tables, fieldsByTable } = await loadTablesAndFields(sqlitePath);

    const preparedTables: {
        table: TableRow;
        text: string;
        columnsSummary: string;
    }[] = [];

    let skippedEmptyCount = 0;

    for (const table of tables) {
        const fields = fieldsByTable.get(table.id);
        if (!fields || fields.length === 0) {
            skippedEmptyCount++;
            continue;
        }

        const { text, columnsSummary } = buildTableEmbeddingText(table, fields);
        preparedTables.push({ table, text, columnsSummary });
    }

    if (preparedTables.length === 0) {
        throw new Error("No tables with fields were found in the schema database.");
    }

    callbacks?.onSchemaLoaded?.(preparedTables.length, skippedEmptyCount);

    const texts = preparedTables.map(item => item.text);
    const vectors = await generateEmbeddingsBatch(texts, 64, (completed, total) => {
        callbacks?.onEmbeddingProgress?.(completed, total);
    });

    callbacks?.onWritingDatabase?.();

    const records: VectorTableRecord[] = preparedTables.map((item, idx) => ({
        id: sanitizeText(item.table.id),
        label: sanitizeText(item.table.label) || sanitizeText(item.table.id),
        description: sanitizeText(item.table.description),
        is_custom: Boolean(item.table.is_custom),
        include_name: item.table.include_name === undefined || item.table.include_name === null
            ? true
            : Boolean(item.table.include_name),
        columns_summary: item.columnsSummary,
        text: item.text,
        vector: vectors[idx]
    }));

    // Replace existing vector database if present
    await fs.rm(lancePath, { recursive: true, force: true });

    const vectordb = await lancedb.connect(lancePath);
    await vectordb.createTable(LANCEDB_TABLE_NAME, records, { mode: "overwrite" });

    const elapsedSeconds = ((Date.now() - startTime) / 1000).toFixed(2);

    return {
        indexedCount: records.length,
        skippedEmptyCount,
        elapsedSeconds
    };
}

function startBackgroundRebuild(
    environment: string,
    sqlitePath: string,
    lancePath: string
): RebuildJobState {
    const state: RebuildJobState = {
        status: "in_progress",
        environment,
        phase: "loading_schema",
        startedAt: Date.now(),
        totalTables: 0,
        processedTables: 0,
        skippedEmptyCount: 0
    };

    rebuildStates.set(environment, state);

    void rebuildVectorDatabaseForPaths(sqlitePath, lancePath, {
        onSchemaLoaded: (totalTables, skippedEmptyCount) => {
            state.phase = "generating_embeddings";
            state.totalTables = totalTables;
            state.skippedEmptyCount = skippedEmptyCount;
        },
        onEmbeddingProgress: (processedTables, totalTables) => {
            state.phase = "generating_embeddings";
            state.processedTables = processedTables;
            state.totalTables = totalTables;
        },
        onWritingDatabase: () => {
            state.phase = "writing_database";
        }
    })
        .then(({ indexedCount, skippedEmptyCount }) => {
            state.status = "completed";
            state.phase = "done";
            state.processedTables = indexedCount;
            state.totalTables = indexedCount;
            state.skippedEmptyCount = skippedEmptyCount;
            state.completedAt = Date.now();
        })
        .catch((error: any) => {
            const rawMessage = error?.message || String(error);
            state.status = "failed";
            state.phase = "error";
            state.error = stripPathsFromError(rawMessage, [sqlitePath, lancePath]);
            state.completedAt = Date.now();
            console.error(`Error rebuilding vector database for '${environment}':`, error);
        });

    return state;
}

export const rebuildVectorDatabaseTool: ToolDefinition = {
    name: "netsuite_rebuild_vector_database",
    description: "Asynchronously builds or replaces the vector database from the active NetSuite environment's schema database for semantic table discovery. Use 'netsuite_rebuild_vector_database_status' to check progress.",
    inputSchema: {
        type: "object",
        properties: {}
    },
    execute: async () => {
        let environment: string;
        try {
            environment = await getActiveEnvironment();
        } catch (error: any) {
            return { content: [{ type: "text", text: `Config Error: ${error.message}` }] };
        }

        const existingState = rebuildStates.get(environment);
        if (existingState && existingState.status === "in_progress") {
            return {
                content: [{
                    type: "text",
                    text: [
                        `A vector database rebuild is already in progress for environment '${environment}'.`,
                        "",
                        formatRebuildStatusMessage(existingState)
                    ].join("\n")
                }]
            };
        }

        const sqlitePath = getSqliteDbPath(environment);
        const lancePath = getLanceDbPath(environment);

        try {
            await fs.access(sqlitePath);
        } catch {
            return {
                content: [{
                    type: "text",
                    text: `Error: Schema database not found for environment '${environment}'.`
                }]
            };
        }

        startBackgroundRebuild(environment, sqlitePath, lancePath);

        return {
            content: [{
                type: "text",
                text: [
                    `Started asynchronous vector database rebuild for environment '${environment}'.`,
                    `Use 'netsuite_rebuild_vector_database_status' to check the progress of the rebuild.`
                ].join("\n")
            }]
        };
    }
};

export const rebuildVectorDatabaseStatusTool: ToolDefinition = {
    name: "netsuite_rebuild_vector_database_status",
    description: "Checks the status and progress of the vector database rebuild for the active NetSuite environment.",
    inputSchema: {
        type: "object",
        properties: {}
    },
    execute: async () => {
        let environment: string;
        try {
            environment = await getActiveEnvironment();
        } catch (error: any) {
            return { content: [{ type: "text", text: `Config Error: ${error.message}` }] };
        }

        const state = rebuildStates.get(environment);
        if (state) {
            return {
                content: [{
                    type: "text",
                    text: formatRebuildStatusMessage(state)
                }]
            };
        }

        const lancePath = getLanceDbPath(environment);
        let dbExists = false;
        try {
            await fs.access(lancePath);
            dbExists = true;
        } catch {
            dbExists = false;
        }

        return {
            content: [{
                type: "text",
                text: [
                    `No vector database rebuild has been started in this session for environment '${environment}'.`,
                    `- Existing vector database available: ${dbExists ? "Yes (ready for 'netsuite_search_tables')" : "No (run 'netsuite_rebuild_vector_database' to create it)"}`
                ].join("\n")
            }]
        };
    }
};
