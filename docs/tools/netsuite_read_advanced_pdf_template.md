# Read Advanced PDF Template (`netsuite_read_advanced_pdf_template`)

[← Back to Tools Overview](../tools-overview.md)

## Description & Usage

`netsuite_read_advanced_pdf_template` downloads and parses a NetSuite **Advanced PDF/HTML Template** (`custtmpl_*`) and its companion **BFO XML / FreeMarker source file** (`<scriptId>.template.xml`) from the active NetSuite environment via an isolated temporary SDF project.

### What It Returns
- **Parsed Header Properties:** `scriptId`, `standard` (e.g., `'STDTMPLCUSTINVC'` or `'STDTMPLEMPTY'`), `title`, `description`, `trantype` (e.g., `'CUSTINVC'`, `'SALESORD'`), `printtype` (`'TRANSACTION'`, `'CUSTOMRECORD'`, `'CUSTOMTRANSACTION'`, `'SEARCH'`, etc.), `recordtype`, `customtransaction`, `savedsearch`, `preferred` (`boolean`), `displaysourcecode` (`boolean`), `isinactive` (`boolean`), and `version`.
- **Full BFO XML / FreeMarker Source (`pdfContent`):** The complete contents of `<scriptId>.template.xml` (`<?xml version="1.0"?><!DOCTYPE pdf ...><pdf>...</pdf>`).
- **Raw SDF XML (`rawXml`):** The raw `<advancedpdftemplate>` XML definition.

### Input Parameters

| Parameter | Type | Required | Description |
| :--- | :--- | :---: | :--- |
| `scriptId` | `string` | **Yes** | Script ID of the Advanced PDF Template (e.g., `'custtmpl_custom_invoice'`). Automatically prepends `'custtmpl_'` if omitted. |

---

## Complementary Tools

- **[List Templates (`netsuite_list_templates`)](./netsuite_list_templates.md):** Discover available `custtmpl_*` script IDs before calling `netsuite_read_advanced_pdf_template`.
- **[Render Advanced PDF Template (`netsuite_render_advanced_pdf_template`)](./netsuite_render_advanced_pdf_template.md):** After reading `pdfContent` with `netsuite_read_advanced_pdf_template`, you can modify the BFO XML / FreeMarker in memory and pass it as inline `pdfContent` to `netsuite_render_advanced_pdf_template` to live-preview your changes as a real rendered PDF **before** deploying via SDF!
- **[Upsert Advanced PDF Template (`netsuite_upsert_advanced_pdf_template`)](./netsuite_upsert_advanced_pdf_template.md):** Deploy your updated `pdfContent` and template properties back to NetSuite once the preview looks right.

---

## Tool Metadata

| Property | Value |
| :--- | :--- |
| **Tool ID** | `netsuite_read_advanced_pdf_template` |
| **Human-Readable Name** | Read Advanced PDF Template |
| **Category** | `templates` (Templates — Advanced PDF & Email) |
| **Destructive (`isDestructive`)** | `false` |
| **Requires SDF (`requiresSdf`)** | **`true`** |
| **Default Availability** | On-demand via `netsuite_manage_toolsets` *(or enabled at startup in the `templates_localization` preset)* |

---

## Inner Workings

1. **Script ID Normalization (`normalizeAdvancedPdfScriptId` in `src/utils/templates.ts`):**
   - Strips any `.template.xml` or `.xml` suffix, lowercases, auto-prepends `custtmpl_` if missing, validates `/^custtmpl_[a-z0-9_]+$/`, and enforces NetSuite's **98-character** SDF scriptId limit.

2. **Two-File SDF Import (`tryImportTemplateInTempProject`):**
   - Spins up an isolated temporary SDF project (`withTempSdfProject({ tempDirPrefix: "netsuite-mcp-pdf-read-" })`).
   - Executes:
     ```bash
     suitecloud object:import --type advancedpdftemplate --scriptid <scriptId> --destinationfolder /Objects
     ```
   - When importing an `advancedpdftemplate`, SuiteCloud CLI writes **two** files into `<tempDir>/Objects/`:
     1. `<scriptId>.xml` (the `<advancedpdftemplate>` metadata XML).
     2. `<scriptId>.template.xml` (the BFO XML + FreeMarker body).
   - Reads both files from `<tempDir>/Objects/` and cleans up the temporary directory.

3. **XML Parsing (`parseAdvancedPdfTemplateXml`):**
   - Parses `<advancedpdftemplate>` via `xmlbuilder2`, converts SDF `'T'`/`'F'` flags (`preferred`, `displaysourcecode`, `isinactive`) into JavaScript booleans, and attaches `pdfContent` and `rawXml`.
