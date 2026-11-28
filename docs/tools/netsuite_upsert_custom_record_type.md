# Upsert Custom Record Type (`netsuite_upsert_custom_record_type`)

[← Back to Tools Overview](../tools-overview.md)

## Description & Usage

`netsuite_upsert_custom_record_type` creates a new **Custom Record Type** (`customrecord_*`) and its **Custom Fields** (`custrecord_*`), or updates an existing Custom Record Type in NetSuite via an isolated temporary SDF project.

### How Create vs. Update (Upsert) Works
1. **Updating an Existing Custom Record Type:**
   - The tool first attempts to download `<scriptId>.xml` from NetSuite via `suitecloud object:import`.
   - If found, it merges your changes into the existing XML:
     - Any provided record header properties (`name`, `description`, `aiDescription`, `includeNameField`, `accessType`, `isHierarchy`, `allowInlineEditing`, `enableNumbering`, `numberingPrefix`, `numberingMinDigits`, `showId`, `showOwner`, `isOrdered`) are updated while omitted header properties are preserved.
     - In `fields`: any field whose `scriptId` matches an existing `<customrecordcustomfield>` on the record updates that field **in-place** (preserving unexposed SDF sub-elements like permissions, role restrictions, or search filters).
     - Any field whose `scriptId` does not exist on the record yet is validated and **appended** as a new custom field with configured `FIELD` defaults applied.
2. **Creating a New Custom Record Type:**
   - If `<scriptId>` does not exist in NetSuite yet, a new `<customrecordtype>` is created.
   - **Strict Semantic Documentation Requirement on Creation:** When creating a new custom record type, `name`, `description`, and `aiDescription` are strictly required. Similarly, when creating any new field in `fields`, `label`, `type`, `description`, and `helpText` are strictly required so that your custom schema is self-documenting and accurately indexed by [`netsuite_search_tables`](./netsuite_search_tables.md) and [`netsuite_get_fields`](./netsuite_get_fields.md).

*(Note: This tool defines or modifies the Custom Record Type **table/schema** (`<customrecordtype>`) via SDF. To insert or update actual **data rows** inside a custom record table, use **[Upsert Record (`netsuite_upsert_record`)](./netsuite_upsert_record.md)**.)*

### Input Parameters

| Parameter | Type | Required | Description |
| :--- | :--- | :---: | :--- |
| `scriptId` | `string` | **Yes** | Script ID of the custom record type (auto-prefixed with `'customrecord_'` if omitted; max 38 characters). |
| `name` | `string` | Conditional | Display name of the custom record type (max 30 characters). Required when creating a new custom record; optional on update. |
| `description` | `string` | Conditional | Description of the custom record type. Required on creation; optional on update. |
| `aiDescription` | `string` | Conditional | AI description (`<aidescription>`) of the custom record type. Required on creation; optional on update. |
| `includeNameField` | `boolean` | No | Whether to include the native `Name` field (`<includename>`, defaults to `true` on creation). |
| `accessType` | `"CUSTRECORDENTRYPERM"` \| `"NONENEEDED"` \| `"USEPERMISSIONLIST"` | No | Permission model (`<accesstype>`). |
| `isHierarchy` | `boolean` | No | Enable built-in parent-child hierarchy (`<hierarchical>`). |
| `allowInlineEditing` | `boolean` | No | Allow inline editing in list/sublist views (`<allowinlineediting>`). |
| `enableNumbering` / `numberingPrefix` / `numberingMinDigits` | `boolean` / `string` / `integer` | No | Automatic record numbering settings. |
| `showId` / `showOwner` / `isOrdered` | `boolean` | No | UI display and ordering flags. |
| `fields` | `CustomRecordField[]` | No | Array of custom fields (`custrecord_*`, max 38 chars) to add or update: `{ scriptId, label?, type?, selectRecordType?, description?, helpText?, isMandatory?, storeValue?, showInList?, globalSearch?, displayType?, defaultValue?, defaultChecked?, dynamicDefault?, isFormula?, isParent?, parentSubtab?, onParentDelete?, subtab? }`. |
| `saveToProject` | `boolean` | No | Override whether the deployed `<scriptId>.xml` (and `manifest.xml` dependencies) is copied into your local project (`Objects/`). |

---

## Complementary Tools

- **[View Custom Object (`netsuite_view_custom_object`)](./netsuite_view_custom_object.md):** Always call `netsuite_view_custom_object` before updating an existing custom record type in a new session to inspect its current header properties and field `scriptId`s.
- **[Upsert Custom List (`netsuite_upsert_custom_list`)](./netsuite_upsert_custom_list.md):** If your custom record has a `SELECT` or `MULTISELECT` field that references a custom list (`customlist_*`), create or update the custom list first with `netsuite_upsert_custom_list`, then reference its `scriptId` in `selectRecordType`.
- **[Upsert Record (`netsuite_upsert_record`)](./netsuite_upsert_record.md):** Insert or update data records (rows) inside the custom record table after deploying its schema.
- **[Get Fields (`netsuite_get_fields`)](./netsuite_get_fields.md):** Pass `useFallback: true` to inspect a newly deployed custom record type via the NetSuite REST Metadata API even before refreshing your local `<Environment>.db`.

---

## Tool Metadata

| Property | Value |
| :--- | :--- |
| **Tool ID** | `netsuite_upsert_custom_record_type` |
| **Human-Readable Name** | Upsert Custom Record Type |
| **Category** | `custom_objects` (Custom Objects — Records, Fields & Lists) |
| **Destructive (`isDestructive`)** | **`true`** |
| **Requires SDF (`requiresSdf`)** | **`true`** |
| **Default Availability** | On-demand via `netsuite_manage_toolsets` *(or enabled at startup in the `admin` preset)* |

---

## Inner Workings

1. **ID & Length Validation (`normalizeCustomRecordScriptId` & `normalizeCustomRecordFieldScriptId` in `src/utils/customRecords.ts`):**
   - Strips `.xml`, lowercases, auto-prepends `customrecord_` (for the record) or `custrecord_` (for each field), validates `/^[a-z0-9_]+$/`, and enforces NetSuite's strict **38-character** SDF scriptId limit.
   - Enforces the **30-character** limit on record `name` and **40-character** limit on each field `label`.
   - Deduplicates incoming `fields` by normalized `scriptId` (last entry wins if duplicate IDs were passed in the same call).

2. **`selectRecordType` & Display Type Resolution (`getSelectRecordType` & `normalizeDisplayType`):**
   - For `SELECT` and `MULTISELECT` fields:
     - If `selectRecordType` starts with `customrecord_` or `customlist_`, automatically wraps it in `[scriptid=customrecord_...]` or `[scriptid=customlist_...]`.
     - If `selectRecordType` is a standard NetSuite record name (e.g., `'customer'`, `'transaction'`, `'item'`, `'employee'`, `'account'`, `'department'`, `'location'`, `'subsidiary'`, `'class'`), looks up its internal negative NetSuite SDF ID in `standardRecordSdfIds` (e.g., `'customer'` -> `'-2'`, `'transaction'` -> `'-30'`, `'item'` -> `'-10'`, `'account'` -> `'-112'`).
   - Maps UI display type aliases `'DISABLED'` -> `'LOCKED'` and `'INLINE'` -> `'STATICTEXT'` (since NetSuite SDF rejects `'DISABLED'` and `'INLINE'` on custom field `<displaytype>`).

3. **Existing Object Import & In-Place XML Merge:**
   - Spins up an isolated temporary SDF project (`withTempSdfProject`) and attempts `suitecloud object:import --type ALL --scriptid <scriptId> --destinationfolder /Objects`.
   - **If `<scriptId>.xml` exists in NetSuite (Update Flow):**
     - Parses the XML via `xmlbuilder2` and updates any provided header tags using `setNodeTextPreservingAttrs` (preserving XML attributes like `@translate`).
     - Iterates over `normalizedFields`: if an incoming field matches an existing `<customrecordcustomfield>` by `@scriptid`, `mergeExistingCustomRecordFieldObject` updates only the provided properties in-place; otherwise `buildNewCustomRecordFieldObject` validates that `label`, `type`, `description`, and `helpText` are all present, applies `ObjectDefaultType.FIELD` defaults (`config.json` + `fieldDefaults.ts`), and appends the new field node.
   - **If `<scriptId>.xml` does not exist yet (Create Flow):**
     - Verifies that `name`, `description`, and `aiDescription` are all non-empty.
     - Builds all field nodes via `mapCustomRecordFields` and merges `ObjectDefaultType.RECORD` defaults (`config.json` + `recordDefaults.ts`).

4. **Automatic `manifest.xml` Dependency Collection & Deployment:**
   - `collectDependenciesFromCustomRecordFields` scans all `<selectrecordtype>`, `<subtab>`, and `<parentsubtab>` nodes across all fields on the record for custom object references (`customrecord_*`, `customlist_*`, `custtab_*`, `customsegment_*`, `customtransaction_*`, excluding self-references to `scriptId`) and injects them into `<tempDir>/manifest.xml` under `<dependencies><objects>`.
   - Deploys via `deployObjectFromTempProject` (`suitecloud project:deploy --accountspecificvalues WARNING`) and, if `saveToProject` resolves to `true`, syncs `<scriptId>.xml` and `manifest.xml` dependencies into your local workspace.
