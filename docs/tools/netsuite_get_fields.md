# Get Fields (`netsuite_get_fields`)

[← Back to Tools Overview](../tools-overview.md)

## Description & Usage

`netsuite_get_fields` retrieves table-level metadata (`label`, `description`, `is_custom`, `include_name`) and complete field definitions (`id`, `fieldtype`, `label`, `description`, and outgoing `joins` with `joinPairs`) for a specific NetSuite table (`table_id`) from the active environment's local SQLite schema database (`<Environment>.db`).

If the local SQLite database is missing, if `table_id` has no rows in the local database (for example, a brand-new custom record created after the last schema export), or if `useFallback: true` is passed, the tool automatically falls back to querying the live **NetSuite REST Web Services Metadata Catalog API** (`/services/rest/record/v1/metadata-catalog`).

### When to Use It
- **Before writing SuiteQL queries (`netsuite_run_suite_ql`):** Always verify exact column IDs and join keys on a table before constructing a `SELECT`, `WHERE`, or `JOIN` clause to avoid guessing non-existent column names.
- **Before building SuiteAnalytics Datasets (`netsuite_create_dataset`):** SuiteAnalytics Datasets use the exact same Records Catalog field IDs and join IDs stored in `<Environment>.db`.
- **Inspecting newly deployed custom records:** Pass `useFallback: true` (or just query a newly created `customrecord_*` ID not yet in `<Environment>.db`) to fetch its live field list via the REST Metadata API.

### Input Parameters

| Parameter | Type | Required | Description |
| :--- | :--- | :---: | :--- |
| `table_id` | `string` | **Yes** | Internal ID of the NetSuite table or custom record type (e.g., `'transaction'`, `'transactionline'`, `'customer'`, `'item'`, or `'customrecord_...'`). |
| `useFallback` | `boolean` | No | If `true`, skips querying the local `<Environment>.db` SQLite database and directly queries the live NetSuite REST Metadata API. Defaults to `false`. |

---

## Complementary Tools

- **[Search Tables (`netsuite_search_tables`)](./netsuite_search_tables.md):** Use first to discover the right `table_id` via semantic search before calling `netsuite_get_fields`.
- **[Get Related Tables (`netsuite_get_related_tables`)](./netsuite_get_related_tables.md):** While `netsuite_get_fields` shows the immediate outgoing joins on each field of a single table, `netsuite_get_related_tables` traverses those joins up to 5 hops deep to map multi-table join paths.
- **[Run SuiteQL (`netsuite_run_suite_ql`)](./netsuite_run_suite_ql.md):** Execute SuiteQL queries using the field IDs and join pairs returned by `netsuite_get_fields`.
- **[Create Dataset (`netsuite_create_dataset`)](./netsuite_create_dataset.md):** Build SuiteAnalytics Datasets using the `fieldId` and `join` definitions from `netsuite_get_fields`.
- **[Load Record Sample (`netsuite_load_record_sample`)](./netsuite_load_record_sample.md):** Inspect real field values and `N/record` / `N/search` body and sublist structures on an actual record instance in NetSuite.

---

## Tool Metadata

| Property | Value |
| :--- | :--- |
| **Tool ID** | `netsuite_get_fields` |
| **Human-Readable Name** | Get Fields |
| **Category** | `table_discovery` (Table & Schema Discovery) |
| **Destructive (`isDestructive`)** | `false` |
| **Requires SDF (`requiresSdf`)** | `false` |
| **Default Availability** | Enabled at startup by default |

---

## Inner Workings

1. **Primary Lookup — Local SQLite Schema Database (`<Environment>.db`):**
   - Resolves the active environment from `state.json` and locates `<MCP_DIR>/<Environment>.db`.
   - Unless `useFallback === true`, opens `<Environment>.db` in read-only mode (`sqlite3.OPEN_READONLY`) and executes two parameterized SQL queries:
     1. `SELECT id, label, description, is_custom, include_name FROM tables WHERE id = ?`
     2. `SELECT id, label, description, joins, fieldtype FROM tablefields WHERE tableid = ?`
   - Ensures the SQLite connection is closed in a `finally` block.
   - If `rows` is non-empty, formats the output (`formatDbFields`):
     - Prints the table header (`Table Label`, `Table Description`, `Custom Record: Yes/No`, and `Include Name Field: Yes/No`).
     - Iterates over each field row, printing `- <id> [Type: <fieldtype>] (<label>) - <description>`.
     - Parses the JSON `joins` column (if present) and prints each outgoing join target (`Join: <id> (<label>)`) along with its join condition pairs (`Pair: <id> [<label>]`).

2. **Automatic Fallback — NetSuite REST Metadata Catalog API:**
   - If `useFallback === true`, if `<Environment>.db` does not exist on disk, or if the local query returned 0 field rows, `fallbackTriggered` becomes `true`.
   - Calls `fetchNetsuiteMetadata(table_id)` (`src/utils/api.ts`), which:
     - Formats `accountId` to lowercase with underscores replaced by hyphens (`1234567_SB1` -> `1234567-sb1`).
     - Signs an OAuth 1.0a (`HMAC-SHA256`) `GET` request to:
       ```text
       https://<accountId>.suitetalk.api.netsuite.com/services/rest/record/v1/metadata-catalog?select=<table_id>
       ```
       with `Accept: application/swagger+json`.
   - Parses the OpenAPI/Swagger JSON response (`extractNetsuiteFields`) by reading `parsedData.components.schemas[table_id].properties` and mapping each property into `{ id, fieldType, label }`.
   - If neither the local database nor the Metadata Catalog API contains the table, returns a clear error message.
