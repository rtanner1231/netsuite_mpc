# View Custom Object (`netsuite_view_custom_object`)

[← Back to Tools Overview](../tools-overview.md)

## Description & Usage

`netsuite_view_custom_object` inspects an existing NetSuite **Custom Record Type** (`customrecord_*`), **Custom List** (`customlist_*`), or **Standalone Custom Field** (`custbody_*`, `custcol_*`, `custevent_*`, `custitem_*`, `custentity_*`, `custrecord_*`, `custitemnumber_*`) via SDF inside an isolated temporary SDF project, OR lists and searches existing custom objects when `scriptId` is omitted.

### Two Operating Modes

1. **Inspect a Specific Custom Object (`scriptId` provided):**
   - Downloads the object's SDF XML definition from NetSuite (falling back to your local `Objects/<scriptId>.xml` if not deployed yet) and parses it into the **exact JSON format** accepted by the corresponding upsert tool:
     - **Custom Record Types (`customrecord_*`):** Returns header properties (`name`, `description`, `aiDescription`, `includeNameField`, `accessType`, `isHierarchy`, `allowInlineEditing`, `enableNumbering`, `numberingPrefix`, `numberingMinDigits`, `showId`, `showOwner`, `isOrdered`, `isInactive`) and all `fields` (`custrecord_*`) ready for [`netsuite_upsert_custom_record_type`](./netsuite_upsert_custom_record_type.md).
     - **Custom Lists (`customlist_*`):** Returns `name`, `description`, `isOrdered`, `isMatrixOption`, `isInactive`, and all list `values` (`{ scriptId, value, isInactive?, abbreviation? }`) ready for [`netsuite_upsert_custom_list`](./netsuite_upsert_custom_list.md).
     - **Standalone Custom Fields (`custbody_*`, `custcol_*`, etc.):** Returns `fieldCategory`, `rootElement`, `label`, `type`, `selectRecordType` (translating negative internal IDs like `-2` back to `'customer'`), `appliesTo` (translating SDF tags like `bodysale` back to `'SALE'`), `recordType`, `displayType`, `defaultValue`, etc., ready for [`netsuite_upsert_custom_field`](./netsuite_upsert_custom_field.md).
2. **List / Search Custom Objects (`scriptId` omitted):**
   - Runs `suitecloud object:list` for the requested `objectType` (`'all'`, `'custom_list'`, `'custom_record_type'`, `'custom_field'`, or a specific field category like `'transaction_body'`) and filters by optional `searchTerm` and `limit`.

### Input Parameters

| Parameter | Type | Required | Description |
| :--- | :--- | :---: | :--- |
| `scriptId` | `string` | No | Script ID of the Custom Record Type (`customrecord_*`), Custom List (`customlist_*`), or Standalone Custom Field (`custbody_*`, `custcol_*`, `custevent_*`, `custitem_*`, `custentity_*`, `custrecord_*`, `custitemnumber_*`) to inspect. *(Note: To inspect a `custrecord_*` field belonging to a `customrecord_*` table, pass the parent `customrecord_*` `scriptId`.)* Omit to run in list/search mode. |
| `objectType` | `string` | No | Type hint or list filter: `'auto'`, `'all'`, `'custom_record_type'`, `'custom_list'`, `'custom_field'`, `'transaction_body'`, `'transaction_line'`, `'crm'`, `'item'`, `'entity'`, `'other_record'`, `'item_option'`, or `'item_number'`. |
| `searchTerm` | `string` | No | *(List mode — when `scriptId` is omitted)* Case-insensitive partial search term to filter custom object script IDs. |
| `limit` | `number` | No | *(List mode — when `scriptId` is omitted)* Maximum number of matching objects to return (`1` to `1000`, default: `100`). |
| `includeRawXml` | `boolean` | No | *(View mode — when `scriptId` is provided)* Whether to include the raw SDF XML string (`rawXml`) alongside the parsed JSON definition. Defaults to `false`. |

---

## Complementary Tools

- **[Upsert Custom Record Type (`netsuite_upsert_custom_record_type`)](./netsuite_upsert_custom_record_type.md):** Call `netsuite_view_custom_object` first to inspect an existing custom record's fields and header settings before updating it.
- **[Upsert Custom List (`netsuite_upsert_custom_list`)](./netsuite_upsert_custom_list.md):** Call `netsuite_view_custom_object` first to inspect each existing list value's internal `scriptId` (e.g., `val_12345` or `value_1`) before renaming or adding list values.
- **[Upsert Custom Field (`netsuite_upsert_custom_field`)](./netsuite_upsert_custom_field.md):** Call `netsuite_view_custom_object` first to inspect a standalone custom field's `fieldCategory` (especially for `custcol_*`, which can be either `transaction_line` or `item_option`) and active `appliesTo` targets.

---

## Tool Metadata

| Property | Value |
| :--- | :--- |
| **Tool ID** | `netsuite_view_custom_object` |
| **Human-Readable Name** | View Custom Object |
| **Category** | `custom_objects` (Custom Objects — Records, Fields & Lists) |
| **Destructive (`isDestructive`)** | `false` |
| **Requires SDF (`requiresSdf`)** | **`true`** |
| **Default Availability** | On-demand via `netsuite_manage_toolsets` *(or enabled at startup in the `admin` preset)* |

---

## Inner Workings

1. **Prefix & SDF Type Resolution (`resolveRequestedScriptIdAndSdfType`):**
   - Strips any `.xml` suffix or `[scriptid=...]` wrapper and normalizes `scriptId` to lowercase.
   - If `scriptId` does not start with a known prefix (`customrecord_`, `customlist_`, `custbody_`, `custcol_`, `custevent_`, `custitem_`, `custentity_`, `custrecord_`, `custitemnumber_`), checks `objectType` to auto-prepend the matching prefix.
   - Maps the prefix to the specific SDF `--type` argument (`customrecordtype`, `customlist`, `transactionbodycustomfield`, `crmcustomfield`, `itemcustomfield`, `entitycustomfield`, `itemnumbercustomfield`, `othercustomfield`, or `ALL` for `custcol_*` when `objectType` is not specified since `custcol_*` can be either `transactioncolumncustomfield` or `itemoptioncustomfield`).

2. **Mode 1 — Isolated SDF Object Import & Local Fallback:**
   - Spins up a temporary SDF project (`withTempSdfProject`) and runs:
     ```bash
     suitecloud object:import --type <sdfType> --scriptid <scriptId> --destinationfolder /Objects
     ```
     (If a specific `sdfType` fails, automatically retries with `--type ALL`).
   - Also checks whether `<scriptId>.xml` exists locally under `<sdfSrcDir>/Objects` via `findExistingObjectFile`. If the object is not in NetSuite yet, falls back to reading the local XML (`source: "local_sdf_only"`).
   - If a user passes a `custrecord_*` ID that is not found as a standalone `<othercustomfield>`, the error message includes a helpful hint reminding them to pass the parent `customrecord_*` ID if the field belongs to a Custom Record Type.

3. **Reverse-Mapping SDF XML to Upsert-Compatible JSON (`parseCustomObjectSdfXml`):**
   - Parses the XML via `xmlbuilder2` (`create(xmlContent).toObject()`) and inspects the root element:
     - **`<customrecordtype>` (`parseCustomRecordTypeObject`):** Extracts record header flags and maps each `<customrecordcustomfield>` node.
     - **`<customlist>` (`parseCustomListObject`):** Extracts list flags and maps `<customvalues><customvalue>` into `{ scriptId, value, isInactive, abbreviation }`.
     - **`<*customfield>` (`parseStandaloneCustomFieldObject`):**
       - Reverse-maps `selectrecordtype` and `rectype` (`formatSelectRecordTypeForOutput`): unwraps `[scriptid=customrecord_foo]` to `"customrecord_foo"`, and translates negative NetSuite internal record type IDs (like `"-2"` or `"-30"`) back to their canonical human-readable names (`"customer"`, `"transaction"`) using `STANDARD_RECORD_NAME_BY_SDF_ID` while preserving `rawSelectRecordType`.
       - Reverse-maps active SDF boolean applicability tags (`bodysale: "T"`, `appliestocustomer: "T"`, etc.) into both canonical `appliesTo` names (`["SALE"]`, `["CUSTOMER"]`) and `activeAppliesToSdfTags`.

4. **Mode 2 — Listing Custom Objects via `suitecloud object:list`:**
   - Resolves the list of SDF types to query (`resolveSdfListTypes` — up to all 10 custom object root elements when `objectType` is `"all"`).
   - Runs `suitecloud object:list --type <types...>` inside the temporary SDF project, parses `type:scriptid` lines, deduplicates, filters by `searchTerm`, groups results into `objectsByType`, and slices to `limit`.
