# Create Dataset (`netsuite_create_dataset`)

[← Back to Tools Overview](../tools-overview.md)

## Description & Usage

`netsuite_create_dataset` builds, dry-runs (previews in memory), and saves or updates a NetSuite **SuiteAnalytics Dataset** (`custdataset_*`) via the `N/dataset` and `N/query` modules in the MCP Services RESTlet (`rl_mcp_services.js`), returning the `totalMatchCount`, the first `maxRows` preview rows, and the NetSuite-generated SuiteQL query (`generatedSuiteQL`).

### 1-to-1 Schema Match with Local Schema Tools
Unlike [`netsuite_create_saved_search`](./netsuite_create_saved_search.md) (which uses NetSuite's legacy `N/search` Records Browser schema), `netsuite_create_dataset` uses NetSuite's **SuiteAnalytics / Records Catalog** data source—the **exact same schema** stored in your local `<Environment>.db` SQLite database! Always use [`netsuite_search_tables`](./netsuite_search_tables.md), [`netsuite_get_fields`](./netsuite_get_fields.md), and [`netsuite_get_related_tables`](./netsuite_get_related_tables.md) to discover exact table IDs, field IDs, and join paths for datasets.

### How Joins Work (`join` property on columns and filters)
- **Forward Joins (`source.fieldId = target.id`):** Pass a field ID string (`join: "transactionlines"`), a dot-separated multi-hop path (`join: "transactionlines.item"`, `join: "transactionlines.accountingimpact"`, `join: "salesrep.department"`), a join object (`{ fieldId: "entity" }`), or an ordered array of hops (`[{ fieldId: "transactionlines" }, { fieldId: "item" }]`).
- **Inverse Joins (Parent-to-Child Custom Records):** When the base table has no direct forward join field to a child custom record, specify `source` (the child table ID) and `fieldId` (the foreign-key field on the child table pointing back to the current table):
  ```json
  { "fieldId": "custrecord_parent_ref", "source": "customrecord_child_lines" }
  ```
- **Polymorphic Joins:** When a field (such as `entity`, `createdby`, or a transaction reference field) can point to multiple record types, specify `target` to select the target table:
  ```json
  { "fieldId": "entity", "target": "customer" }
  ```

### Input Parameters

| Parameter | Type | Required | Description |
| :--- | :--- | :---: | :--- |
| `type` | `string` | Yes* | SuiteAnalytics base record type ID (e.g., `'transaction'`, `'customer'`, `'item'`, or `'customrecord_...'`). *Optional only when updating an existing dataset with `overwrite: true` and `scriptId`.* |
| `columns` | `DatasetColumnDefinition[]` | Yes* | Array of column objects `{ fieldId?, join?, formula?, type?, label?, alias? }`. `fieldId` and `formula` are mutually exclusive; `formula` requires `type` (`'STRING'`, `'INTEGER'`, `'FLOAT'`, `'CURRENCY'`, `'PERCENT'`, `'DATE'`, `'DATETIME'`, `'BOOLEAN'`, etc.). *Optional when `overwrite: true`.* |
| `filters` | `DatasetFilterDefinition[]` | No | Flat array of AND-combined filter objects `{ fieldId?, join?, formula?, type?, columnAlias?, operator, values?, caseSensitive? }`. Mutually exclusive with `condition`. Pass `[]` on `overwrite: true` to clear criteria. |
| `condition` | `DatasetConditionDefinition` | No | Nested boolean condition tree `{ operator: 'AND' | 'OR', children: [...] }` where children are leaf filter objects or nested `AND`/`OR` groups. Mutually exclusive with `filters`. Pass `{}` on `overwrite: true` to clear criteria. |
| `dryRun` | `boolean` | No | Defaults to **`true`**. Executes the dataset in-memory without saving and returns `totalMatchCount`, `previewRows`, and `generatedSuiteQL`. Set to `false` after approval to save/update in NetSuite. |
| `maxRows` | `number` | No | Maximum number of preview rows to return (`0` to `1000`, default: `25`). |
| `name` | `string` | Conditional | Display name of the Dataset in SuiteAnalytics Workbook. Required when `dryRun: false` and creating a new dataset. |
| `description` | `string` | No | Optional description of the Dataset in SuiteAnalytics Workbook. |
| `scriptId` | `string` | No | Custom script ID (e.g., `'custdataset_open_high_val_orders'`; auto-prefixed with `'custdataset_'` if omitted). If omitted on create, NetSuite assigns an ID automatically. |
| `overwrite` | `boolean` | No | When `true` and `scriptId` matches an existing dataset, loads the existing dataset and updates only the properties you explicitly pass while preserving omitted properties (`default: false`). |

---

## Complementary Tools

- **[Search Tables (`netsuite_search_tables`)](./netsuite_search_tables.md), [Get Fields (`netsuite_get_fields`)](./netsuite_get_fields.md) & [Get Related Tables (`netsuite_get_related_tables`)](./netsuite_get_related_tables.md):** Discover the exact SuiteAnalytics record types, field IDs, and multi-hop join relationships from your local SQLite database.
- **[View Dataset (`netsuite_view_dataset`)](./netsuite_view_dataset.md):** Inspect an existing dataset's `columns`, `condition`, and `generatedSuiteQL` before updating it with `overwrite: true`.
- **[Run SuiteQL (`netsuite_run_suite_ql`)](./netsuite_run_suite_ql.md):** Run or customize the `generatedSuiteQL` returned by `netsuite_create_dataset`.

---

## Tool Metadata

| Property | Value |
| :--- | :--- |
| **Tool ID** | `netsuite_create_dataset` |
| **Human-Readable Name** | Create Dataset |
| **Category** | `report_creation` (Report Creation — Saved Searches & Datasets) |
| **Destructive (`isDestructive`)** | **`true`** *(Note: can be whitelisted in `profile.allowedTools` on read-only profiles if desired)* |
| **Requires SDF (`requiresSdf`)** | `false` |
| **Default Availability** | On-demand via `netsuite_manage_toolsets` |

---

## Inner Workings

1. **Join Normalization & Auto-Correction (`normalizeDatasetJoinHops` in `rl_mcp_services.js`):**
   - Converts string dot-paths (`"transactionlines.item"`), single hop objects, or arrays of hop objects into a canonical array of `{ fieldId, source, target }` hops ordered from outermost to innermost.
   - **Auto-Translation of Common Transaction Sublist Mistakes:** If a caller passes an inverse join `{ fieldId: "transaction", source: "transactionline" }` on a `transaction` dataset, the RESTlet automatically translates it to the canonical SuiteAnalytics forward sublist join `{ fieldId: "transactionlines", source: null }` (and translates `{ fieldId: "transactionline", source: "transactionaccountingline" }` to `{ fieldId: "accountingimpact", source: null }`).
   - **Automatic Polymorphic Target Inference (`DEFAULT_POLYMORPHIC_JOIN_TARGETS` & `inferOuterHopTargetsFromChildHops`):** If a caller uses dot-notation on a polymorphic field without an explicit `target` (e.g., `join: "transactionlines.item"` or `join: "entity"`), or chains a custom field into `.transactionlines`, the RESTlet automatically infers the required `target` (`"item"`, `"entity"`, or `"transaction"`).
   - Builds and caches nested `dataset.createJoin` objects from outermost to innermost (`buildDatasetJoinFromHops`).

2. **Operator, Relative Date & ISO Date Normalization:**
   - `resolveDatasetOperator` accepts both `N/query.Operator` names (`ANY_OF`, `EQUAL`, `EMPTY_NOT`, `GREATER_OR_EQUAL`) and `N/search`/SQL aliases (`anyof`, `noneof`, `isempty`, `isnotempty`, `>=`, `like`, `in`) and maps them to `N/query.Operator`.
   - `normalizeDatasetConditionValues` converts:
     - Relative date objects `{ dateId: "DAYS_AGO", value: 30 }` via `query.createRelativeDate`.
     - Relative date range strings like `"TODAY"`, `"THIS_MONTH"`, `"LAST_FISCAL_QUARTER"` via `query.RelativeDateRange`.
     - ISO date strings (`"2026-07-01"`) and ISO datetime strings (`"2026-07-01T00:00:00"`) into the NetSuite account's preferred date/datetime format using `N/format.format`. If NetSuite throws an `Invalid date value` error during preview because a date-only string was passed to a `DATETIME` field (or vice versa), `detectDateRetryModeFromError` automatically rebuilds the condition in the required `DATETIME` or `DATE` format and retries.

3. **Auto-Binding Condition Columns (`buildDatasetConditionNode`):**
   - In `N/dataset`, every `dataset.Condition` leaf requires a `dataset.Column` instance. You can filter on any field or join even if it is not displayed in `columns`: the RESTlet checks `columnBySignature` and `columnByAlias` to reuse an existing column if present, or automatically creates a hidden condition `dataset.Column` for the filter.

4. **Preventing the `"SuiteScript dataset"` & `"<Missing Translation>"` Platform Bugs:**
   - NetSuite's `N/dataset` module has three major platform quirks that `handleCreateDataset` works around automatically:
     1. **Cloning Loaded Components (`cloneLoadedDatasetComponents`):** Passing `.columns` or `.condition` from `dataset.load({ id })` directly into a new `dataset.create(...)` call causes `Dataset.save()` to corrupt column labels into `"<Missing Translation>"`. When `overwrite: true` inherits columns or conditions from an existing dataset, the RESTlet reconstructs fresh `dataset.createJoin`, `dataset.createColumn`, and `dataset.createCondition` instances.
     2. **Executing Previews via `N/query` Mirror Before Saving (`buildMirrorQueryFromDataset`):** Calling `.runPaged()` or `.run()` on an unsaved `dataset.Dataset` object mutates its internal column/condition graph in NetSuite's runtime and causes `.save({ name })` to ignore your `name` and save the dataset as `"SuiteScript dataset"`. Therefore, when `dryRun: false`, the RESTlet executes the preview against an in-memory `N/query` mirror (`buildMirrorQueryFromDataset`) and calls `.save({ name, description, id })` on a completely fresh, un-executed `dataset.create` instance.
     3. **Atomic Overwrite with Rollback Safeguard (`query.delete` + `save`):** Because `N/dataset.save()` is insert-only and throws if `id` already exists, updating an existing dataset (`overwrite: true`, `dryRun: false`) backs up the original dataset's cloned components in memory, calls `query.delete({ id })`, and saves the replacement dataset under the same `scriptId`. If saving the replacement fails for any reason, the catch block automatically restores the original dataset definition from the backup so the dataset is never lost.
     4. **Outer-Hop Target Fallback (`rebuildDatasetWithoutOuterHopTargets`):** If `Dataset.save()` throws `"Invalid identifier 'field^target'"` on a multi-hop join whose outer hop included `target`, the RESTlet automatically rebuilds the dataset with outer-hop targets stripped and retries `.save()`.
