# Upsert Advanced PDF Template (`netsuite_upsert_advanced_pdf_template`)

[← Back to Tools Overview](../tools-overview.md)

## Description & Usage

`netsuite_upsert_advanced_pdf_template` creates a new NetSuite **Advanced PDF/HTML Template** (`custtmpl_*`) and its companion **BFO XML / FreeMarker file** (`<scriptId>.template.xml`), or updates an existing Advanced PDF Template via an isolated temporary SDF project.

### How Create vs. Update (Upsert) Works
- **Updating an Existing Template:** The tool first attempts to import `<scriptId>.xml` and `<scriptId>.template.xml` from NetSuite via SDF. If found, it merges only the parameters you explicitly pass onto the existing template definition so omitted properties (or existing `pdfContent` if you are only updating `title`/`preferred`) are preserved intact.
- **Creating a New Template:** If `<scriptId>` does not exist in NetSuite yet, `title` and `pdfContent` are required. By default on creation, `standard` defaults to `'STDTMPLEMPTY'`, `displaysourcecode` defaults to `true` (`'T'`, preventing users from accidentally breaking FreeMarker loops in the NetSuite WYSIWYG editor), `preferred` defaults to `false`, and `isinactive` defaults to `false`.

### Input Parameters

| Parameter | Type | Required | Description |
| :--- | :--- | :---: | :--- |
| `scriptId` | `string` | **Yes** | Script ID of the Advanced PDF Template (auto-prepended with `'custtmpl_'` if omitted; max 98 characters). |
| `title` | `string` | Conditional | Display title of the template (`<title>`, max 297 characters). Required when creating a new template; optional on update. |
| `pdfContent` | `string` | Conditional | Complete BFO XML + FreeMarker source written to `<scriptId>.template.xml`. Must contain a root `<pdf>...</pdf>` element. Required when creating a new template; optional on update. |
| `standard` | `string` | No | Standard template base ID (`@standard`, e.g., `'STDTMPLCUSTINVC'`, `'STDTMPLSALESORD'`, `'STDTMPLEMPTY'`). Defaults to `'STDTMPLEMPTY'` on creation. |
| `trantype` | `string` | No | Transaction type code (`<trantype>`, e.g., `'CUSTINVC'`, `'SALESORD'`, `'VENDBILL'`, `'ITEMSHIP'`, `'PURCHORD'`). |
| `printtype` | `string` | No | Print type (`<printtype>`, e.g., `'TRANSACTION'`, `'PACKINGSLIP'`, `'PICKINGTICKET'`, `'ITEMLABEL'`, `'CUSTOMRECORD'`, `'CUSTOMTRANSACTION'`, `'SEARCH'`). *(Note: `'STATEMENT'` is rejected up front because NetSuite SDF does not support Customer Statement templates.)* |
| `recordtype` | `string` | No | Custom record (`'customrecord_...'`, mapped to `<recordtype>`) or custom transaction (`'customtransaction_...'`, automatically mapped to `<customtransaction>`). Raw IDs are auto-wrapped in `[scriptid=...]`. |
| `savedsearch` | `string` | No | Saved search ID (`'customsearch_...'`, mapped to `<savedsearch>` and auto-wrapped in `[scriptid=...]`). |
| `preferred` | `boolean` | No | Whether this template is the preferred print template (`<preferred>`, defaults to `false` on creation). |
| `displaysourcecode` | `boolean` | No | Whether the template opens in Source Code mode in the NetSuite UI (`<displaysourcecode>`, defaults to `true` on creation). |
| `description` | `string` | No | Template description (`<description>`, max 4,000 characters). |
| `isinactive` | `boolean` | No | Mark template inactive (`<isinactive>`, defaults to `false` on creation). |
| `saveToProject` | `boolean` | No | Override whether both `<scriptId>.xml` and `<scriptId>.template.xml` (plus `manifest.xml` dependencies) are copied into your local project (`Objects/`). |

---

## Complementary Tools

- **[Render Advanced PDF Template (`netsuite_render_advanced_pdf_template`)](./netsuite_render_advanced_pdf_template.md):** Always test your `pdfContent` first using `netsuite_render_advanced_pdf_template` (which supports inline `pdfContent` without requiring an SDF deployment first!) so you can catch BFO XML or FreeMarker errors and visually inspect the rendered PDF before calling `netsuite_upsert_advanced_pdf_template`.
- **[Read Advanced PDF Template (`netsuite_read_advanced_pdf_template`)](./netsuite_read_advanced_pdf_template.md):** Download and inspect an existing template's `pdfContent` and header properties before updating it.
- **[Load Record Sample (`netsuite_load_record_sample`)](./netsuite_load_record_sample.md):** Inspect the exact body fields and sublists available on `${record}` for a transaction or custom record.

---

## Tool Metadata

| Property | Value |
| :--- | :--- |
| **Tool ID** | `netsuite_upsert_advanced_pdf_template` |
| **Human-Readable Name** | Upsert Advanced PDF Template |
| **Category** | `templates` (Templates — Advanced PDF & Email) |
| **Destructive (`isDestructive`)** | **`true`** |
| **Requires SDF (`requiresSdf`)** | **`true`** |
| **Default Availability** | On-demand via `netsuite_manage_toolsets` *(or enabled at startup in the `templates_localization` preset)* |

---

## Inner Workings

1. **Up-Front Validation & BFO XML Check (`upsertAdvancedPdfTemplateInSdf` in `src/utils/templates.ts`):**
   - Normalizes `scriptId` (`normalizeAdvancedPdfScriptId`, max 98 chars).
   - Validates `title` (max 297 chars) and `description` (max 4,000 chars).
   - **Customer Statement (`STATEMENT`) Guard:** Checks if `printtype` is `'STATEMENT'` and rejects it immediately with a clear explanation (NetSuite SDF's XSD schema does not support deploying Customer Statement templates).
   - **BFO `<pdf>` Root Validation (`validateBfoPdfContent`):** When `pdfContent` is provided, verifies that it is non-empty and contains opening `<pdf...>` and closing `</pdf>` root tags before spinning up SDF.

2. **Existing Template Import & Smart Property Merging:**
   - Spins up an isolated temporary SDF project (`withTempSdfProject({ tempDirPrefix: "netsuite-mcp-pdf-upsert-" })`).
   - Calls `tryImportTemplateInTempProject(tempProject, scriptId, "advancedpdftemplate")` to import `<scriptId>.xml` and `<scriptId>.template.xml` if the template already exists in NetSuite.
   - **Smart `recordtype` / `customtransaction` / `savedsearch` Routing:**
     - If `recordtype` is provided, wraps it in `[scriptid=...]`. If the ID starts with `customtransaction_`, sets `<customtransaction>[scriptid=...]</customtransaction>`, deletes `<recordtype>`, and defaults `<printtype>` to `'CUSTOMTRANSACTION'`. Otherwise sets `<recordtype>[scriptid=...]</recordtype>`, deletes `<customtransaction>`, and defaults `<printtype>` to `'CUSTOMRECORD'`.
     - If `savedsearch` is provided, wraps it in `[scriptid=...]` and defaults `<printtype>` to `'SEARCH'`.

3. **Two-File Packaging, `manifest.xml` Dependency Injection & Local Sync (`deployTemplateFromTempProject`):**
   - Writes both `<tempDir>/Objects/<scriptId>.xml` and `<tempDir>/Objects/<scriptId>.template.xml`.
   - Sets `<tempDir>/deploy.xml` to `<objects><path>~/Objects/*</path></objects>` so SuiteCloud CLI packages both the XML definition and its companion `.template.xml` file into the deployment archive.
   - Automatically adds the `ADVANCEDPRINTING` feature plus any referenced `customrecord_*`, `customtransaction_*`, or `customsearch_*` script IDs to `<tempDir>/manifest.xml`.
   - Executes `suitecloud project:deploy --accountspecificvalues WARNING`.
   - If `saveToProject` resolves to `true`, copies **both** `<scriptId>.xml` and `<scriptId>.template.xml` into your local project's `<sdfSourceDir>/Objects/...` directory and updates local `manifest.xml` dependencies.
