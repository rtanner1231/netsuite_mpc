# View Dataset (`netsuite_view_dataset`)

[← Back to Tools Overview](../tools-overview.md)

## Description & Usage

`netsuite_view_dataset` inspects and previews an existing NetSuite **SuiteAnalytics Dataset** (`custdataset_*`), OR searches and lists existing SuiteAnalytics Datasets in NetSuite via the `N/dataset` and `N/query` modules in the MCP Services RESTlet (`rl_mcp_services.js`).

### Two Operating Modes

1. **Inspect & Preview a Specific Dataset (`scriptId` provided):**
   - Pass `scriptId` (e.g., `'custdataset_open_orders'` or an auto-generated ID like `'custdataset65'`) to load the dataset's complete definition (`datasetType`, `name`, `description`, `scriptId`, `datasetUrl`, `columns` with multi-hop `join` arrays and `formula`s, `condition` tree, and NetSuite-generated SuiteQL `generatedSuiteQL`) and preview its first `maxRows` result rows (default `25`; pass `maxRows: 0` to retrieve only the definition and `generatedSuiteQL` without executing the dataset).
   - The returned `columns` and `condition` match the **exact JSON format** accepted by [`netsuite_create_dataset`](./netsuite_create_dataset.md).
2. **Search / List Existing Datasets (`scriptId` omitted):**
   - Omit `scriptId` and pass an optional `searchTerm` (matches dataset name, script ID, or description) to list matching SuiteAnalytics Datasets in NetSuite.

### Input Parameters

| Parameter | Type | Required | Description |
| :--- | :--- | :---: | :--- |
| `scriptId` | `string` | No | Script ID of the SuiteAnalytics Dataset to load (e.g., `'custdataset_open_orders'` or `'custdataset65'`; auto-prefixed with `'custdataset_'` if omitted). Omit to run in list/search mode. |
| `searchTerm` | `string` | No | *(List mode — when `scriptId` is omitted)* Case-insensitive partial search term to filter datasets by name, script ID, or description. |
| `maxRows` | `number` | No | *(View mode — when `scriptId` is provided)* Maximum number of preview rows to execute and return (`0` to `1000`, default: `25`). Pass `0` to fetch only the definition and `generatedSuiteQL`. |
| `limit` | `number` | No | *(List mode — when `scriptId` is omitted)* Maximum number of matching datasets to return (`1` to `500`, default: `50`). |

---

## Complementary Tools

- **[Create Dataset (`netsuite_create_dataset`)](./netsuite_create_dataset.md):** Call `netsuite_view_dataset` before updating an existing dataset so you can inspect its current `columns` and `condition` tree, modify them, dry-run the update, and save with `overwrite: true`.
- **[Run SuiteQL (`netsuite_run_suite_ql`)](./netsuite_run_suite_ql.md):** `netsuite_view_dataset` returns the exact `generatedSuiteQL` query string that NetSuite generates for the dataset, which can be adapted and executed directly in `netsuite_run_suite_ql`.
- **[Search Tables (`netsuite_search_tables`)](./netsuite_search_tables.md), [Get Fields (`netsuite_get_fields`)](./netsuite_get_fields.md) & [Get Related Tables (`netsuite_get_related_tables`)](./netsuite_get_related_tables.md):** Explore additional tables, fields, and join hops in the local SQLite database to add to a dataset.

---

## Tool Metadata

| Property | Value |
| :--- | :--- |
| **Tool ID** | `netsuite_view_dataset` |
| **Human-Readable Name** | View Dataset |
| **Category** | `report_creation` (Report Creation — Saved Searches & Datasets) |
| **Destructive (`isDestructive`)** | `false` |
| **Requires SDF (`requiresSdf`)** | `false` |
| **Default Availability** | On-demand via `netsuite_manage_toolsets` |

---

## Inner Workings

1. **Script ID Normalization (`normalizeDatasetScriptId` in `rl_mcp_services.js`):**
   - Preserves both custom underscore-prefixed dataset IDs (`custdataset_my_report`) and NetSuite UI auto-generated dataset IDs (`custdataset65`), and translates common mistakes like `customdataset_foo` -> `custdataset_foo`.

2. **Mode 2 — List / Search Mode (`!normalizedScriptId`):**
   - Calls `dataset.list()` to retrieve all SuiteAnalytics Datasets visible to the role.
   - Filters in memory by `searchTerm` (matching `scriptId`, `name`, or `description` case-insensitively), slices to `limit` (default `50`, max `500`), and attaches the direct SuiteAnalytics Workbook UI path (`datasetUrl: "/app/Workbook/Dataset.nl?id=<scriptId>"`).

3. **Mode 1 — Inspect & Preview Mode (`normalizedScriptId` provided):**
   - Calls `dataset.load({ id: normalizedScriptId })`.
   - **Resolving Real Dataset Name & Description (`lookupExistingDatasetMetadata`):**
     - In NetSuite's `N/dataset` Rhino runtime, `dataset.load({ id }).name` returns the literal placeholder string `"SuiteScript dataset"` instead of the dataset's actual saved name, and `.description` can return an internal Java Lambda reference (`com.netsuite.analytics...$$Lambda...`).
     - To return the true user-authored `name` and `description`, `lookupExistingDatasetMetadata` cross-references `dataset.list()`, `query.load({ id }).name`, and `dataset.describe({ id })`, filtering out `"SuiteScript dataset"` and `$$Lambda` strings.
   - **Join Chain Extraction & Target Inference (`extractHopsFromDatasetJoin`):**
     - Walks each column's nested `col.join` chain (`curr = curr.join`) up to 15 hops, extracting `{ fieldId, source, target }`.
     - Also filters out NetSuite's `"<Missing Translation>"` placeholder on column labels (`isValidDatasetColumnLabel`).
   - **SuiteQL Generation (`tryGenerateDatasetSuiteQL`):**
     - Calls `query.load({ id: resolvedScriptId }).toSuiteQL()` (falling back to an in-memory `N/query` mirror via `buildMirrorQueryFromDataset(datasetObj).toSuiteQL()`) to return the exact SQL (`generatedSuiteQL`) and bind parameters (`generatedSuiteQLParams`).
   - **Preview Execution with Automatic `N/query` Fallback:**
     - If `maxRows > 0`, executes `datasetObj.runPaged()` to fetch `totalMatchCount` and up to `maxRows` preview rows.
     - If `datasetObj.runPaged()` fails on a multi-hop join chain (a known NetSuite `N/dataset.run()` quirk on certain 2+ hop joins), it automatically falls back to executing the mirrored `N/query` object (`buildMirrorQueryFromDataset(datasetObj)`).
