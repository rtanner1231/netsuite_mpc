# NetSuite MCP Server (`@rtanner1231/netsuite-dev-mcp`)

The **NetSuite Model Context Protocol (MCP) Server** bridges AI assistants (such as Claude, OpenCode, Codex, and Cursor) with your NetSuite environments. It provides 37 specialized tools for semantic schema discovery, SuiteQL querying, record operations, Saved Search and SuiteAnalytics Dataset creation, SuiteScript execution and log inspection, File Cabinet and SDF deployments, Custom Record/Field/List management, Translation Collections, and live Advanced PDF & Email Template rendering.

---

## Quick Start

### 1. Prerequisites

Before running the MCP server, ensure you have the following set up:

1. **Node.js (v20.0.0 or higher):**
   - Download and install **Node.js 20 LTS or 22 LTS** from [nodejs.org](https://nodejs.org/).
2. **SuiteCloud CLI (Required for SDF & File Deployment Tools):**
   - Install the official SuiteCloud CLI globally:
     ```bash
     npm install -g @oracle/suitecloud-cli
     ```
   - *(Note: The SuiteCloud CLI requires **Java JDK 17 or 21** installed on your machine. Once installed, authenticate your NetSuite account using `suitecloud account:setup` to create an Auth ID / `sdfId`.)*
3. **NetSuite Backend Components ([`rl_mcp_services.js`](./netsuitescripts/rl_mcp_services.js) & [`MCPSchemaLoad.html`](./netsuitescripts/MCPSchemaLoad.html)):**
   - **MCP Services RESTlet ([`netsuitescripts/rl_mcp_services.js`](./netsuitescripts/rl_mcp_services.js)):** Upload and deploy this RESTlet in your NetSuite environment, and create an OAuth 1.0a Integration Record and Access Token.
   - **MCP Schema Loader ([`netsuitescripts/MCPSchemaLoad.html`](./netsuitescripts/MCPSchemaLoad.html)):** Upload and open this utility in your NetSuite File Cabinet to extract your account's native and custom schema into a local SQLite database (`.db`).
   - *(Tip: You can also download both version-matched files with one click from the **Resources** tab inside the **`/open-settings`** web interface!)*
   - 👉 **See the [NetSuite Backend & Schema Setup Guide](./docs/netsuite-setup.md) for step-by-step instructions.**

---

### 2. Configure Your AI Harness

Add `@rtanner1231/netsuite-dev-mcp` to your AI client's MCP configuration:

<details>
<summary><b>Claude Desktop</b></summary>

Add the following to your `claude_desktop_config.json` (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS or `%APPDATA%\Claude\claude_desktop_config.json` on Windows):

```json
{
  "mcpServers": {
    "netsuite": {
      "command": "npx",
      "args": ["-y", "@rtanner1231/netsuite-dev-mcp"]
    }
  }
}
```
</details>

<details>
<summary><b>Claude Code (CLI)</b></summary>

Run the following command in your terminal:

```bash
claude mcp add netsuite -- npx -y @rtanner1231/netsuite-dev-mcp
```

Or add it to your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "netsuite": {
      "command": "npx",
      "args": ["-y", "@rtanner1231/netsuite-dev-mcp"]
    }
  }
}
```
</details>

<details>
<summary><b>OpenCode</b></summary>

Add the following to your `opencode.json` (or `~/.config/opencode/opencode.json`):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "netsuite": {
      "type": "local",
      "command": ["npx", "-y", "@rtanner1231/netsuite-dev-mcp"],
      "enabled": true
    }
  }
}
```
</details>

<details>
<summary><b>OpenAI Codex CLI</b></summary>

Add the following to your `~/.codex/config.toml`:

```toml
[mcp_servers.netsuite]
command = "npx"
args = ["-y", "@rtanner1231/netsuite-dev-mcp"]
```
</details>

<details>
<summary><b>Cursor / Windsurf / VS Code</b></summary>

Add the following to `.cursor/mcp.json` (Cursor), `~/.codeium/windsurf/mcp_config.json` (Windsurf), or `.vscode/mcp.json` (VS Code):

```json
{
  "mcpServers": {
    "netsuite": {
      "command": "npx",
      "args": ["-y", "@rtanner1231/netsuite-dev-mcp"]
    }
  }
}
```
</details>

---

### 3. First-Time Configuration (`/open-settings`)

You do not need to manually create configuration files before starting.

1. Launch your AI client and run the **`/open-settings`** MCP prompt (or ask your assistant: *"Open the NetSuite MCP settings"*).
2. The server will launch a local web interface in your browser (`http://127.0.0.1:45821/?token=...`).
3. In the Settings UI:
   - Create an environment (e.g., `Sandbox` or `Prod`), enter your NetSuite OAuth 1.0a & RESTlet credentials, and click **Test Connection**.
   - Click **Load SQLite Database (.db)...** to upload the schema database exported from `MCPSchemaLoad.html`, then click **Build / Rebuild Vector Database (.lance)**.
   - Click **Save Changes** to initialize your configuration and activate your tools.

👉 **For complete details on environments, tool profiles, security guardrails, and project settings, read the [Settings & Configuration Guide](./docs/settings.md).**

---

## Documentation

- **[NetSuite Backend & Schema Setup Guide](./docs/netsuite-setup.md)** — How to deploy the RESTlet, create OAuth 1.0a tokens, set up SuiteCloud CLI, and generate the SQLite schema database.
- **[Settings & Configuration Guide](./docs/settings.md)** — Complete guide to the Settings UI, environments, profiles, destructive/SDF guardrails, dynamic session toolsets, and project build defaults.
- **[Tools Overview](./docs/tools-overview.md)** — Categorized tables of all 37 MCP tools with descriptions and metadata.

---

## Tools List

Click any tool below to view its detailed documentation, parameters, complementary tools, and technical inner workings. For a tabular summary across all categories, see the **[Tools Overview](./docs/tools-overview.md)**.

### 1. Environment, Profile & Toolset Management
- [Open Settings](./docs/tools/netsuite_open_settings.md) (`netsuite_open_settings`)
- [List Environments](./docs/tools/netsuite_list_environments.md) (`netsuite_list_environments`)
- [Switch Environment](./docs/tools/netsuite_switch_environment.md) (`netsuite_switch_environment`)
- [Manage Toolsets](./docs/tools/netsuite_manage_toolsets.md) (`netsuite_manage_toolsets`)

### 2. Table & Schema Discovery
- [Search Tables](./docs/tools/netsuite_search_tables.md) (`netsuite_search_tables`)
- [Get Fields](./docs/tools/netsuite_get_fields.md) (`netsuite_get_fields`)
- [Get Related Tables](./docs/tools/netsuite_get_related_tables.md) (`netsuite_get_related_tables`)
- [Rebuild Vector Database](./docs/tools/netsuite_rebuild_vector_database.md) (`netsuite_rebuild_vector_database`)

### 3. Data Querying & Record Operations
- [Run SuiteQL](./docs/tools/netsuite_run_suite_ql.md) (`netsuite_run_suite_ql`)
- [Load Record Sample](./docs/tools/netsuite_load_record_sample.md) (`netsuite_load_record_sample`)
- [Upsert Record](./docs/tools/netsuite_upsert_record.md) (`netsuite_upsert_record`)

### 4. Report Creation (Saved Searches & Datasets)
- [View Saved Search](./docs/tools/netsuite_view_saved_search.md) (`netsuite_view_saved_search`)
- [Create Saved Search](./docs/tools/netsuite_create_saved_search.md) (`netsuite_create_saved_search`)
- [View Dataset](./docs/tools/netsuite_view_dataset.md) (`netsuite_view_dataset`)
- [Create Dataset](./docs/tools/netsuite_create_dataset.md) (`netsuite_create_dataset`)

### 5. Script Execution & Log Inspection
- [Run Function](./docs/tools/netsuite_run_function.md) (`netsuite_run_function`)
- [Get Script Logs](./docs/tools/netsuite_get_script_logs.md) (`netsuite_get_script_logs`)

### 6. File Cabinet & SDF Files
- [View File](./docs/tools/netsuite_view_file.md) (`netsuite_view_file`)
- [Upload File](./docs/tools/netsuite_upload_file.md) (`netsuite_upload_file`)
- [Compare Files](./docs/tools/netsuite_compare_files.md) (`netsuite_compare_files`)

### 7. Script Management
- [Deploy Script](./docs/tools/netsuite_deploy_script.md) (`netsuite_deploy_script`)
- [Get Script](./docs/tools/netsuite_get_script.md) (`netsuite_get_script`)
- [Search Scripts](./docs/tools/netsuite_search_scripts.md) (`netsuite_search_scripts`)

### 8. Custom Objects (Records, Fields & Lists)
- [View Custom Object](./docs/tools/netsuite_view_custom_object.md) (`netsuite_view_custom_object`)
- [Upsert Custom Record Type](./docs/tools/netsuite_upsert_custom_record_type.md) (`netsuite_upsert_custom_record_type`)
- [Upsert Custom Field](./docs/tools/netsuite_upsert_custom_field.md) (`netsuite_upsert_custom_field`)
- [Upsert Custom List](./docs/tools/netsuite_upsert_custom_list.md) (`netsuite_upsert_custom_list`)

### 9. Translation Collections
- [List Supported Locales](./docs/tools/netsuite_list_supported_locales.md) (`netsuite_list_supported_locales`)
- [List Translation Collections](./docs/tools/netsuite_list_translation_collections.md) (`netsuite_list_translation_collections`)
- [View Translation Collection](./docs/tools/netsuite_view_translation_collection.md) (`netsuite_view_translation_collection`)
- [Create Translation Collection](./docs/tools/netsuite_create_translation_collection.md) (`netsuite_create_translation_collection`)
- [Update Translation Collection](./docs/tools/netsuite_update_translation_collection.md) (`netsuite_update_translation_collection`)

### 10. Templates (Advanced PDF & Email)
- [List Templates](./docs/tools/netsuite_list_templates.md) (`netsuite_list_templates`)
- [Read Advanced PDF Template](./docs/tools/netsuite_read_advanced_pdf_template.md) (`netsuite_read_advanced_pdf_template`)
- [Upsert Advanced PDF Template](./docs/tools/netsuite_upsert_advanced_pdf_template.md) (`netsuite_upsert_advanced_pdf_template`)
- [Render Advanced PDF Template](./docs/tools/netsuite_render_advanced_pdf_template.md) (`netsuite_render_advanced_pdf_template`)
- [Read Email Template](./docs/tools/netsuite_read_email_template.md) (`netsuite_read_email_template`)
- [Upsert Email Template](./docs/tools/netsuite_upsert_email_template.md) (`netsuite_upsert_email_template`)
- [Render Email Template](./docs/tools/netsuite_render_email_template.md) (`netsuite_render_email_template`)
