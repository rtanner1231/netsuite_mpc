# View Saved Search (`netsuite_view_saved_search`)

[← Back to Tools Overview](../tools-overview.md)

## Description & Usage

`netsuite_view_saved_search` inspects and previews an existing NetSuite **Saved Search** (`customsearch_*` or numeric internal ID), OR searches and lists existing Saved Searches in NetSuite via the `N/search` module in the MCP Services RESTlet (`rl_mcp_services.js`).

### Two Operating Modes

1. **Inspect & Preview a Specific Saved Search (`scriptId` provided):**
   - Pass `scriptId` (e.g., `'customsearch_open_orders'` or a numeric internal ID like `'145'`) to load the saved search's complete definition (`searchType`, `title`, `scriptId`, `savedSearchId`, `searchResultsUrl`, `isPublic`, `columns`, `filters`, `filterExpression`, `settings`) along with `totalMatchCount` and the first `maxRows` preview rows (default `25`; pass `maxRows: 0` to retrieve only the definition without executing the search).
   - The returned `columns`, `filters`, `filterExpression`, and `settings` are structured in the **exact JSON format** accepted by [`netsuite_create_saved_search`](./netsuite_create_saved_search.md).
2. **Search / List Existing Saved Searches (`scriptId` omitted):**
   - Omit `scriptId` and pass an optional `searchTerm` (matches title, script ID, internal ID, or record type) and/or `recordType` filter to discover existing saved searches in the account.

### Input Parameters

| Parameter | Type | Required | Description |
| :--- | :--- | :---: | :--- |
| `scriptId` | `string` | No | Script ID (e.g., `'customsearch_open_orders'`; auto-prefixed with `'customsearch_'` if non-numeric) or numeric internal ID of the saved search to inspect. Omit to run in list/search mode. |
| `searchTerm` | `string` | No | *(List mode — when `scriptId` is omitted)* Case-insensitive partial search term to filter saved searches by title or script ID. |
| `recordType` | `string` | No | When listing saved searches (`scriptId` omitted), filters by target record type (e.g., `'transaction'`, `'salesorder'`, `'customer'`). When loading a specific search (`scriptId` provided), acts as an optional `N/search` record type hint. |
| `maxRows` | `number` | No | *(View mode — when `scriptId` is provided)* Maximum number of preview rows to execute and return (`0` to `1000`, default: `25`). Pass `0` to fetch only the search definition without running it. |
| `limit` | `number` | No | *(List mode — when `scriptId` is omitted)* Maximum number of matching saved searches to return (`1` to `500`, default: `50`). |

---

## Complementary Tools

- **[Create Saved Search (`netsuite_create_saved_search`)](./netsuite_create_saved_search.md):** Before updating an existing saved search in a new chat session, always call `netsuite_view_saved_search` to load its current `columns`, `filters`/`filterExpression`, and `settings`, modify them as needed, dry-run the change, and save with `overwrite: true`.
- **[Render Advanced PDF Template (`netsuite_render_advanced_pdf_template`)](./netsuite_render_advanced_pdf_template.md) & [Upsert Advanced PDF Template (`netsuite_upsert_advanced_pdf_template`)](./netsuite_upsert_advanced_pdf_template.md):** Advanced PDF templates with `printtype: "SEARCH"` bind a saved search (`savedsearch` / `searchId`) to the FreeMarker `${results}` list.
- **[Manage Toolsets (`netsuite_manage_toolsets`)](./netsuite_manage_toolsets.md):** Activate the `report_creation` category (or `tools: ["netsuite_view_saved_search"]`) on-demand when needed.

---

## Tool Metadata

| Property | Value |
| :--- | :--- |
| **Tool ID** | `netsuite_view_saved_search` |
| **Human-Readable Name** | View Saved Search |
| **Category** | `report_creation` (Report Creation — Saved Searches & Datasets) |
| **Destructive (`isDestructive`)** | `false` |
| **Requires SDF (`requiresSdf`)** | `false` |
| **Default Availability** | On-demand via `netsuite_manage_toolsets` |

---

## Inner Workings

1. **Script ID Normalization (`normalizeSearchScriptId` in `rl_mcp_services.js`):**
   - If `scriptId` is purely numeric (`/^\d+$/`), it is kept as a numeric internal ID string.
   - If non-numeric and missing the `customsearch_` prefix, `customsearch_` is automatically prepended (`open_orders` -> `customsearch_open_orders`).

2. **Mode 2 — List / Search Mode (`!normalizedScriptId`):**
   - Creates an `N/search` query on `type: "savedsearch"` retrieving `internalid` (sorted `DESC`), `id` (scriptId), `title`, `recordtype`, `owner`, and `public`.
   - **In-Memory Filtering Workaround:** NetSuite's internal `savedsearch` search type throws an `SSS_INVALID_SRCH_OPERATOR` error if you attempt to apply a `contains` filter on `title` or `id` in `N/search`. To work around this platform limitation, the RESTlet fetches pages of 1,000 saved searches via `runPaged({ pageSize: 1000 })` (scanning up to 5,000 searches when a `searchTerm` or `recordType` filter is provided) and performs case-insensitive substring matching in memory against `scriptId`, `internalId`, `title`, `recordType`, and `recordTypeLabel`.
   - Returns up to `limit` matching saved searches with their `savedSearchId`, `scriptId`, `title`, `recordType`, `isPublic`, `owner`, and direct NetSuite UI path (`searchResultsUrl: "/app/common/search/searchresults.nl?searchid=..."`).

3. **Mode 1 — Inspect & Preview Mode (`normalizedScriptId` provided):**
   - Calls `search.load({ id: normalizedScriptId, ...(recordType ? { type: recordType } : {}) })`.
   - Serializes `searchObj.columns` into `columnMeta` objects (`key`, `name`, `join`, `summary`, `formula`, `label`, `sort`, `function`), `searchObj.filters` via `serializeSearchFilters`, `searchObj.filterExpression`, and `searchObj.settings` via `serializeSearchSettings`.
   - If `maxRows > 0` (default `25`, clamped to `1000`):
     - Attempts `searchObj.runPaged()` to obtain the exact `totalMatchCount` (`pagedData.count`).
     - Executes `searchObj.run().getRange({ start: 0, end: maxRows })`.
     - For every result row and every column, calls both `res.getValue(col)` and `res.getText(col)`. If a list/record field has a display text (`txt`) that differs from its raw value (`val`), it formats the cell as `{ value: val, text: txt }` so the caller sees both the internal ID and the human-readable name.
