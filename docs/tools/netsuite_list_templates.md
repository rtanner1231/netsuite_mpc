# List Templates (`netsuite_list_templates`)

[← Back to Tools Overview](../tools-overview.md)

## Description & Usage

`netsuite_list_templates` lists custom **Advanced PDF/HTML Templates** (`custtmpl_*`) and/or **Email Templates** (`custemailtmpl_*`) deployed in the active NetSuite environment by running `suitecloud object:list` inside an isolated temporary SDF project.

### When to Use It
- **Discovering existing PDF or Email templates:** Call `netsuite_list_templates` to find the exact `custtmpl_*` or `custemailtmpl_*` script IDs in NetSuite before reading, updating, or rendering them.

### Input Parameters

| Parameter | Type | Required | Description |
| :--- | :--- | :---: | :--- |
| `type` | `"all"` \| `"advancedpdftemplate"` \| `"emailtemplate"` | No | Optional filter for the template type to list: `'advancedpdftemplate'` (`custtmpl_*`), `'emailtemplate'` (`custemailtmpl_*`), or `'all'` (default). |

---

## Complementary Tools

- **[Read Advanced PDF Template (`netsuite_read_advanced_pdf_template`)](./netsuite_read_advanced_pdf_template.md):** Pass a `custtmpl_*` `scriptId` from `netsuite_list_templates` to inspect its XML definition and BFO XML / FreeMarker source code (`<scriptId>.template.xml`).
- **[Render Advanced PDF Template (`netsuite_render_advanced_pdf_template`)](./netsuite_render_advanced_pdf_template.md):** Live-render a `custtmpl_*` template against a transaction, custom record, or saved search.
- **[Read Email Template (`netsuite_read_email_template`)](./netsuite_read_email_template.md):** Pass a `custemailtmpl_*` `scriptId` from `netsuite_list_templates` to inspect its XML definition and HTML / FreeMarker body (`<scriptId>.template.html`).
- **[Render Email Template (`netsuite_render_email_template`)](./netsuite_render_email_template.md):** Live-render a `custemailtmpl_*` template via `N/render.mergeEmail`.

---

## Tool Metadata

| Property | Value |
| :--- | :--- |
| **Tool ID** | `netsuite_list_templates` |
| **Human-Readable Name** | List Templates |
| **Category** | `templates` (Templates — Advanced PDF & Email) |
| **Destructive (`isDestructive`)** | `false` |
| **Requires SDF (`requiresSdf`)** | **`true`** |
| **Default Availability** | On-demand via `netsuite_manage_toolsets` *(or enabled at startup in the `templates_localization` preset)* |

---

## Inner Workings

1. **Isolated Temporary SDF Project Execution (`listSdfTemplates` in `src/utils/templates.ts`):**
   - Normalizes `type` to `'all'`, `'advancedpdftemplate'`, or `'emailtemplate'`.
   - Spins up a temporary SDF project (`withTempSdfProject({ tempDirPrefix: "netsuite-mcp-tmpl-list-" })`) bound to the active environment's `sdfId`.
   - Executes `suitecloud object:list --type advancedpdftemplate` and/or `suitecloud object:list --type emailtemplate`.

2. **Output Parsing & Deduplication:**
   - Parses each line of `stdout`:
     - Matches Advanced PDF Template IDs against `/(?:^|:)(custtmpl_[a-zA-Z0-9_]+)$/i`.
     - Matches Email Template IDs against `/(?:^|:)(custemailtmpl_[a-zA-Z0-9_]+)$/i`.
   - Deduplicates script IDs case-insensitively and returns `{ filter, advancedPdfTemplatesCount, advancedPdfTemplates, emailTemplatesCount, emailTemplates }`.
   - Removes the temporary SDF directory automatically in a `finally` block.
