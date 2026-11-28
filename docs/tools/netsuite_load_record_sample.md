# Load Record Sample (`netsuite_load_record_sample`)

[← Back to Tools Overview](../tools-overview.md)

## Description & Usage

`netsuite_load_record_sample` loads a full NetSuite record instance in dynamic mode (`record.load({ type, id, isDynamic: true })`) via the MCP Services RESTlet (`rl_mcp_services.js`) and returns its complete JSON structure—including all body `fields` and `sublists`—along with resolution metadata.

If you omit `id`, the tool **automatically searches for and samples the most recently created record** (`internalid` sorted descending) of the specified `record_type`.

### When to Use It
- **Inspecting `N/record` body field and sublist structure:** NetSuite's `N/record` module (used in User Event, Client, Suitelet, RESTlet, and Map/Reduce scripts, as well as [`netsuite_upsert_record`](./netsuite_upsert_record.md) and Advanced PDF FreeMarker `${record.*}` bindings) uses SuiteScript record field and sublist IDs, which can differ from SuiteQL column names. Loading a sample record reveals every body field, sublist name (`item`, `addressbook`, `links`, `recmachcustrecord_*`), and sublist line field on that record type.
- **Inspecting a specific record by ID:** Pass both `record_type` and `id` to view the full JSON state of a specific transaction, entity, item, or custom record instance.
- **Preparing FreeMarker templates or Saved Searches:** Discover the exact field names present on a record before building an Advanced PDF Template, Email Template, or Saved Search.

### Input Parameters

| Parameter | Type | Required | Description |
| :--- | :--- | :---: | :--- |
| `record_type` | `string` | **Yes** | The NetSuite `N/record` type ID (e.g., `'salesorder'`, `'invoice'`, `'customer'`, `'vendor'`, `'inventoryitem'`, or a custom record script ID like `'customrecord_...'`). |
| `id` | `string` | No | Optional internal ID of a specific record to load. If omitted, the tool automatically searches for and loads the most recently created record of `record_type`. |

---

## Complementary Tools

- **[Upsert Record (`netsuite_upsert_record`)](./netsuite_upsert_record.md):** Call `netsuite_load_record_sample` first to see the exact body `fieldId` names and value formats on a record type before creating or updating a record with `netsuite_upsert_record`.
- **[Render Advanced PDF Template (`netsuite_render_advanced_pdf_template`)](./netsuite_render_advanced_pdf_template.md):** Advanced PDF templates bind `${record}` from `N/record.load`; inspecting a sample record with `netsuite_load_record_sample` shows the exact body fields and sublists available to FreeMarker.
- **[Create Saved Search (`netsuite_create_saved_search`)](./netsuite_create_saved_search.md):** Helpful for verifying native record field IDs when building `N/search` definitions.
- **[Get Fields (`netsuite_get_fields`)](./netsuite_get_fields.md):** Compare the `N/record` structure from `netsuite_load_record_sample` with the SuiteQL / Records Catalog schema from `netsuite_get_fields`.

---

## Tool Metadata

| Property | Value |
| :--- | :--- |
| **Tool ID** | `netsuite_load_record_sample` |
| **Human-Readable Name** | Load Record Sample |
| **Category** | `data_operations` (Data Querying & Record Operations) |
| **Destructive (`isDestructive`)** | `false` |
| **Requires SDF (`requiresSdf`)** | `false` |
| **Default Availability** | Enabled at startup by default |

---

## Inner Workings

1. **RESTlet Dispatch (`RECORD_SAMPLE`):**
   - Sends `{ action: "RECORD_SAMPLE", recordType: args.record_type, recordId: args.id }` to the MCP Services RESTlet via OAuth 1.0a.

2. **Auto-Sampling the Most Recent Record (`handleRecordSample` in `rl_mcp_services.js`):**
   - Validates that `request.recordType` is a non-empty string.
   - If `request.recordId` is provided, sets `resolvedId = String(request.recordId)` and `isAutoSampled = false`.
   - If `request.recordId` is omitted (`isAutoSampled = true`):
     - Creates an `N/search` query on `type: recordType` with a single column: `internalid` sorted descending (`search.Sort.DESC`).
     - Fetches the first result (`getRange({ start: 0, end: 1 })`) and extracts `searchResult[0].id` as `resolvedId`.
     - If no records exist for that `recordType`, returns a clear error: `"No existing records found for type '<recordType>' to use as a sample."`

3. **Dynamic Record Load & Serialization:**
   - Calls `record.load({ type: recordType, id: resolvedId, isDynamic: true })`.
   - Returns:
     ```json
     {
       "success": true,
       "metadata": {
         "record_type": "salesorder",
         "requested_id": null,
         "resolved_id": "12345",
         "is_auto_sampled": true
       },
       "recordData": { ... }
     }
     ```
   - When serialized to JSON by NetSuite's SuiteScript 2.1 runtime, `recordObj` includes the record's `id`, `type`, `isDynamic`, `fields` (all body field key-value pairs), and `sublists` (every sublist and its lines).
