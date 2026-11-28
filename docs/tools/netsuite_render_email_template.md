# Render Email Template (`netsuite_render_email_template`)

[← Back to Tools Overview](../tools-overview.md)

## Description & Usage

`netsuite_render_email_template` live-renders a deployed NetSuite **Email Template** (`custemailtmpl_*`) using NetSuite's `N/render.mergeEmail` API in the MCP Services RESTlet (`rl_mcp_services.js`).

### Automatic Record Sampling for Instant Previews
You can bind any combination of `transaction`, `entity`, `recipient`, `customRecord`, or `supportCase` records to the email merge:
- **Explicit IDs:** Pass `transactionId`, `entityId` (with `entityType`), `recipientId` (with `recipientType`), `customRecordId` (with `customRecordType`), or `supportCaseId`.
- **Auto-Sample Latest Record:** If you pass `transactionType` (without `transactionId`), `entityType` (without `entityId`), `recipientType` (without `recipientId`), or `customRecordType` (without `customRecordId`), the RESTlet **automatically searches for and binds the most recently created record of that type**!

### What It Returns
- **Evaluated `subject` and HTML `body`:** The final merged subject line and HTML email body string after FreeMarker/CRMSDK evaluation.
- **Bound Record Metadata (`boundRecords`):** Shows the exact internal IDs and `isAutoSampled` status for every record bound to the merge.
- **Local HTML Preview File (`previewFilePath`) & Embedded MCP Resource:** Saves the merged HTML body to `<os.tmpdir()>/netsuite-mcp-previews/<scriptId>.html` and returns an embedded `text/html` MCP `resource` block.

### Input Parameters

| Parameter | Type | Required | Description |
| :--- | :--- | :---: | :--- |
| `scriptId` | `string` | **Yes** | Script ID of the deployed Email Template (e.g., `'custemailtmpl_order_confirm'`; auto-prepended with `'custemailtmpl_'` if omitted). |
| `transactionId` | `number` \| `string` | No | Internal ID of a transaction record to merge into `${transaction.*}` fields. |
| `transactionType` | `string` | No | Transaction record type (e.g., `'salesorder'`, `'invoice'`) used to auto-sample the most recent transaction when `transactionId` is omitted. |
| `entityType` | `string` | No | Entity record type (e.g., `'customer'`, `'employee'`, `'vendor'`, `'contact'`, `'partner'`) to merge into entity fields. Auto-samples the latest record if `entityId` is omitted. |
| `entityId` | `number` \| `string` | No | Internal ID of the entity record when `entityType` is specified. |
| `recipientType` | `string` | No | Recipient record type (e.g., `'customer'`, `'contact'`, `'employee'`, `'vendor'`) to merge into recipient fields. Auto-samples the latest record if `recipientId` is omitted. |
| `recipientId` | `number` \| `string` | No | Internal ID of the recipient record when `recipientType` is specified. |
| `customRecordType` | `string` | No | Custom record script ID (e.g., `'customrecord_foo'`) to merge into `${customRecord.*}` fields. Auto-samples the latest record if `customRecordId` is omitted. |
| `customRecordId` | `number` \| `string` | No | Internal ID of the custom record when `customRecordType` is specified. |
| `supportCaseId` | `number` \| `string` | No | Internal ID of a support case record to merge. |

---

## Complementary Tools

- **[Upsert Email Template (`netsuite_upsert_email_template`)](./netsuite_upsert_email_template.md):** Deploy or update the email template via SDF, then call `netsuite_render_email_template` to verify that all FreeMarker expressions evaluate cleanly.
- **[Read Email Template (`netsuite_read_email_template`)](./netsuite_read_email_template.md):** Read the template's raw `subject` and `htmlContent` to see which record bindings (`${transaction.*}`, `${customer.*}`, `${customRecord.*}`) it expects.
- **[Load Record Sample (`netsuite_load_record_sample`)](./netsuite_load_record_sample.md):** Inspect the fields on a sample record if a FreeMarker expression in the email template evaluates to empty or throws an error.

---

## Tool Metadata

| Property | Value |
| :--- | :--- |
| **Tool ID** | `netsuite_render_email_template` |
| **Human-Readable Name** | Render Email Template |
| **Category** | `templates` (Templates — Advanced PDF & Email) |
| **Destructive (`isDestructive`)** | `false` |
| **Requires SDF (`requiresSdf`)** | `false` |
| **Default Availability** | On-demand via `netsuite_manage_toolsets` *(or enabled at startup in the `templates_localization` preset)* |

---

## Inner Workings

1. **Script ID Normalization (`normalizeEmailTemplateScriptId`):**
   - Validates and normalizes `scriptId` to lowercase `custemailtmpl_*`.

2. **SuiteQL `scriptId` -> Numeric `templateId` Lookup (`handleRenderEmailTemplate` in `rl_mcp_services.js`):**
   - NetSuite's `N/render.mergeEmail({ templateId, ... })` API requires the email template's **numeric internal ID** (`templateId`) and does not accept a `custemailtmpl_*` script ID string directly.
   - To make calling the tool seamless, `handleRenderEmailTemplate` executes:
     ```sql
     SELECT id, name FROM emailtemplate WHERE UPPER(scriptid) = UPPER('<scriptId>')
     ```
     via `N/query.runSuiteQL` to resolve `resolvedTemplateId` and `templateName`.

3. **Record Resolution & Auto-Sampling (`resolveOrAutoSampleRecordId`):**
   - Builds `mergeOptions = { templateId: resolvedTemplateId }`.
   - For each provided binding (`transaction`, `entity`, `recipient`, `customRecord`, `supportCase`):
     - If an explicit numeric ID was passed, validates that it is a positive integer.
     - If a record type (`transactionType`, `entityType`, `recipientType`, `customRecordType`) was passed without an ID, executes a 1-row `N/search` sorted by `internalid DESC` to auto-sample the most recent record ID and records `{ type, id, isAutoSampled: true }` in `boundRecords`.

4. **Email Merge Execution & Managed HTML Preview File:**
   - Calls `const mergeResult = render.mergeEmail(mergeOptions)` and extracts `mergeResult.subject` and `mergeResult.body`.
   - Back in `src/tools/renderEmailTemplate.ts`, writes the merged HTML `body` to `<os.tmpdir()>/netsuite-mcp-previews/<scriptId>.html` via `writeManagedTemplatePreviewFile` (auto-pruning preview files older than 15 minutes and deleting the preview directory on process exit).
   - Returns both the JSON summary (`scriptId`, `templateId`, `templateName`, `boundRecords`, `subject`, `body`, `previewFilePath`, `timeElapsedMS`, `governanceUsed`) and an embedded `text/html` MCP `resource` block.
