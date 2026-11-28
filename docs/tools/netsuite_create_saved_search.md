# Create Saved Search (`netsuite_create_saved_search`)

[← Back to Tools Overview](../tools-overview.md)

## Description & Usage

`netsuite_create_saved_search` builds, dry-runs (previews in memory), and saves or updates a NetSuite **Saved Search** (`customsearch_*`) via the `N/search` module in the MCP Services RESTlet (`rl_mcp_services.js`).

### Recommended Dry-Run-First Workflow
1. **If updating an existing search:** Call [`netsuite_view_saved_search`](./netsuite_view_saved_search.md) first to load its current `columns`, `filters`/`filterExpression`, and `settings`.
2. **Dry-Run (`dryRun: true`, the default):** Call `netsuite_create_saved_search` with `dryRun: true` to test the search in memory without saving anything in NetSuite. The tool validates every column, join, filter, operator, and formula, and returns `totalMatchCount` plus the first `maxRows` preview rows.
3. **Save or Update (`dryRun: false`):** Once the preview results look right, call `netsuite_create_saved_search` again with `dryRun: false` and `title` (plus optional `scriptId`, `isPublic`, and `overwrite: true` when updating an existing saved search).

### Important Schema Note (SuiteQL vs. `N/search`)
- **Custom Record & Custom Field IDs** (`customrecord_*`, `custbody_*`, `custcol_*`, `custentity_*`, `custitem_*`, `custrecord_*`) are **identical** in SuiteQL and `N/search`—use [`netsuite_search_tables`](./netsuite_search_tables.md) and [`netsuite_get_fields`](./netsuite_get_fields.md) to discover them.
- **Native Tables & Fields** in `N/search` use NetSuite's **Records Browser** schema (which differs from SuiteQL). For example, on `type: "transaction"`, header vs. line rows are controlled using filters like `mainline` (`"T"` or `"F"`), `taxline` (`"F"`), `shipping` (`"F"`), and `cogs` (`"F"`), and joins are single-hop IDs like `customer`, `item`, `vendor`, `createdFrom`, `applyingTransaction`, or `CUSTRECORD_<FIELD_ID>`.

### Input Parameters

| Parameter | Type | Required | Description |
| :--- | :--- | :---: | :--- |
| `type` | `string` | Yes* | The `N/search` record type (e.g., `'transaction'`, `'salesorder'`, `'invoice'`, `'customer'`, `'item'`, or `'customrecord_...'`). *Optional only when updating an existing search with `overwrite: true` and `scriptId`.* |
| `columns` | `SavedSearchColumnDefinition[]` | Yes* | Array of column objects `{ name, join?, summary?, formula?, label?, sort?, function? }`. `summary` supports `'GROUP'`, `'SUM'`, `'COUNT'`, `'AVG'`, `'MIN'`, `'MAX'`. *Optional when `overwrite: true` (omitting preserves existing columns).* |
| `filters` | `SavedSearchFilterDefinition[]` | No | Array of AND-combined filter objects `{ name, join?, operator, values?, formula?, summary? }`. Mutually exclusive with `filterExpression`. Pass `[]` on `overwrite: true` to clear existing filters. |
| `filterExpression` | `any[]` | No | Nested `N/search` boolean filter expression array supporting `'AND'`, `'OR'`, and `'NOT'` (e.g., `[['mainline', 'is', 'T'], 'AND', [['status', 'anyof', ['SalesOrd:B']], 'OR', ['amount', 'greaterthan', '5000']]]`). Mutually exclusive with `filters`. |
| `settings` | `Array<{ name: string, value: string }>` | No | Search settings array (e.g., `[{ name: 'consolidationtype', value: 'AVERAGE' }]`). |
| `dryRun` | `boolean` | No | Defaults to **`true`**. When `true`, executes the search in-memory without saving and returns `totalMatchCount` and `previewRows`. Set to `false` to save/update in NetSuite. |
| `maxRows` | `number` | No | Maximum number of preview rows to return (`0` to `1000`, default: `25`). |
| `title` | `string` | Conditional | Display title of the Saved Search in NetSuite. Required when `dryRun: false` and creating a new search. |
| `scriptId` | `string` | No | Custom script ID (e.g., `'customsearch_open_high_val_orders'`; auto-prefixed with `'customsearch_'` if omitted) or internal ID when updating an existing search. |
| `isPublic` | `boolean` | No | Whether to make the saved search public when saving (`default: false`). |
| `overwrite` | `boolean` | No | When `true` and `scriptId` matches an existing saved search, loads the existing search and updates only the properties you explicitly pass while preserving omitted properties (`default: false`). |

---

## Complementary Tools

- **[View Saved Search (`netsuite_view_saved_search`)](./netsuite_view_saved_search.md):** Find existing saved searches or inspect a saved search's current definition before updating it with `overwrite: true`.
- **[Load Record Sample (`netsuite_load_record_sample`)](./netsuite_load_record_sample.md):** Inspect native record field IDs on a real record instance when constructing `N/search` columns and filters.
- **[Create Dataset (`netsuite_create_dataset`)](./netsuite_create_dataset.md):** If you need multi-hop joins across 2+ tables or prefer using the exact SuiteAnalytics / Records Catalog schema from your local `.db` database, create a SuiteAnalytics Dataset instead.
- **[Upsert Advanced PDF Template (`netsuite_upsert_advanced_pdf_template`)](./netsuite_upsert_advanced_pdf_template.md) & [Render Advanced PDF Template (`netsuite_render_advanced_pdf_template`)](./netsuite_render_advanced_pdf_template.md):** Saved searches created with this tool can be bound to Advanced PDF templates (`savedsearch` / `searchId`) to print tabular PDF reports.

---

## Tool Metadata

| Property | Value |
| :--- | :--- |
| **Tool ID** | `netsuite_create_saved_search` |
| **Human-Readable Name** | Create Saved Search |
| **Category** | `report_creation` (Report Creation — Saved Searches & Datasets) |
| **Destructive (`isDestructive`)** | **`true`** *(Note: can be whitelisted in `profile.allowedTools` on read-only profiles if desired)* |
| **Requires SDF (`requiresSdf`)** | `false` |
| **Default Availability** | On-demand via `netsuite_manage_toolsets` |

---

## Inner Workings

1. **Up-Front Validation & Per-Column / Per-Filter Diagnostics (`handleCreateSavedSearch` in `rl_mcp_services.js`):**
   - Verifies that `type` and `columns` are provided (unless `overwrite: true` and `scriptId` are passed), that `filters` and `filterExpression` are not both non-empty at the same time, and that `title` is present when `dryRun: false` and creating a new search.
   - Builds each `search.Column` one by one inside a `try/catch` block (`search.createColumn(...)`), resolving `summary` (`resolveSearchSummary`, including aliases like `AVERAGE` -> `AVG`) and `sort` (`resolveSearchSort`). If NetSuite rejects an invalid field or join ID on column index `i`, the RESTlet immediately pinpoints the exact offending column (`Invalid search column at index 2 ("customer.invalid_field"): ...`).
   - Similarly builds each `search.Filter` (`search.createFilter(...)`) or recursively normalizes `filterExpression` (`normalizeFilterExpression`).
     - **`filterExpression` Array Unwrapping:** In `N/search`, `createFilter` takes `values: ['1', '2']` as an array, whereas `filterExpression` leaf clauses require positional arguments (`['status', 'anyof', 'SalesOrd:B', 'SalesOrd:D']`). `normalizeFilterExpression` automatically detects if a caller passed an array in the 3rd position of a leaf clause (`['status', 'anyof', ['SalesOrd:B', 'SalesOrd:D']]`) and spreads it into positional elements so both styles work seamlessly.

2. **Create vs. Overwrite (`search.create` vs. `search.load`):**
   - If `overwrite: true` and `scriptId` is provided, calls `search.load({ id: normalizedScriptId })`. Only properties explicitly included in the request (`columns`, `filters`/`filterExpression`, `settings`) replace the loaded search's properties; omitted properties are preserved. Passing `filters: []` or `filterExpression: []` explicitly clears existing filters.
   - Otherwise calls `search.create({ type, columns, filters, settings })`.
     - **NetSuite `search.create` Quirk Handling:** `N/search.create` silently ignores a `filterExpression` key in its options object (expecting the expression array under the `filters` option key instead). The RESTlet passes `filterExpression` via `createOptions.filters` **and** assigns `searchObj.filterExpression = filterExpression` directly after creation to guarantee it is applied.

3. **In-Memory Preview Execution (`runPaged` & `getRange`):**
   - Whether `dryRun` is `true` or `false`, the RESTlet always executes a preview first so invalid field combinations or formula syntax errors are caught before saving.
   - Calls `searchObj.runPaged()` to compute `totalMatchCount`, then fetches `searchObj.run().getRange({ start: 0, end: maxRows })`, extracting both `getValue(col)` and `getText(col)` for every cell.

4. **Conditional Persistence (`dryRun: false`):**
   - If `dryRun` is `true`, returns the preview rows, `totalMatchCount`, and serialized definition without touching the NetSuite database (`operation: "dry_run"`).
   - If `dryRun` is `false`, assigns `searchObj.title`, `searchObj.id` (for non-numeric `customsearch_*` script IDs), and `searchObj.isPublic`, calls `savedSearchId = searchObj.save()`, and returns `savedSearchId`, `scriptId`, and `searchResultsUrl` (`/app/common/search/searchresults.nl?searchid=<savedSearchId>`).
