# Render Advanced PDF Template (`netsuite_render_advanced_pdf_template`)

[← Back to Tools Overview](../tools-overview.md)

## Description & Usage

`netsuite_render_advanced_pdf_template` live-renders a NetSuite **Advanced PDF/HTML Template**—either by deployed **`scriptId`** (`custtmpl_*`) OR from inline **`pdfContent`** (raw BFO XML + FreeMarker without requiring SDF deployment first)—using NetSuite's `N/render` module in the MCP Services RESTlet (`rl_mcp_services.js`).

### Flexible Data Source Binding
You can bind any combination of:
- **A NetSuite Record (`recordType` + optional `recordId`):** Bound to the FreeMarker `${record}` variable (`renderer.addRecord({ templateName: "record", record })`). If you pass `recordType` (e.g., `'invoice'`, `'salesorder'`, `'customrecord_...'`) and omit `recordId`, the tool **automatically samples the most recently created record** of that type!
- **A Saved Search (`searchId`):** Executes the saved search and binds its results to the FreeMarker `${results}` variable (`renderer.addSearchResults({ templateName: "results", searchResult })`).
- **Custom JSON Data (`customData`):** Binds arbitrary key-value JSON objects (`{ "myAlias": { ... } }`) via `renderer.addCustomDataSource`.

### Visual PDF Preview & Automatic BFO Failure Diagnostics
- **On Success:** Saves the rendered PDF to a local auto-cleaned preview directory (`previewFilePath`, e.g., `/tmp/netsuite-mcp-previews/custtmpl_invoice.pdf`) and returns an embedded MCP resource (`type: "resource"`, `mimeType: "application/pdf"`, base64 `blob`) so multimodal AI assistants and users can visually inspect the rendered PDF.
- **On BFO Rendering Failure:** If FreeMarker evaluates cleanly but NetSuite's BFO PDF engine fails on malformed XML (such as an unclosed tag or unescaped `&`), the RESTlet **automatically captures and returns `evaluatedXml` (`renderer.renderAsString()`)** in the error response so you can immediately see the exact post-FreeMarker XML that caused BFO to fail!

### Input Parameters

| Parameter | Type | Required | Description |
| :--- | :--- | :---: | :--- |
| `scriptId` | `string` | No* | Script ID of a deployed Advanced PDF Template (e.g., `'custtmpl_custom_invoice'`; auto-prepended with `'custtmpl_'` if omitted). |
| `pdfContent` | `string` | No* | Raw BFO XML + FreeMarker string (`<?xml version="1.0"?><!DOCTYPE pdf ...><pdf>...</pdf>`). When provided, renders this inline template content directly without deploying via SDF first. |
| `recordType` | `string` | No | NetSuite record type to load and bind to `${record}` (e.g., `'invoice'`, `'salesorder'`, `'vendorbill'`, `'itemfulfillment'`, or `'customrecord_foo'`). |
| `recordId` | `number` \| `string` | No | Internal ID of the record to bind when `recordType` is specified. If omitted when `recordType` is provided, automatically samples the most recent record of `recordType`. |
| `searchId` | `string` | No | Saved Search ID (e.g., `'customsearch_my_search'`) to execute and bind to `${results}`. |
| `customData` | `Record<string, object>` | No | Map of custom FreeMarker data source aliases to JSON objects bound via `renderer.addCustomDataSource({ alias, format: render.DataSource.OBJECT, data })`. |
| `returnEvaluatedXml` | `boolean` | No | If `true`, also returns the intermediate BFO XML string after FreeMarker evaluation (`evaluatedXml`) on success. (Always included automatically when BFO rendering fails). Defaults to `false`. |

*\*Either `scriptId` or `pdfContent` must be provided.*

---

## Complementary Tools

- **[Read Advanced PDF Template (`netsuite_read_advanced_pdf_template`)](./netsuite_read_advanced_pdf_template.md):** Read an existing template's `pdfContent`, tweak it in memory, and test it via `netsuite_render_advanced_pdf_template({ pdfContent, recordType })`.
- **[Upsert Advanced PDF Template (`netsuite_upsert_advanced_pdf_template`)](./netsuite_upsert_advanced_pdf_template.md):** Once your inline `pdfContent` renders cleanly in `netsuite_render_advanced_pdf_template`, deploy it to NetSuite with `netsuite_upsert_advanced_pdf_template`.
- **[Load Record Sample (`netsuite_load_record_sample`)](./netsuite_load_record_sample.md):** Inspect the fields and sublists on a record before referencing `${record.*}` in FreeMarker.
- **[View Saved Search (`netsuite_view_saved_search`)](./netsuite_view_saved_search.md):** Inspect the columns on a saved search before referencing `${result.*}` in a saved-search PDF template.

---

## Tool Metadata

| Property | Value |
| :--- | :--- |
| **Tool ID** | `netsuite_render_advanced_pdf_template` |
| **Human-Readable Name** | Render Advanced PDF Template |
| **Category** | `templates` (Templates — Advanced PDF & Email) |
| **Destructive (`isDestructive`)** | `false` |
| **Requires SDF (`requiresSdf`)** | `false` |
| **Default Availability** | On-demand via `netsuite_manage_toolsets` *(or enabled at startup in the `templates_localization` preset)* |

---

## Inner Workings

1. **Up-Front Validation (`src/tools/renderAdvancedPdfTemplate.ts`):**
   - Verifies that at least one of `scriptId` or `pdfContent` is provided.
   - If `scriptId` is provided, normalizes it via `normalizeAdvancedPdfScriptId` (`custtmpl_*`).
   - If `pdfContent` is provided, validates that it contains a root `<pdf>...</pdf>` element via `validateBfoPdfContent` before calling the RESTlet.

2. **`N/render.TemplateRenderer` Execution (`handleRenderPdfTemplate` in `rl_mcp_services.js`):**
   - Calls `const renderer = render.create()`.
   - **Template Source Selection:** If `pdfContent` is present, assigns `renderer.templateContent = request.pdfContent` (allowing instant in-memory iteration without SDF!). Otherwise calls `renderer.setTemplateByScriptId({ scriptId: rawScriptId.toUpperCase() })`.
   - **Record Binding & Auto-Sampling (`resolveOrAutoSampleRecordId`):** If `recordType` is specified, uses `recordId` if provided or runs a 1-row `N/search` sorted by `internalid DESC` to auto-sample the latest record ID. Loads the record in standard mode (`record.load({ type: recordType, id: resolvedRecordId, isDynamic: false })`) and binds it via `renderer.addRecord({ templateName: "record", record: recordObj })`.
   - **Saved Search Binding:** If `searchId` is specified, loads `search.load({ id: searchId })` and calls `renderer.addSearchResults({ templateName: "results", searchResult: searchObj.run() })`.
   - **Custom Data Binding:** Loops over `customData` keys and binds each object via `renderer.addCustomDataSource({ alias, format: render.DataSource.OBJECT, data })`.
   - **Rendering & Automatic BFO Failure Diagnostics:**
     - If `returnEvaluatedXml: true`, captures `evaluatedXml = renderer.renderAsString()`.
     - Calls `const pdfFile = renderer.renderAsPdf()` and reads the base64 PDF content via `pdfFile.getContents()`.
     - If `renderAsPdf()` throws a BFO XML parsing error and `evaluatedXml` was not captured yet, the `catch` block immediately calls `renderer.renderAsString()` and attaches `evaluatedXml` to the error response so the caller can see the exact line/character where BFO failed.

3. **Managed Preview File & Embedded MCP Resource:**
   - Decodes `pdfBase64` into a `Buffer` and writes it to `<os.tmpdir()>/netsuite-mcp-previews/<scriptId|inline_preview>.pdf` via `writeManagedTemplatePreviewFile` (auto-pruning previews older than 15 minutes and cleaning up on process exit).
   - Returns both a JSON metadata summary (`previewFilePath`, `pdfByteSize`, `resolvedRecordId`, `isAutoSampled`, `timeElapsedMS`, `governanceUsed`, optional `evaluatedXml`) and an embedded `application/pdf` MCP `resource` block.
