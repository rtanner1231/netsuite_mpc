# Get Related Tables (`netsuite_get_related_tables`)

[← Back to Tools Overview](../tools-overview.md)

## Description & Usage

`netsuite_get_related_tables` builds a multi-hop relationship map starting from a given NetSuite table (`table_id`) by performing a Breadth-First Search (BFS) traversal across outgoing field joins in the local SQLite schema database (`<Environment>.db`).

It groups discovered tables by hop depth (`Depth 1` through `max_depth`, from 1 to 5 hops, default `2`), shows which intermediate table each deeper table was reached through (`[from <viaTable>]`), and outputs the exact SuiteQL join condition(s) (e.g., `transaction.entity = customer.id` or `transaction.id = transactionline.transaction`).

### When to Use It
- **Constructing multi-table SuiteQL `JOIN` queries (`netsuite_run_suite_ql`):** Quickly discover the exact foreign-key join columns between tables (including many-to-many map tables where `source.id = target.mapone` and `target.maptwo = dest.id`).
- **Constructing multi-hop joins in SuiteAnalytics Datasets (`netsuite_create_dataset`):** Identify forward join field names across 1 to 5 hops from your base record type.
- **Exploring unfamiliar custom record schemas:** See every native record, custom record (`customrecord_*`), and custom list (`customlist_*`) linked to a table.

### Input Parameters

| Parameter | Type | Required | Description |
| :--- | :--- | :---: | :--- |
| `table_id` | `string` | **Yes** | Internal ID of the starting NetSuite table (e.g., `'transaction'`, `'customer'`, or `'customrecord_...'`). Case-insensitive. |
| `max_depth` | `number` | No | Maximum number of join hops to traverse from the starting table (`1` to `5`, default: `2`). |
| `include_custom_lists` | `boolean` | No | Whether to include Custom List lookup tables (`customlist_*`) in the output. Defaults to `true`. |
| `include_polymorphic_subtypes` | `boolean` | No | Whether to expand polymorphic join fields into all subtype tables (e.g., expanding all 87 transaction subtypes instead of collapsing to the primary `'transaction'` target). Defaults to `false`. |

---

## Complementary Tools

- **[Search Tables (`netsuite_search_tables`)](./netsuite_search_tables.md):** Find the starting `table_id` via semantic search before mapping its related tables.
- **[Get Fields (`netsuite_get_fields`)](./netsuite_get_fields.md):** Inspect all columns on any related table discovered by `netsuite_get_related_tables`.
- **[Run SuiteQL (`netsuite_run_suite_ql`)](./netsuite_run_suite_ql.md):** Copy the `via: <source>.<field> = <target>.<col>` conditions directly into your SuiteQL `JOIN ... ON ...` clauses.
- **[Create Dataset (`netsuite_create_dataset`)](./netsuite_create_dataset.md):** Use the discovered join fields to build single-hop or multi-hop `join` paths on SuiteAnalytics Dataset columns and conditions.

---

## Tool Metadata

| Property | Value |
| :--- | :--- |
| **Tool ID** | `netsuite_get_related_tables` |
| **Human-Readable Name** | Get Related Tables |
| **Category** | `table_discovery` (Table & Schema Discovery) |
| **Destructive (`isDestructive`)** | `false` |
| **Requires SDF (`requiresSdf`)** | `false` |
| **Default Availability** | Enabled at startup by default |

---

## Inner Workings

1. **Input Normalization & Parameter Clamping:**
   - Normalizes `table_id` to lowercase and clamps `max_depth` to an integer between `1` (`MIN_MAX_DEPTH`) and `5` (`MAX_MAX_DEPTH`), defaulting to `2`.
   - Verifies that `<MCP_DIR>/<Environment>.db` exists on disk and opens it in read-only mode (`sqlite3.OPEN_READONLY`).
   - Checks that the starting table exists in either `tables` or `tablefields`; if not found, returns `null` (which surfaces a table-not-found error).

2. **Breadth-First Search (BFS) Join Traversal (`buildRelatedTablesMap`):**
   - Initializes a `visited` set with the root table ID and sets `currentFrontier = [rootTable.id]`.
   - For each hop `depth` from `1` to `maxDepth` while `currentFrontier` is non-empty:
     - Queries `tablefields` in chunks of 500 table IDs (`SQLITE_CHUNK_SIZE = 500`) for all fields on `currentFrontier` tables where `joins IS NOT NULL AND joins != '' AND joins != '[]'`.
     - Parses the JSON `joins` array on each field:
       - **Polymorphic Subtype Collapse:** In NetSuite's Records Catalog, a polymorphic transaction join field lists `'transaction'` as `parsedJoins[0]` followed by up to 87 transaction subtype tables. When `include_polymorphic_subtypes` is `false` (the default), the tool processes only `[parsedJoins[0]]` so the output remains clean and concise; when `true`, it expands all entries in `parsedJoins`.
       - **Custom List Filtering & Leaf Handling:** If `include_custom_lists` is `false`, any target starting with `customlist` is skipped. Even when `include_custom_lists` is `true`, `customlist_*` tables are treated as leaf nodes (not pushed to `nextFrontier`) since custom lists do not have outgoing table joins.
       - **Join Condition Formatting (`formatJoinCondition`):** Inspects `joinEntry.joinPairs`. If a pair's label already contains `=`, uses it directly; if `pair.id === "mapone"`, formats `${sourceTableId}.id = ${targetTableId}.mapone`; otherwise formats `${sourceTableId}.${fieldId} = ${targetTableId}.${targetCol}` (joining compound keys with ` AND `).
       - **Deduplication:** If `targetId` has not been visited yet, creates a `RelatedTableNode` at the current `depth` and adds `targetId` to `nextFrontier`. If `targetId` was already discovered at the **same** `depth` via the **same** `viaTable` through a different field (e.g., `transaction.createdby` and `transaction.lastmodifiedby` both joining to `employee`), appends the additional join condition to the existing node's `conditions` array.

3. **Metadata Hydration & Output Cap:**
   - Batch-queries the `tables` table (in chunks of 500 IDs) to hydrate human-readable `label` and `isCustom` flags for all discovered table nodes.
   - Formats the output grouped by depth (`Depth 1`, `Depth 2`, etc.) and caps the displayed join conditions per table at 5 (`MAX_CONDITIONS_PER_TABLE = 5`), appending `(+N more)` if a table pair has more than 5 distinct join fields between them.
