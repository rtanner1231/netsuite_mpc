# Upsert Email Template (`netsuite_upsert_email_template`)

[← Back to Tools Overview](../tools-overview.md)

## Description & Usage

`netsuite_upsert_email_template` creates a new NetSuite **Email Template** (`custemailtmpl_*`) and its companion inline **HTML / FreeMarker file** (`<scriptId>.template.html`) or File Cabinet `<mediaitem>` reference, or updates an existing Email Template via an isolated temporary SDF project.

### Two Body Storage Modes (`htmlContent` vs. `mediaItemPath`)
NetSuite Email Templates support two mutually exclusive body storage modes:
1. **Inline HTML / FreeMarker (`htmlContent` — Recommended):** Writes your HTML + FreeMarker body to `<scriptId>.template.html` alongside `<scriptId>.xml` with `<usesmedia>F</usesmedia>`.
2. **File Cabinet Media Item (`mediaItemPath`):** References an `.html`, `.htm`, `.ftl`, or `.txt` file in the NetSuite File Cabinet (`<usesmedia>T</usesmedia>` and `<mediaitem>[/Templates/...]</mediaitem>`). If you switch an existing template from `htmlContent` to `mediaItemPath`, the tool automatically cleans up any stale `<scriptId>.template.html` companion file.

### Input Parameters

| Parameter | Type | Required | Description |
| :--- | :--- | :---: | :--- |
| `scriptId` | `string` | **Yes** | Script ID of the Email Template (auto-prepended with `'custemailtmpl_'` if omitted; max 99 characters). |
| `name` | `string` | Conditional | Display name of the Email Template (`<name>`, max 60 characters). Required when creating a new template; optional on update. |
| `subject` | `string` | No | Email subject line (`<subject>`, max 199 characters). Supports FreeMarker expressions (e.g., `'Order ${transaction.tranid} Confirmation'`). |
| `htmlContent` | `string` | Conditional* | Inline HTML / FreeMarker body written to `<scriptId>.template.html` (`<usesmedia>F</usesmedia>`). Mutually exclusive with `mediaItemPath`. |
| `mediaItemPath` | `string` | Conditional* | File Cabinet path ending in `.html`, `.htm`, `.ftl`, or `.txt` (e.g., `'/Templates/E-mail Templates/welcome.html'`), setting `<usesmedia>T</usesmedia>` and `<mediaitem>[...]</mediaitem>`. Mutually exclusive with `htmlContent`. |
| `recordtype` | `"CUSTOM"` \| `"ENTITY"` \| `"EVENT"` \| `"PROJECT"` \| `"TRANSACTION"` | No | Target record category (`<recordtype>`). |
| `addunsubscribelink` | `boolean` | No | Whether to append an unsubscribe link (`<addunsubscribelink>`, defaults to `true` on creation; set to `false` for transactional emails). |
| `addcompanyaddress` | `boolean` | No | Whether to append the company address (`<addcompanyaddress>`, defaults to `true` on creation). |
| `isprivate` | `boolean` | No | Whether the template is private (`<isprivate>`, defaults to `false` on creation). |
| `description` | `string` | No | Template description (`<description>`, max 1,000 characters). |
| `isinactive` | `boolean` | No | Mark template inactive (`<isinactive>`, defaults to `false` on creation). |
| `saveToProject` | `boolean` | No | Override whether `<scriptId>.xml` and `<scriptId>.template.html` (plus `manifest.xml` dependencies) are copied into your local project (`Objects/`). |

*\*When creating a new Email Template, `name` and either `htmlContent` or `mediaItemPath` are required.*

---

## Complementary Tools

- **[Read Email Template (`netsuite_read_email_template`)](./netsuite_read_email_template.md):** Inspect an existing email template's `subject`, `htmlContent`, and flags before updating it with `netsuite_upsert_email_template`.
- **[Render Email Template (`netsuite_render_email_template`)](./netsuite_render_email_template.md):** Immediately test and preview the deployed email template against real or auto-sampled records via `N/render.mergeEmail`.
- **[Load Record Sample (`netsuite_load_record_sample`)](./netsuite_load_record_sample.md):** Discover field names on transactions, entities, or custom records before writing FreeMarker expressions (`${transaction.*}`, `${customer.*}`, `${customRecord.*}`).

---

## Tool Metadata

| Property | Value |
| :--- | :--- |
| **Tool ID** | `netsuite_upsert_email_template` |
| **Human-Readable Name** | Upsert Email Template |
| **Category** | `templates` (Templates — Advanced PDF & Email) |
| **Destructive (`isDestructive`)** | **`true`** |
| **Requires SDF (`requiresSdf`)** | **`true`** |
| **Default Availability** | On-demand via `netsuite_manage_toolsets` *(or enabled at startup in the `templates_localization` preset)* |

---

## Inner Workings

1. **Up-Front Validation (`upsertEmailTemplateInSdf` in `src/utils/templates.ts`):**
   - Normalizes `scriptId` (`normalizeEmailTemplateScriptId`, max 99 chars).
   - Validates `name` (max 60 chars), `subject` (max 199 chars), `description` (max 1,000 chars), and `recordtype` (`CUSTOM`, `ENTITY`, `EVENT`, `PROJECT`, `TRANSACTION`).
   - Rejects calls that pass both `htmlContent` and `mediaItemPath`.
   - If `mediaItemPath` is provided, `normalizeMediaItemPath` normalizes slashes, ensures a leading `/`, validates the file extension (`.html`, `.htm`, `.ftl`, `.txt`), and wraps it in brackets (`[/Templates/...]`).

2. **Existing Template Import & Merge:**
   - Spins up an isolated temporary SDF project (`withTempSdfProject({ tempDirPrefix: "netsuite-mcp-email-upsert-" })`).
   - Calls `tryImportTemplateInTempProject(tempProject, scriptId, "emailtemplate")`.
   - If the template already exists in NetSuite, merges provided properties onto the parsed `<emailtemplate>` object and preserves existing `htmlContent` (or `mediaitem`) if not overridden.
   - If the template does not exist yet, validates that `name` and either `htmlContent` or `mediaItemPath` were provided.

3. **Companion File Packaging, `manifest.xml` Dependencies & Local Sync (`deployTemplateFromTempProject`):**
   - Writes `<tempDir>/Objects/<scriptId>.xml` and (when `usesmedia` is `F`) `<tempDir>/Objects/<scriptId>.template.html`.
   - If an existing template switched from `usesmedia = F` to `usesmedia = T` (`mediaItemPath`), deletes any stale `<scriptId>.template.html` in both the temp project and local project (`staleCompanionFileNameToDelete`).
   - Automatically adds the `CRM` feature dependency (and `<files><file>/...</file></files>` if `usesmedia = T`) to `<tempDir>/manifest.xml`.
   - Sets `<tempDir>/deploy.xml` to `<objects><path>~/Objects/*</path></objects>` and runs `suitecloud project:deploy --accountspecificvalues WARNING`.
   - If `saveToProject` resolves to `true`, copies `<scriptId>.xml` and `<scriptId>.template.html` into your local project's `<sdfSourceDir>/Objects/...` directory and updates local `manifest.xml` dependencies.
