# Upsert Custom List (`netsuite_upsert_custom_list`)

[← Back to Tools Overview](../tools-overview.md)

## Description & Usage

`netsuite_upsert_custom_list` creates a new NetSuite **Custom List** (`customlist_*`) and its list values (`<customvalue>`), or updates an existing Custom List via an isolated temporary SDF project.

### Intelligent Merge & Deduplication Behavior on Update
When updating an existing Custom List in NetSuite, the tool downloads the current `<customlist>` XML definition via SDF and merges your `values` array using three rules:
1. **Match by `scriptId` (In-Place Label Rename):** If an incoming item's `scriptId` (e.g., `'val_pending'`) matches an existing `<customvalue scriptid="val_pending">` on the list, that existing item's text label (`<value>`) is updated in-place.
2. **Match by Label under a Different `scriptId` (Automatic Deduplication):** If an incoming item's `scriptId` is new, but its text label (`value`) already exists on the list under a different `scriptId` (case-insensitive), it is **automatically skipped** and reported in the Upsert Summary (`Skipped 1 duplicate label(s): "Pending" (already exists as 'val_12345')`) so duplicate labels are never created.
3. **New Value (Append):** Otherwise, the item is appended to `<customvalues>` as a new `<customvalue>`.

### Input Parameters

| Parameter | Type | Required | Description |
| :--- | :--- | :---: | :--- |
| `scriptId` | `string` | **Yes** | Internal ID of the custom list to create or update (auto-prepended with `'customlist_'` if omitted; max 38 characters). |
| `name` | `string` | Conditional | Display name of the custom list (max 30 characters). Required when creating a new custom list; optional when updating an existing custom list. |
| `description` | `string` | No | Optional description of the custom list. |
| `values` | `Array<{ scriptId: string, value: string }>` | **Yes** | Array of custom list items. Each item requires `scriptId` (internal ID of the value, e.g., `'val_high'`, max 40 characters) and `value` (the display text label). |
| `saveToProject` | `boolean` | No | Override whether the deployed `<scriptId>.xml` is copied into your local project (`Objects/`). |

---

## Complementary Tools

- **[View Custom Object (`netsuite_view_custom_object`)](./netsuite_view_custom_object.md):** Always call `netsuite_view_custom_object` with the list's `scriptId` before updating an existing Custom List in a new session so you know the exact `scriptId`s of its current values (especially for lists created in the NetSuite UI where values have auto-generated IDs like `val_48291_1234567_890`).
- **[Upsert Custom Record Type (`netsuite_upsert_custom_record_type`)](./netsuite_upsert_custom_record_type.md) & [Upsert Custom Field (`netsuite_upsert_custom_field`)](./netsuite_upsert_custom_field.md):** After creating a custom list with `netsuite_upsert_custom_list`, pass its `scriptId` (`'customlist_...'`) as `selectRecordType` on custom record fields or standalone custom fields.

---

## Tool Metadata

| Property | Value |
| :--- | :--- |
| **Tool ID** | `netsuite_upsert_custom_list` |
| **Human-Readable Name** | Upsert Custom List |
| **Category** | `custom_objects` (Custom Objects — Records, Fields & Lists) |
| **Destructive (`isDestructive`)** | **`true`** |
| **Requires SDF (`requiresSdf`)** | **`true`** |
| **Default Availability** | On-demand via `netsuite_manage_toolsets` *(or enabled at startup in the `admin` preset)* |

---

## Inner Workings

1. **Up-Front Validation & Intra-Batch Deduplication (`src/tools/upsertCustomList.ts`):**
   - `normalizeCustomListScriptId` strips `.xml`, lowercases, auto-prepends `customlist_` if missing, and enforces NetSuite's **38-character** limit on the list `scriptId`.
   - Enforces the **30-character** limit on `name` and **40-character** limit on each value's `scriptId`.
   - Deduplicates the incoming `values` array itself before touching SDF:
     - Tracks `seenBatchScriptIds` and `seenBatchLabels` (case-insensitive).
     - If the same `scriptId` appears twice in `values`, the later entry overwrites the label.
     - If the same `value` label appears twice under different `scriptId`s in the same input batch, the duplicate is skipped.

2. **Existing List Import & Three-Way Merge:**
   - Spins up an isolated temporary SDF project (`withTempSdfProject`) and attempts `suitecloud object:import --type ALL --scriptid <scriptId> --destinationfolder /Objects`.
   - **If `<scriptId>.xml` exists in NetSuite (Update Flow):**
     - Parses `<customlist>` via `xmlbuilder2`, updating `<name>` and `<description>` while preserving XML attributes (`setNodeTextPreservingAttrs`).
     - Normalizes `<customvalues><customvalue>` into an array (`existingValues`) and runs the 3-way merge loop (`matchById` -> update label in-place; `matchByLabel` -> skip and record in `skippedDuplicateLabels`; otherwise -> push new `{ "@scriptid": incoming.scriptId, value: incoming.value }`).
   - **If `<scriptId>.xml` does not exist yet (Create Flow):**
     - Verifies that `name` is provided and non-empty.
     - Applies `ObjectDefaultType.LIST` defaults (`config.json` + `listDefaults.ts`: `ismatrixoption: 'F'`, `isordered: 'T'`) via `applyDefaults`.

3. **Deployment & Local Project Sync:**
   - Serializes the `<customlist>` XML via `xmlbuilder2` and calls `deployObjectFromTempProject`:
     - Writes `Objects/<scriptId>.xml` and `deploy.xml` inside the temporary SDF project.
     - Executes `suitecloud project:deploy --accountspecificvalues WARNING`.
     - If `saveToProject` resolves to `true`, copies `<scriptId>.xml` to your local workspace `<sdfSourceDir>/Objects/...` (updating in-place if it already exists or placing it according to `objectsFolderStrategy`).
     - Appends a detailed `[Upsert Summary]` listing all added values, updated values, and skipped duplicate labels.
