# Rebuild Vector Database (`netsuite_rebuild_vector_database`)

[← Back to Tools Overview](../tools-overview.md)

## Description & Usage

`netsuite_rebuild_vector_database` asynchronously builds (or replaces) the active NetSuite environment's local LanceDB vector database (`<Environment>.lance`) from its SQLite schema database (`<Environment>.db`), or checks the status and progress of an active/previous rebuild when `statusOnly: true` is passed.

Because indexing hundreds or thousands of NetSuite tables and custom records into vector embeddings can take 10–60 seconds depending on hardware, the rebuild runs as a non-blocking background job inside the MCP server process.

### When to Use It
- **After initial setup or schema refresh:** Whenever you generate a new `<Environment>.db` file or update custom records using `MCPSchemaLoad.html`.
- **After creating new Custom Record Types via SDF:** After deploying new custom records with [`netsuite_upsert_custom_record_type`](./netsuite_upsert_custom_record_type.md) and updating `<Environment>.db`, rebuild the vector database so [`netsuite_search_tables`](./netsuite_search_tables.md) can discover them semantically.
- **Polling rebuild progress:** Call with `statusOnly: true` to check the current phase (`Loading schema tables and fields`, `Generating table embeddings`, `Writing vector database`, `Completed`, or `Failed`), indexed table count, and elapsed time.

*(Note: By default, `netsuite_rebuild_vector_database` is listed in `disabledTools` at session startup so it does not clutter everyday queries. You can trigger a rebuild at any time from the Settings UI via `/open-settings`, or unlock this tool in chat via [`netsuite_manage_toolsets`](./netsuite_manage_toolsets.md) with `action: "activate", tools: ["netsuite_rebuild_vector_database"]`.)*

### Input Parameters

| Parameter | Type | Required | Description |
| :--- | :--- | :---: | :--- |
| `statusOnly` | `boolean` | No | If `true`, checks and returns the current vector database rebuild progress (or whether `<Environment>.lance` already exists on disk) without starting a new rebuild. Defaults to `false`. |

---

## Complementary Tools

- **[Search Tables (`netsuite_search_tables`)](./netsuite_search_tables.md):** Queries the `<Environment>.lance` vector database created by `netsuite_rebuild_vector_database`.
- **[Open Settings (`netsuite_open_settings`)](./netsuite_open_settings.md):** The Settings Web UI includes a visual **Build / Rebuild Vector Database (.lance)** button that shares the exact same background job state and shows a live progress bar.
- **[Manage Toolsets (`netsuite_manage_toolsets`)](./netsuite_manage_toolsets.md):** Activate `netsuite_rebuild_vector_database` on-demand if it is disabled at startup in your profile.

---

## Tool Metadata

| Property | Value |
| :--- | :--- |
| **Tool ID** | `netsuite_rebuild_vector_database` |
| **Human-Readable Name** | Rebuild Vector Database |
| **Category** | `table_discovery` (Table & Schema Discovery) |
| **Destructive (`isDestructive`)** | `false` |
| **Requires SDF (`requiresSdf`)** | `false` |
| **Default Availability** | Disabled at startup by default (`DEFAULT_DISABLED_TOOLS`); available on-demand via `netsuite_manage_toolsets` or the Settings UI |

---

## Inner Workings

1. **Per-Environment Job State Tracking (`rebuildStates`):**
   - Maintains an in-memory `Map<string, RebuildJobState>` keyed by environment name (`status`, `phase`, `startedAt`, `completedAt`, `totalTables`, `processedTables`, `skippedEmptyCount`, `error`).
   - This map is shared between `netsuite_rebuild_vector_database`, `netsuite_search_tables`, and the Settings Web UI (`/api/db-status` and `/api/rebuild-vector-db`).
   - If `statusOnly: true` is passed, it formats the active/completed job state (or checks `fs.access` on `<Environment>.lance` if no job has run in the current session) and returns immediately.
   - If a rebuild is already `in_progress` for the active environment, calling `netsuite_rebuild_vector_database` again is idempotent: it returns the current progress instead of starting a duplicate job.

2. **Phase 1 — Loading & Structuring Schema Metadata (`loading_schema`):**
   - Verifies `<MCP_DIR>/<Environment>.db` exists and opens it in read-only mode.
   - Loads all rows from `tables` (`id, label, description, is_custom, include_name`) and `tablefields` (`tableid, id, label, description, fieldtype`), grouping fields by `tableid`.
   - Any table with 0 fields in `tablefields` is skipped and counted in `skippedEmptyCount`.
   - For each remaining table, `buildTableEmbeddingText` (`src/utils/vectorDb.ts`) builds the document text to embed:
     - **Standard-First Field Ordering (`sortTableFields`):** Sorts all standard NetSuite columns ahead of custom fields (`custbody_*`, `custcol_*`, `custentity_*`, `custevent_*`, `custitem_*`, `custrecord_*`, `custpage_*`, `cseg_*`) so core table semantics always appear within the 1,500-character / 256-token embedding window.
     - Formats each column as `<id> (<label>: <description>)` or `<id> (<label>)` and joins them into:
       ```text
       Table: <id> (<label>)
       Description: <description>
       Columns: <columnsSummary>
       ```

3. **Phase 2 — Batched Local Embedding Generation (`generating_embeddings`):**
   - Calls `generateEmbeddingsBatch(texts, 64, onProgress)` using the local `@xenova/transformers` `Xenova/all-MiniLM-L6-v2` pipeline.
   - **Length-Sorted Batching Optimization:** Truncates texts to `MAX_EMBEDDING_CHARS = 1500` and sorts the texts by length before chunking into batches of 64. Grouping similarly sized texts together minimizes transformer token-padding overhead within each batch, significantly accelerating CPU inference, and then maps the resulting 384-dimensional vectors back to their original table indices.
   - **Event-Loop Yielding:** Between every batch, the loop awaits `new Promise(resolve => setImmediate(resolve))` so incoming MCP `stdio` requests (such as `statusOnly: true` polls) and Settings UI HTTP requests remain responsive during the rebuild.

4. **Phase 3 — Writing the LanceDB Table (`writing_database` & `done`):**
   - Removes any existing `<MCP_DIR>/<Environment>.lance` directory (`fs.rm(lancePath, { recursive: true, force: true })`).
   - Connects to LanceDB (`lancedb.connect(lancePath)`) and creates the `"tables"` table (`vectordb.createTable("tables", records, { mode: "overwrite" })`).
   - If any error occurs, `stripPathsFromError` redacts local filesystem paths from the error string before storing it on `state.error`.
