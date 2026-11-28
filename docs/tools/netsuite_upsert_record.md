# Upsert Record (`netsuite_upsert_record`)

[← Back to Tools Overview](../tools-overview.md)

## Description & Usage

`netsuite_upsert_record` creates a new NetSuite data record (`record.create`) or updates an existing data record (`record.load` when `id` is provided) in dynamic mode via the MCP Services RESTlet (`rl_mcp_services.js`), sets the specified array of header/body `fields` (`{ fieldId, value }`), saves the record (`recordObj.save()`), and returns the saved internal `recordId`, `operation` (`"create"` or `"update"`), elapsed time (`timeElapsedMS`), and governance units consumed (`governanceUsed`).

### Important Constraints & Notes
- **Header/Body Fields Only:** Only header/body field mutations are supported. Sublist/line-item mutations are not supported—therefore, record types that require sublist lines on creation (such as `salesorder` or `invoice` transactions) cannot be *created* with this tool, though header fields (such as `memo` or `custbody_*`) on *existing* transactions can be updated by passing `id`.
- **Data Rows vs. Schema Definitions:** This tool creates or updates **data instances (rows)** inside an existing table (e.g., a `customer`, `vendor`, `employee`, `contact`, or an instance of `customrecord_my_table`). To create or modify a Custom Record Type's **table/field schema definition** via SDF, use **[Upsert Custom Record Type (`netsuite_upsert_custom_record_type`)](./netsuite_upsert_custom_record_type.md)** instead.
- **Automatic ISO Date Conversion:** For `date` and `datetimetz` fields, pass an ISO string (`"YYYY-MM-DD"` or `"YYYY-MM-DDTHH:mm:ss"`). The RESTlet automatically inspects the field type and converts ISO strings into JavaScript `Date` objects before calling `setValue`.

### Input Parameters

| Parameter | Type | Required | Description |
| :--- | :--- | :---: | :--- |
| `table_id` | `string` | **Yes** | The NetSuite record type / table ID (e.g., `'customer'`, `'vendor'`, `'employee'`, `'contact'`, or `'customrecord_...'`). |
| `id` | `string` \| `number` | No | Internal ID of an existing record to update. If omitted, a new record is created. |
| `fields` | `Array<{ fieldId: string, value: any }>` | **Yes** | Array of header/body `{ fieldId, value }` pairs to set on the record. `value` can be a `string`, `number`, `boolean`, array of strings/numbers (for multi-select fields), or `null`. |

---

## Complementary Tools

- **[Load Record Sample (`netsuite_load_record_sample`)](./netsuite_load_record_sample.md):** Load a sample record of `table_id` first to inspect valid body `fieldId` names and current field values before calling `netsuite_upsert_record`.
- **[Get Fields (`netsuite_get_fields`)](./netsuite_get_fields.md):** Inspect custom field IDs (`custentity_*`, `custbody_*`, `custrecord_*`) and field types (`DATE`, `SELECT`, `CHECKBOX`, etc.) on the target table.
- **[Run SuiteQL (`netsuite_run_suite_ql`)](./netsuite_run_suite_ql.md):** Query internal IDs for `SELECT` reference fields (such as `subsidiary`, `department`, or `entitystatus`) or verify the record after upserting.
- **[Upsert Custom Record Type (`netsuite_upsert_custom_record_type`)](./netsuite_upsert_custom_record_type.md):** Create or update the custom record type schema itself before inserting data rows into it with `netsuite_upsert_record`.

---

## Tool Metadata

| Property | Value |
| :--- | :--- |
| **Tool ID** | `netsuite_upsert_record` |
| **Human-Readable Name** | Upsert Record |
| **Category** | `data_operations` (Data Querying & Record Operations) |
| **Destructive (`isDestructive`)** | **`true`** |
| **Requires SDF (`requiresSdf`)** | `false` |
| **Default Availability** | Enabled at startup by default *(blocked if `profile.disableDestructive === true` unless listed in `allowedTools`)* |

---

## Inner Workings

1. **Payload Construction & Dispatch:**
   - Builds `{ action: "UPSERT_RECORD", recordType: args.table_id, fields: args.fields }` (plus `id: String(args.id).trim()` if `id` is provided) and sends it to the MCP Services RESTlet via OAuth 1.0a.

2. **RESTlet Validation & Record Instantiation (`handleUpsertRecord` in `rl_mcp_services.js`):**
   - Validates that `recordType` is a non-empty string and `fields` is an array where every entry has a non-empty string `fieldId` and an explicit `value` property.
   - Records starting governance (`runtime.getCurrentScript().getRemainingUsage()`) and starts an `ExecutionTimer`.
   - If `id` is present (`isUpdate = true`), calls `record.load({ type: rawRecordType, id: rawId, isDynamic: true })` (10–20 governance units depending on record type).
   - If `id` is omitted (`isUpdate = false`), calls `record.create({ type: rawRecordType, isDynamic: true })`.

3. **Smart Field Value & Date Normalization (`normalizeFieldValue` & `parseIsoDateString`):**
   - For each `{ fieldId, value }` entry:
     - If `value` is a string, `normalizeFieldValue` calls `recordObj.getField({ fieldId })` to inspect `fieldObj.type`.
     - If `fieldObj.type` is `"date"`, `"datetimetz"`, or `"datetime"`, `parseIsoDateString` checks if the string matches `YYYY-MM-DD` (constructing `new Date(year, monthIndex, day)` using local calendar components so UTC timezone offsets never shift the calendar day backward) or `YYYY-MM-DD[T ]HH:mm...` (constructing `new Date(trimmed)`).
     - Calls `recordObj.setValue({ fieldId, value: normalizedValue })`.
     - **Resilient Date Retry:** In some dynamic record contexts, `recordObj.getField({ fieldId })` may return `null` even on a valid date field. If `recordObj.setValue` throws an error on a string value that matches an ISO date format, the RESTlet automatically catches the error and retries `recordObj.setValue` with the parsed `Date` object before surfacing any field error.

4. **Saving & Metrics:**
   - Calls `const recordId = recordObj.save()` and returns `{ success: true, operation: isUpdate ? "update" : "create", recordId, recordType, timeElapsedMS, governanceUsed }`.
