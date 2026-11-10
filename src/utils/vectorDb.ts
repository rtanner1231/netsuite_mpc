import path from "path";
import { pipeline } from "@xenova/transformers";
import { MCP_DIR } from "./config.js";

export const LANCEDB_TABLE_NAME = "tables";
const EMBEDDING_MODEL = "Xenova/all-MiniLM-L6-v2";
const MAX_EMBEDDING_CHARS = 1500;
const MAX_TOKEN_LENGTH = 256;

const CUSTOM_FIELD_REGEX = /^(custbody|custcol|custentity|custevent|custitem|custrecord|custpage|cseg)/i;

export interface TableRow {
    id: string;
    label: string | null;
    description: string | null;
    is_custom?: number | null;
    include_name?: number | null;
}

export interface TableFieldRow {
    tableid: string;
    id: string;
    label: string | null;
    description: string | null;
    joins?: string | null;
    fieldtype?: string | null;
}

export interface VectorTableRecord {
    id: string;
    label: string;
    description: string;
    is_custom: boolean;
    include_name: boolean;
    columns_summary: string;
    text: string;
    vector: number[];
    [key: string]: unknown;
}

let extractorPromise: Promise<any> | null = null;

export function getSqliteDbPath(environment: string): string {
    return path.join(MCP_DIR, `${environment}.db`);
}

export function getLanceDbPath(environment: string): string {
    return path.join(MCP_DIR, `${environment}.lance`);
}

export async function getExtractor(): Promise<any> {
    if (!extractorPromise) {
        extractorPromise = pipeline("feature-extraction", EMBEDDING_MODEL).then((ext: any) => {
            if (ext?.tokenizer) {
                ext.tokenizer.model_max_length = MAX_TOKEN_LENGTH;
            }
            return ext;
        });
    }
    return extractorPromise;
}

export function sanitizeText(value: string | null | undefined): string {
    if (!value) return "";
    return value.replace(/\s+/g, " ").trim();
}

export function isCustomField(fieldId: string): boolean {
    return CUSTOM_FIELD_REGEX.test(fieldId);
}

/**
 * Orders standard columns first, followed by custom columns (custbody, custrecord, etc.),
 * preserving relative order within each group.
 */
export function sortTableFields<T extends { id: string }>(fields: T[]): T[] {
    const standardFields: T[] = [];
    const customFields: T[] = [];

    for (const field of fields) {
        if (isCustomField(field.id)) {
            customFields.push(field);
        } else {
            standardFields.push(field);
        }
    }

    return [...standardFields, ...customFields];
}

export function formatColumnForEmbedding(field: TableFieldRow): string {
    const fieldId = sanitizeText(field.id) || "unknown_id";
    const fieldLabel = sanitizeText(field.label) || fieldId;
    const fieldDesc = sanitizeText(field.description);

    if (fieldDesc) {
        return `${fieldId} (${fieldLabel}: ${fieldDesc})`;
    }
    return `${fieldId} (${fieldLabel})`;
}

export function buildTableEmbeddingText(table: TableRow, fields: TableFieldRow[]): {
    text: string;
    columnsSummary: string;
} {
    const tableId = sanitizeText(table.id);
    const tableLabel = sanitizeText(table.label) || tableId;
    const tableDesc = sanitizeText(table.description);

    const sortedFields = sortTableFields(fields);
    const formattedColumns = sortedFields.map(formatColumnForEmbedding);
    const columnsSummary = formattedColumns.join(", ");

    const text = [
        `Table: ${tableId} (${tableLabel})`,
        `Description: ${tableDesc}`,
        `Columns: ${columnsSummary}`
    ].join("\n");

    return { text, columnsSummary };
}

export async function generateEmbedding(text: string): Promise<number[]> {
    const extractor = await getExtractor();
    const truncated = text.length > MAX_EMBEDDING_CHARS ? text.slice(0, MAX_EMBEDDING_CHARS) : text;
    const output = await extractor(truncated, { pooling: "mean", normalize: true });
    return Array.from(output.data as Float32Array);
}

export async function generateEmbeddingsBatch(
    texts: string[],
    batchSize = 32,
    onProgress?: (completed: number, total: number) => void
): Promise<number[][]> {
    if (texts.length === 0) return [];
    const extractor = await getExtractor();

    // Sort by truncated text length to minimize padding overhead within each batch,
    // then map results back to their original indices.
    const indexed = texts
        .map((text, index) => ({
            index,
            text: text.length > MAX_EMBEDDING_CHARS ? text.slice(0, MAX_EMBEDDING_CHARS) : text
        }))
        .sort((a, b) => a.text.length - b.text.length);

    const allEmbeddings: number[][] = new Array(texts.length);
    let completed = 0;

    for (let i = 0; i < indexed.length; i += batchSize) {
        // Yield to the event loop between batches so incoming stdio MCP requests can be processed
        await new Promise<void>(resolve => setImmediate(resolve));

        const batch = indexed.slice(i, i + batchSize);
        const batchTexts = batch.map(item => item.text);
        const output = await extractor(batchTexts, { pooling: "mean", normalize: true });
        const data = output.data as Float32Array;
        const dim = output.dims[output.dims.length - 1];

        for (let j = 0; j < batch.length; j++) {
            const start = j * dim;
            const end = start + dim;
            allEmbeddings[batch[j].index] = Array.from(data.subarray(start, end));
        }

        completed += batch.length;
        if (onProgress) {
            onProgress(completed, indexed.length);
        }
    }

    return allEmbeddings;
}
