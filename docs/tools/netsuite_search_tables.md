# Search Tables (`netsuite_search_tables`)

[← Back to Tools Overview](../tools-overview.md)

## Description & Usage

`netsuite_search_tables` performs a natural-language semantic search against the active NetSuite environment's local LanceDB vector database (`<Environment>.lance`) and returns the **top 5 matching native or custom NetSuite tables**.

Each result includes the table's internal ID (`id`), display label, a `[Custom Record]` badge and `(Include Name: Yes/No)` flag for custom record types, the L2 vector distance score (`[Distance: ...]`), the table's description, and a preview summary of its columns (up to 500 characters).

### When to Use It
- **Starting any SuiteQL query or SuiteAnalytics Dataset task:** When you know the business concept (e.g., *"customer invoices and line items"*, *"inventory lot numbers"*, *"vendor approval custom record"*, or *"script execution logs"*) but do not know the exact NetSuite table or `customrecord_*` internal ID.
- **Finding custom record types (`customrecord_*`):** Because [`netsuite_upsert_custom_record_type`](./netsuite_upsert_custom_record_type.md) requires descriptive `description` and `aiDescription` fields on creation and `MCPSchemaLoad.html` extracts them into `<Environment>.db`, custom records are indexed alongside native tables for semantic search.

### Input Parameters

| Parameter | Type | Required | Description |
| :--- | :--- | :---: | :--- |
| `query` | `string` | **Yes** | Natural-language search query describing the NetSuite table, record type, or business data you are looking for. |

---

## Complementary Tools

- **[Get Fields (`netsuite_get_fields`)](./netsuite_get_fields.md):** Once `netsuite_search_tables` identifies the candidate `table_id` (e.g., `transaction`, `transactionline`, `customrecord_...`), call `netsuite_get_fields` to inspect all of its column IDs, data types, descriptions, and outgoing joins.
- **[Get Related Tables (`netsuite_get_related_tables`)](./netsuite_get_related_tables.md):** Discover how a table returned by `netsuite_search_tables` joins to other tables across 1 to 5 hops.
- **[Rebuild Vector Database (`netsuite_rebuild_vector_database`)](./netsuite_rebuild_vector_database.md):** If `netsuite_search_tables` reports that the vector database is missing or out of date after a schema refresh, run `netsuite_rebuild_vector_database` to build `<Environment>.lance` from `<Environment>.db`.
- **[Run SuiteQL (`netsuite_run_suite_ql`)](./netsuite_run_suite_ql.md) & [Create Dataset (`netsuite_create_dataset`)](./netsuite_create_dataset.md):** Both SuiteQL and SuiteAnalytics Datasets use the exact same Records Catalog table and field IDs discovered by `netsuite_search_tables`.

---

## Tool Metadata

| Property | Value |
| :--- | :--- |
| **Tool ID** | `netsuite_search_tables` |
| **Human-Readable Name** | Search Tables |
| **Category** | `table_discovery` (Table & Schema Discovery) |
| **Destructive (`isDestructive`)** | `false` |
| **Requires SDF (`requiresSdf`)** | `false` |
| **Default Availability** | Enabled at startup by default |

---

## Inner Workings

1. **Input & Active Environment Validation:**
   - Validates that `args.query` is a non-empty string after trimming.
   - Resolves the active environment name from `state.json` via `getActiveEnvironment()` and computes the target LanceDB directory path: `<MCP_DIR>/<Environment>.lance`.

2. **Vector Database Existence & Rebuild Status Check:**
   - Checks whether `<MCP_DIR>/<Environment>.lance` exists on disk via `fs.access`.
   - If the `.lance` directory does not exist, it checks `getRebuildState(environment)` from `rebuildVectorDatabase.ts`:
     - If a background rebuild is currently `in_progress`, it returns an informative message instructing the caller to check progress via `netsuite_rebuild_vector_database` with `statusOnly: true`.
     - Otherwise, it instructs the caller to run `netsuite_rebuild_vector_database` first.

3. **Local Embedding Generation (`Xenova/all-MiniLM-L6-v2`):**
   - Calls `generateEmbedding(query)` (`src/utils/vectorDb.ts`), which lazily initializes a singleton `@xenova/transformers` feature-extraction pipeline using the `Xenova/all-MiniLM-L6-v2` model (`MAX_TOKEN_LENGTH = 256`, `MAX_EMBEDDING_CHARS = 1500`).
   - Truncates the query to at most 1,500 characters and computes a mean-pooled, L2-normalized 384-dimensional float vector completely locally (no external embedding API calls or API keys required).

4. **LanceDB Vector Similarity Search & Formatting:**
   - Connects to the local LanceDB directory (`lancedb.connect(lancePath)`), opens the `"tables"` table, and executes `.vectorSearch(queryVector).limit(5).toArray()`.
   - Formats the top 5 rows into a numbered list displaying:
     - `id` and `label`
     - `[Custom Record]` and `(Include Name: Yes/No)` (critical for knowing whether a custom record table has a `name` column in SuiteQL)
     - `_distance` (formatted to 4 decimal places)
     - `description` and a 500-character preview of `columns_summary` (which orders standard columns first, followed by `cust*` custom columns).
