# Read Email Template (`netsuite_read_email_template`)

[← Back to Tools Overview](../tools-overview.md)

## Description & Usage

`netsuite_read_email_template` downloads and parses a NetSuite **Email Template** (`custemailtmpl_*`) and its companion inline **HTML / FreeMarker body** (`<scriptId>.template.html`) or File Cabinet media item reference (`<mediaitem>`) from the active NetSuite environment via an isolated temporary SDF project.

### What It Returns
- **Parsed Metadata:** `scriptId`, `name`, `subject` (including any FreeMarker expressions like `Order ${transaction.tranid}`), `description`, `recordtype` (`'TRANSACTION'`, `'ENTITY'`, `'CUSTOM'`, `'EVENT'`, `'PROJECT'`), `usesmedia` (`boolean`), `mediaitem` (when `usesmedia: true`, e.g., `'[/Templates/E-mail Templates/welcome.html]'`), `addunsubscribelink` (`boolean`), `addcompanyaddress` (`boolean`), `isprivate` (`boolean`), `isinactive` (`boolean`), and `version`.
- **Inline HTML / FreeMarker Body (`htmlContent`):** The contents of `<scriptId>.template.html` when `usesmedia` is `false`.
- **Raw SDF XML (`rawXml`):** The raw `<emailtemplate>` XML string.

### Input Parameters

| Parameter | Type | Required | Description |
| :--- | :--- | :---: | :--- |
| `scriptId` | `string` | **Yes** | Script ID of the Email Template (e.g., `'custemailtmpl_order_confirm'`). Automatically prepends `'custemailtmpl_'` if omitted. |

---

## Complementary Tools

- **[List Templates (`netsuite_list_templates`)](./netsuite_list_templates.md):** Discover available `custemailtmpl_*` script IDs in the active NetSuite environment.
- **[View File (`netsuite_view_file`)](./netsuite_view_file.md):** If the email template has `usesmedia: true` and references a File Cabinet file in `mediaitem` (e.g., `'[/Templates/E-mail Templates/welcome.html]'`), pass that path to `netsuite_view_file` to read its HTML content from the File Cabinet.
- **[Upsert Email Template (`netsuite_upsert_email_template`)](./netsuite_upsert_email_template.md):** Update the email template's `subject`, `htmlContent`, `mediaItemPath`, or flags after inspecting it with `netsuite_read_email_template`.
- **[Render Email Template (`netsuite_render_email_template`)](./netsuite_render_email_template.md):** Live-render the email template against sample records via `N/render.mergeEmail`.

---

## Tool Metadata

| Property | Value |
| :--- | :--- |
| **Tool ID** | `netsuite_read_email_template` |
| **Human-Readable Name** | Read Email Template |
| **Category** | `templates` (Templates — Advanced PDF & Email) |
| **Destructive (`isDestructive`)** | `false` |
| **Requires SDF (`requiresSdf`)** | **`true`** |
| **Default Availability** | On-demand via `netsuite_manage_toolsets` *(or enabled at startup in the `templates_localization` preset)* |

---

## Inner Workings

1. **Script ID Normalization (`normalizeEmailTemplateScriptId` in `src/utils/templates.ts`):**
   - Strips any `.template.html` or `.xml` suffix, lowercases, auto-prepends `custemailtmpl_` if missing, validates `/^custemailtmpl_[a-z0-9_]+$/`, and enforces NetSuite's **99-character** SDF scriptId limit.

2. **Isolated SDF Import (`tryImportTemplateInTempProject`):**
   - Spins up a temporary SDF project (`withTempSdfProject({ tempDirPrefix: "netsuite-mcp-email-read-" })`).
   - Executes:
     ```bash
     suitecloud object:import --type emailtemplate --scriptid <scriptId> --destinationfolder /Objects
     ```
   - Reads `<tempDir>/Objects/<scriptId>.xml` and, if present (`usesmedia = F`), `<tempDir>/Objects/<scriptId>.template.html`.
   - Automatically deletes the temporary directory on completion.

3. **XML Parsing (`parseEmailTemplateXml`):**
   - Parses `<emailtemplate>` via `xmlbuilder2`, converts SDF `'T'`/`'F'` flags (`usesmedia`, `addunsubscribelink`, `addcompanyaddress`, `isprivate`, `isinactive`) into JavaScript booleans, and returns the structured JSON payload.
