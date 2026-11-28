# Tools Overview

`@rtanner1231/netsuite-dev-mcp` provides **37 specialized MCP tools** organized across **10 categories**, plus **3 MCP prompts** (`/open-settings`, `/list-environments`, and `/switch-environment`).

Click any **Tool Name** in the tables below to view its dedicated documentation page, input parameters, complementary tool workflows, and technical inner workings.

---

## Understanding Tool Metadata

Every tool is tagged with metadata that determines how it interacts with your active environment and profile guardrails (configured via [`docs/settings.md`](./settings.md)):

- **Destructive (`isDestructive`):**
  - `Yes` — The tool creates, modifies, uploads, deploys, or executes code/data in NetSuite. Blocked when the active profile has `disableDestructive: true` (unless explicitly whitelisted in `allowedTools`).
  - `No` — The tool is read-only or manages local MCP settings/session state.
- **Requires SDF (`requiresSdf`):**
  - `Yes` — The tool invokes the SuiteCloud CLI inside an isolated temporary SDF project. Requires `sdfId` to be configured on the active environment and is blocked when the active profile has `disableSdf: true` (unless explicitly whitelisted in `allowedTools`).
  - `No` — The tool runs locally or via the NetSuite RESTlet / REST Metadata API without needing the SuiteCloud CLI.

---

## 1. Environment, Profile & Toolset Management

*Bootstrap and session-control tools. `netsuite_open_settings`, `netsuite_list_environments`, and `netsuite_switch_environment` are always available (even before configuration files are initialized) and also expose slash prompts (`/open-settings`, `/list-environments`, `/switch-environment`).*

| Tool Name | Tool ID | Description | Destructive | Requires SDF |
| :--- | :--- | :--- | :---: | :---: |
| [Open Settings](./tools/netsuite_open_settings.md) | `netsuite_open_settings` | Launches a local graphical settings web page in your browser to configure environments, test OAuth/RESTlet connections, manage SQLite & LanceDB databases, and customize tool profiles. | No | No |
| [List Environments](./tools/netsuite_list_environments.md) | `netsuite_list_environments` | Lists all configured NetSuite environments and their tool profiles from `env.json`, and indicates which environment, profile, and session toolsets are currently active. | No | No |
| [Switch Environment](./tools/netsuite_switch_environment.md) | `netsuite_switch_environment` | Switches the active NetSuite environment and/or tool profile in `state.json`, resets temporary session toolset overrides, and refreshes the client's tool list. | No | No |
| [Manage Toolsets](./tools/netsuite_manage_toolsets.md) | `netsuite_manage_toolsets` | Dynamically activates, deactivates, resets, or lists tool categories and individual tools in memory for the current chat session while respecting profile guardrails. | No | No |

---

## 2. Table & Schema Discovery

*Category ID: `table_discovery` — Enabled at startup by default (except `netsuite_rebuild_vector_database`, which is disabled at startup by default and available on-demand). Powered by your local SQLite `.db` schema database and LanceDB `.lance` vector store.*

| Tool Name | Tool ID | Description | Destructive | Requires SDF |
| :--- | :--- | :--- | :---: | :---: |
| [Search Tables](./tools/netsuite_search_tables.md) | `netsuite_search_tables` | Performs a natural-language semantic search against the active environment's local LanceDB vector database and returns the top 5 matching native or custom NetSuite tables. | No | No |
| [Get Fields](./tools/netsuite_get_fields.md) | `netsuite_get_fields` | Retrieves table metadata and field definitions (IDs, types, labels, descriptions, and join relationships) from the local SQLite schema database with NetSuite REST Metadata API fallback. | No | No |
| [Get Related Tables](./tools/netsuite_get_related_tables.md) | `netsuite_get_related_tables` | Traverses outgoing field joins across 1 to 5 hop levels in the local SQLite schema database to build a map of related tables and exact SuiteQL join conditions. | No | No |
| [Rebuild Vector Database](./tools/netsuite_rebuild_vector_database.md) | `netsuite_rebuild_vector_database` | Asynchronously builds or replaces the local LanceDB vector database (`.lance`) from the environment's SQLite schema database (`.db`), or checks rebuild progress when `statusOnly: true`. | No | No |

---

## 3. Data Querying & Record Operations

*Category ID: `data_operations` — Enabled at startup by default. Communicates with the deployed MCP Services RESTlet (`rl_mcp_services.js`).*

| Tool Name | Tool ID | Description | Destructive | Requires SDF |
| :--- | :--- | :--- | :---: | :---: |
| [Run SuiteQL](./tools/netsuite_run_suite_ql.md) | `netsuite_run_suite_ql` | Executes a SuiteQL query against NetSuite via the MCP RESTlet and returns mapped result rows and execution duration. | No | No |
| [Load Record Sample](./tools/netsuite_load_record_sample.md) | `netsuite_load_record_sample` | Loads a full NetSuite record in dynamic mode (`record.load`) as JSON to inspect its body fields and sublists, auto-sampling the latest record if `id` is omitted. | No | No |
| [Upsert Record](./tools/netsuite_upsert_record.md) | `netsuite_upsert_record` | Creates a new NetSuite record or updates an existing record's header/body fields in dynamic mode (`N/record`), returning the internal ID, elapsed time, and governance used. | **Yes** | No |

---

## 4. Report Creation (Saved Searches & Datasets)

*Category ID: `report_creation` — Available on-demand via `netsuite_manage_toolsets`. Uses `N/search`, `N/dataset`, and `N/query` in the MCP Services RESTlet.*

| Tool Name | Tool ID | Description | Destructive | Requires SDF |
| :--- | :--- | :--- | :---: | :---: |
| [View Saved Search](./tools/netsuite_view_saved_search.md) | `netsuite_view_saved_search` | Inspects and previews an existing NetSuite Saved Search (`customsearch_*`) in the exact JSON format accepted by `netsuite_create_saved_search`, or searches/lists saved searches when `scriptId` is omitted. | No | No |
| [Create Saved Search](./tools/netsuite_create_saved_search.md) | `netsuite_create_saved_search` | Builds, dry-runs (previews in memory with `dryRun: true`), and saves or updates (`dryRun: false`) a NetSuite Saved Search with columns, filters, filter expressions, formulas, and summary aggregations. | **Yes** | No |
| [View Dataset](./tools/netsuite_view_dataset.md) | `netsuite_view_dataset` | Inspects and previews an existing SuiteAnalytics Dataset (`custdataset_*`) including its columns, conditions, preview rows, and NetSuite-generated SuiteQL, or lists datasets when `scriptId` is omitted. | No | No |
| [Create Dataset](./tools/netsuite_create_dataset.md) | `netsuite_create_dataset` | Builds, dry-runs (previews with `dryRun: true` and returns `generatedSuiteQL`), and saves or updates (`dryRun: false`) a SuiteAnalytics Dataset using multi-hop forward, inverse, and polymorphic joins. | **Yes** | No |

---

## 5. Script Execution & Log Inspection

*Category ID: `script_execution` — Available on-demand via `netsuite_manage_toolsets` (or enabled at startup in the `developer` preset). Communicates with the MCP Services RESTlet.*

| Tool Name | Tool ID | Description | Destructive | Requires SDF |
| :--- | :--- | :--- | :---: | :---: |
| [Run Function](./tools/netsuite_run_function.md) | `netsuite_run_function` | Dynamically loads a SuiteScript module from the File Cabinet and executes an exported function with arguments, returning its result, execution time, and governance usage. | **Yes** | No |
| [Get Script Logs](./tools/netsuite_get_script_logs.md) | `netsuite_get_script_logs` | Retrieves up to the last 500 execution logs (`scriptnote`) for a NetSuite script by `scriptId` or `scriptFileName`, or fetches logs generated by `netsuite_run_function` when `runFunctionLogs: true`. | No | No |

---

## 6. File Cabinet & SDF Files

*Category ID: `sdf_file_deployment` — Available on-demand via `netsuite_manage_toolsets` (or enabled at startup in the `developer` preset). Uses the MCP RESTlet for viewing File Cabinet files and the SuiteCloud CLI inside an isolated temporary SDF project for uploading and diffing files.*

| Tool Name | Tool ID | Description | Destructive | Requires SDF |
| :--- | :--- | :--- | :---: | :---: |
| [View File](./tools/netsuite_view_file.md) | `netsuite_view_file` | Views any File Cabinet file by `fileId` or `filePath` via the MCP RESTlet, returning paginated text for code/text files or embedded MCP image/resource previews for images and PDFs. | No | No |
| [Upload File](./tools/netsuite_upload_file.md) | `netsuite_upload_file` | Conditionally builds the local project, maps `.ts`/`.js` paths to NetSuite File Cabinet paths, and uploads files via `suitecloud file:upload` inside an isolated temporary SDF project. | **Yes** | **Yes** |
| [Compare Files](./tools/netsuite_compare_files.md) | `netsuite_compare_files` | Conditionally builds the local project, imports deployed files from the NetSuite File Cabinet into a temporary SDF project, and returns unified diffs against local files. | No | **Yes** |

---

## 7. Script Management

*Category ID: `script_management` — Available on-demand via `netsuite_manage_toolsets` (or enabled at startup in the `developer` and `admin` presets). Combines SuiteQL discovery with atomic SDF deployments.*

| Tool Name | Tool ID | Description | Destructive | Requires SDF |
| :--- | :--- | :--- | :---: | :---: |
| [Deploy Script](./tools/netsuite_deploy_script.md) | `netsuite_deploy_script` | Atomically creates or updates a NetSuite Script record (`customscript_*` or `custevsub_*`), its parameters (`custscript_*`), deployments/schedules (`customdeploy_*`), and File Cabinet `.js` file with duplicate-script protection. | **Yes** | **Yes** |
| [Get Script](./tools/netsuite_get_script.md) | `netsuite_get_script` | Loads comprehensive metadata for a Script record and all of its deployments by `scriptId` or `filePath`, mapping File Cabinet paths to local `.ts`/`.js`/`Objects/*.xml` files and optionally importing full SDF XML. | No | No |
| [Search Scripts](./tools/netsuite_search_scripts.md) | `netsuite_search_scripts` | Searches NetSuite Script records and Script Deployments via SuiteQL with filters for target `recordType`, `scriptType`, `searchTerm`, `fileName`, `isDeployed`, `status`, and `logLevel`. | No | No |

---

## 8. Custom Objects (Records, Fields & Lists)

*Category ID: `custom_objects` — Available on-demand via `netsuite_manage_toolsets` (or enabled at startup in the `admin` preset). Runs inside an isolated temporary SDF project and optionally syncs XML files to your local repository.*

| Tool Name | Tool ID | Description | Destructive | Requires SDF |
| :--- | :--- | :--- | :---: | :---: |
| [View Custom Object](./tools/netsuite_view_custom_object.md) | `netsuite_view_custom_object` | Downloads and parses a Custom Record Type (`customrecord_*`), Custom List (`customlist_*`), or standalone Custom Field (`custbody_*`, `custcol_*`, etc.) into the exact JSON format accepted by the upsert tools, or lists custom objects when `scriptId` is omitted. | No | **Yes** |
| [Upsert Custom Record Type](./tools/netsuite_upsert_custom_record_type.md) | `netsuite_upsert_custom_record_type` | Creates or updates a Custom Record Type (`customrecord_*`) and its custom fields (`custrecord_*`) via SDF, downloading and merging existing definitions in-place and resolving `manifest.xml` dependencies. | **Yes** | **Yes** |
| [Upsert Custom Field](./tools/netsuite_upsert_custom_field.md) | `netsuite_upsert_custom_field` | Creates or updates one or more standalone Custom Fields across all 8 native NetSuite custom field categories (`transaction_body`, `transaction_line`, `crm`, `item`, `entity`, `other_record`, `item_option`, `item_number`) in a single SDF deployment. | **Yes** | **Yes** |
| [Upsert Custom List](./tools/netsuite_upsert_custom_list.md) | `netsuite_upsert_custom_list` | Creates or updates a Custom List (`customlist_*`) and its list values via SDF, merging new values, updating existing value labels by `scriptId`, and deduplicating identical labels. | **Yes** | **Yes** |

---

## 9. Translation Collections

*Category ID: `translations` — Available on-demand via `netsuite_manage_toolsets` (or enabled at startup in the `templates_localization` preset). Combines `N/translation` via the MCP RESTlet with SDF `<translationcollection>` XML and XLIFF 1.2 (`.xlf`) deployments.*

| Tool Name | Tool ID | Description | Destructive | Requires SDF |
| :--- | :--- | :--- | :---: | :---: |
| [List Supported Locales](./tools/netsuite_list_supported_locales.md) | `netsuite_list_supported_locales` | Returns the active/supported languages (locales) configured in the NetSuite environment, including their SDF/XLIFF code (`es-ES`), SuiteScript code (`es_ES`), display name, and default language status. | No | No |
| [List Translation Collections](./tools/netsuite_list_translation_collections.md) | `netsuite_list_translation_collections` | Lists all Translation Collections (`custcollection_*`) in the active NetSuite environment via `suitecloud object:list --type translationcollection`. | No | **Yes** |
| [View Translation Collection](./tools/netsuite_view_translation_collection.md) | `netsuite_view_translation_collection` | Downloads a Translation Collection's XML definition via SDF and calls the MCP RESTlet (`N/translation`) to resolve translated values across requested or active NetSuite locales. | No | **Yes** |
| [Create Translation Collection](./tools/netsuite_create_translation_collection.md) | `netsuite_create_translation_collection` | Creates and deploys a new NetSuite Translation Collection (`custcollection_*`) along with per-locale XLIFF 1.2 (`.xlf`) translation files via an isolated temporary SDF project. | **Yes** | **Yes** |
| [Update Translation Collection](./tools/netsuite_update_translation_collection.md) | `netsuite_update_translation_collection` | Updates an existing Translation Collection (`custcollection_*`) by downloading its current SDF XML, fetching existing locale translations via `N/translation` to preserve them, merging updates, and deploying the XML and `.xlf` files. | **Yes** | **Yes** |

---

## 10. Templates (Advanced PDF & Email)

*Category ID: `templates` — Available on-demand via `netsuite_manage_toolsets` (or enabled at startup in the `templates_localization` preset). Uses the SuiteCloud CLI inside an isolated temporary SDF project for template definitions and the MCP RESTlet (`N/render`) for live PDF and HTML email rendering.*

| Tool Name | Tool ID | Description | Destructive | Requires SDF |
| :--- | :--- | :--- | :---: | :---: |
| [List Templates](./tools/netsuite_list_templates.md) | `netsuite_list_templates` | Lists custom Advanced PDF/HTML Templates (`custtmpl_*`) and/or Email Templates (`custemailtmpl_*`) in the active NetSuite environment via `suitecloud object:list`. | No | **Yes** |
| [Read Advanced PDF Template](./tools/netsuite_read_advanced_pdf_template.md) | `netsuite_read_advanced_pdf_template` | Downloads and parses an Advanced PDF/HTML Template (`custtmpl_*`) and its companion BFO XML / FreeMarker source file (`<scriptId>.template.xml`) via SDF. | No | **Yes** |
| [Upsert Advanced PDF Template](./tools/netsuite_upsert_advanced_pdf_template.md) | `netsuite_upsert_advanced_pdf_template` | Creates or updates an Advanced PDF/HTML Template (`custtmpl_*`) and its companion `<scriptId>.template.xml` file in NetSuite via SDF, merging existing properties on update. | **Yes** | **Yes** |
| [Render Advanced PDF Template](./tools/netsuite_render_advanced_pdf_template.md) | `netsuite_render_advanced_pdf_template` | Live-renders a deployed (`scriptId`) or inline (`pdfContent`) Advanced PDF Template via `N/render` with bound records, saved searches, or custom data, returning an embedded PDF resource and local preview file. | No | No |
| [Read Email Template](./tools/netsuite_read_email_template.md) | `netsuite_read_email_template` | Downloads and parses an Email Template (`custemailtmpl_*`) and its companion inline HTML / FreeMarker file (`<scriptId>.template.html`) or File Cabinet `<mediaitem>` reference via SDF. | No | **Yes** |
| [Upsert Email Template](./tools/netsuite_upsert_email_template.md) | `netsuite_upsert_email_template` | Creates or updates an Email Template (`custemailtmpl_*`) and its companion `<scriptId>.template.html` file or File Cabinet `<mediaitem>` reference in NetSuite via SDF. | **Yes** | **Yes** |
| [Render Email Template](./tools/netsuite_render_email_template.md) | `netsuite_render_email_template` | Live-renders a deployed Email Template (`custemailtmpl_*`) via `N/render.mergeEmail` with bound transaction, entity, recipient, custom record, or support case records, returning the merged subject, HTML body, and preview file. | No | No |
