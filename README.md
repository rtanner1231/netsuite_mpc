> ⚠️ **WORK IN PROGRESS**: This project is currently under active development.

# NetSuite MCP Server

The NetSuite Model Context Protocol (MCP) Server is a powerful bridge that allows AI assistants (like Claude, ChatGPT, or custom agents) to securely interact with your NetSuite environment. It exposes a set of tools to query, update, and manage your NetSuite data and configurations using NetSuite's RESTlet and OAuth 1.0a mechanisms.

## Features

The server exposes the following MCP tools to interact directly with NetSuite, organized by category:

### 1. Environment, Profile & Toolset Management
*(Always available, even before `env.json` or `state.json` is initialized)*

- **`netsuite_open_settings`** *(Prompt: `open-settings` — "Open NetSuite Settings")*: Launch a local graphical web interface in your browser to add, edit, or delete NetSuite environments, test OAuth/RESTlet connections, upload SQLite schema databases (`.db`) and trigger LanceDB vector database (`.lance`) rebuilds with live progress, configure per-environment tool profiles (`default`, `developer`, `admin`, etc.) with category toggles and security guardrails (`disableDestructive`, `disableSdf`, `allowDynamicActivation`, `blockedTools`), and customize global `config.json` defaults. Automatically creates the configuration directory and files on first save.
- **`netsuite_list_environments`** *(Prompt: `list-environments` — "List NetSuite Environments")*: List all configured NetSuite environments and their tool profiles from `env.json`, and indicate which environment, profile, and dynamic session toolsets are currently active.
- **`netsuite_switch_environment`** *(Prompt: `switch-environment` — "Switch NetSuite Environment / Profile", optional `environment` and `profile` arguments)*: Switch the active NetSuite environment and/or tool profile by updating (or initializing) `state.json`, resetting any temporary session toolset overrides, re-evaluating profile tool restrictions, and notifying the MCP client that available tools may have changed.
- **`netsuite_manage_toolsets`**: Dynamically activate, deactivate, reset, or list NetSuite tool categories (`categories`: `table_discovery`, `data_operations`, `script_execution`, `sdf_file_deployment`, `script_management`, `custom_objects`, `translations`, `templates`) and/or individual tools (`tools`, e.g., `["netsuite_view_file"]`) in-memory for the current MCP chat session without modifying `env.json`. Allows the server to start with a lean default footprint (`table_discovery` + `data_operations`) and unlock either specific tools or full categories on-demand while strictly respecting the active profile's hard security guardrails (`disableDestructive`, `disableSdf`, `blockedCategories`, and `blockedTools`).

### 2. Table & Schema Discovery
*(Powered by the local SQLite `.db` schema database and LanceDB `.lance` vector store, with NetSuite REST Metadata API fallback)*

- **`netsuite_search_tables`**: Perform a natural-language semantic search against the local LanceDB vector database to discover relevant native or custom NetSuite tables. Returns the top 5 matches with table descriptions, custom record indicators, and column summaries.
- **`netsuite_get_fields`**: Retrieve table metadata (label, description, custom record status) and field definitions (IDs, types, labels, descriptions, and join relationships) for a specific NetSuite table (`table_id`) from the local SQLite schema database. Automatically falls back to the NetSuite REST Metadata API if the table is not found locally (or when `useFallback: true` is specified).
- **`netsuite_get_related_tables`**: Build a map of related NetSuite tables starting from a given `table_id` by traversing outgoing field joins across hop levels (`max_depth` from 1 to 5, default `2`). Outputs exact join conditions (e.g., `source.field = target.id`) and supports options to include/exclude custom lists (`customlist_*`) or expand polymorphic transaction subtypes.
- **`netsuite_rebuild_vector_database`**: Asynchronously build or replace the local LanceDB vector database (`<environment>.lance`) from the active environment's SQLite schema database (`<environment>.db`), indexing table and field metadata into embeddings for `netsuite_search_tables`. Pass `statusOnly: true` to check the status and progress of an active/previous rebuild (phase, indexed table counts, elapsed time) or verify whether an existing vector database is ready on disk without starting a new rebuild.

### 3. Data Querying & Record Operations
*(Requires the MCP RESTlet deployed in NetSuite)*

- **`netsuite_run_suite_ql`**: Execute SuiteQL queries against your NetSuite instance via the MCP RESTlet and return mapped result rows along with the execution duration (`timeElapsedMS`).
- **`netsuite_load_record_sample`**: Load a full NetSuite record in dynamic mode (`record.load`) as JSON to inspect its body fields and sublist structure. Accepts a `record_type` and an optional `id`—if `id` is omitted, it automatically searches for and samples the most recently created record of that type.
- **`netsuite_upsert_record`** *(Destructive)*: Create a new NetSuite record (`record.create`) or update an existing record (`record.load` when optional `id` is provided) in dynamic mode for a given `table_id` and set an array of body `fields` (`{ fieldId, value }`), returning the saved internal `recordId`, `operation` (`"create"` or `"update"`), elapsed time (`timeElapsedMS`), and governance units used (`governanceUsed`). Automatically converts ISO date/datetime strings to JavaScript `Date` objects for date fields.

### 4. Script Execution & Log Inspection
*(Requires the MCP RESTlet deployed in NetSuite)*

- **`netsuite_run_function`** *(Destructive)*: Dynamically load a SuiteScript module from the File Cabinet and execute an exported server-side function with a provided `args` array. Automatically maps `TypeScripts/*.ts` paths to `/SuiteScripts/*.js`, supports dot notation for nested exported functions (e.g., `__test.func1`), and returns the execution `result`, elapsed time (`timeElapsedMS`), and governance units used (`governanceUsed`). Pair with `netsuite_get_script_logs` (with `runFunctionLogs: true`) to inspect `N/log` output.
- **`netsuite_get_script_logs`**: Fetch up to the last 500 execution logs (`scriptnote`) for a specific deployed NetSuite script by its file name (`scriptFileName`), or pass `runFunctionLogs: true` to fetch the last 500 execution logs generated by calls to `netsuite_run_function` (from the configured MCP Services RESTlet `scriptId` and `deploymentId`).

### 5. File Cabinet & SDF Files
*(Uses the MCP RESTlet `N/file` module for direct File Cabinet inspection across all folders, and SuiteCloud CLI with `sdfId` inside an isolated temporary SDF project for uploading and comparing local vs. deployed script files without mutating your repository's `project.json` or `deploy.xml`)*

- **`netsuite_view_file`**: View any file in the NetSuite File Cabinet by internal ID (`fileId`) or File Cabinet path / file name (`filePath`) via the MCP RESTlet (`N/file`). For text files (scripts, JSON, XML, HTML, FreeMarker, CSV, CSS, etc.), returns the file metadata and text content directly with optional line-range pagination (`startLine`, `endLine`, `maxChars`). For visual and binary files such as PDFs and images (`.png`, `.jpg`, `.gif`, `.webp`, etc.), saves a temporary local copy (`previewFilePath`) in an auto-cleaned preview directory and returns an embedded MCP image (`type: "image"`) or binary resource (`type: "resource"`) so the agent can visually inspect the file.
- **`netsuite_upload_file`** *(Destructive)*: Upload an array of script files directly to the NetSuite File Cabinet using the SuiteCloud CLI (`suitecloud file:upload`) inside an isolated temporary SDF project. Conditionally runs the project build command (auto-detected or configured via `buildBeforeUpload` / `buildCommand`), resolves TypeScript (`.ts`) paths to compiled JavaScript (`.js`) File Cabinet paths via `tsconfig.json` (supporting both separate `rootDir`/`outDir` and intermingled in-place layouts) or explicit configuration, stages the compiled files in the temporary SDF project configured with the active environment's `sdfId`, and uploads them without modifying the workspace's `project.json`.
- **`netsuite_compare_files`**: Compare local files against the versions currently deployed in the NetSuite File Cabinet and return an array of unified diffs. Conditionally builds the project first, resolves `.ts` or `.js` paths to their NetSuite File Cabinet paths, imports the remote files into an isolated temporary SDF project via `suitecloud file:import`, and computes the diff for each file.

### 6. Script Management
*(Combines SuiteQL via the MCP RESTlet for fast script/deployment discovery and SuiteCloud CLI inside an isolated temporary SDF project for full script record & deployment creation/updates)*

- **`netsuite_deploy_script`** *(Destructive)*: Create or update (upsert) a NetSuite Script record (`customscript_*` or `custevsub_*`), its script parameters (`custscript_*`), and its deployments and schedules (`customdeploy_*`) or Event Subscriber subscription `criteria`, while conditionally building and uploading the script file (`.ts` or `.js` plus optional `additionalFiles`) in a single atomic SDF deployment. Supports all standard SuiteScript 2.x types (`USEREVENT`, `CLIENT`, `MAPREDUCE`, `SCHEDULED`, `SUITELET`, `RESTLET`, `WORKFLOWACTION`, `MASSUPDATE`, `PORTLET`, `BUNDLEINSTALLATION`, `EVENTSUBSCRIBER`) with automatic `@NScriptType` detection from the file header. Includes **duplicate-script protection**: if a script file already has an existing script record in NetSuite or locally with a different `scriptId`, the tool halts and reports the existing `scriptId` unless `forceCreateNewScript: true` is explicitly passed. Optionally copies the deployed XML and `manifest.xml` dependencies into your local project (`saveToProject`).
- **`netsuite_get_script`**: Load comprehensive metadata for a NetSuite Script record and all of its deployments (or Event Subscriber criteria) from either a `scriptId` (`customscript_*`, `custevsub_*`, or numeric internal ID) or a `filePath` (`.ts`/`.js` path or file name). Resolves the exact File Cabinet path via SuiteQL, maps it back to local workspace `.ts`/`.js` files and `Objects/<scriptId>.xml`, reports deployment status, target `recordType`, `logLevel`, and effective active status, and supports an optional `includeSdfXml: true` flag to download and parse the full SDF XML definition (including parameter definitions, parameter override values, recurrence schedules, and Event Subscriber `<criteria>`).
- **`netsuite_search_scripts`**: Search NetSuite Script records and Script Deployments via SuiteQL with filters for the target `recordType` deployed against (e.g., `'salesorder'`, `'customer'`, `'customrecord_...'`), `scriptType`, partial `searchTerm` (matching script name, `customscript_*`, `custevsub_*`, `customdeploy_*`, deployment title, or file name), `fileName`, `isDeployed`, deployment `status` (`RELEASED`, `TESTING`, `NOTSCHEDULED`, `SCHEDULED`), `logLevel`, and `includeInactive`.

### 7. Custom Objects (Records & Lists)
*(Requires SuiteCloud CLI and `sdfId` configured in `env.json`; deployments run inside an isolated temporary SDF project and optionally sync XML definitions into your local project)*

- **`netsuite_create_custom_record`** *(Destructive)*: Create and deploy a new Custom Record Type (`customrecord_*`) and its custom fields (`custrecord_*`) to NetSuite via an isolated temporary SDF project. Supports record `description` and `aiDescription` (`aidescription`), field `description` and `helpText`, field types, `SELECT`/`MULTISELECT` record references, automatic `manifest.xml` dependency resolution, and default record/field properties from `config.json`. Includes an optional `saveToProject` parameter (whose description dynamically reports the current effective default) to control whether the deployed XML file and `manifest.xml` dependencies are copied into your local project after deployment succeeds.
- **`netsuite_update_custom_record`** *(Destructive)*: Update and redeploy an existing Custom Record Type (`customrecord_*`) via an isolated temporary SDF project. Downloads the latest XML definition from NetSuite into the temporary project, updates header properties (`name`, `description`, `aiDescription`, `includeNameField`) and/or appends new custom fields (`custrecord_*`), recalculates `manifest.xml` dependencies, deploys the updated object, and optionally copies the updated XML into your local project (`saveToProject`).
- **`netsuite_upsert_custom_list`** *(Destructive)*: Create or update (upsert) a Custom List (`customlist_*`) and its list values in NetSuite via an isolated temporary SDF project. If the custom list already exists in NetSuite, its current definition is downloaded and merged: incoming values with a matching `scriptId` update the existing item's label, incoming values whose label already exists under a different `scriptId` are deduplicated (skipped), and new values are appended. If the list does not exist, a new Custom List is created (`name` required on creation) with any default list properties configured in `config.json` applied. Optionally copies the deployed XML into your local project (`saveToProject`).

### 8. Translation Collections
*(Uses the MCP RESTlet for `N/translation` & locale discovery, and SuiteCloud CLI inside an isolated temporary SDF project for `<translationcollection>` XML and XLIFF `.xlf` operations)*

- **`netsuite_list_supported_locales`**: Returns the active/supported languages (locales) configured in the current NetSuite environment via the MCP RESTlet, including their SDF/XLIFF locale code (e.g., `es-ES`), SuiteScript `N/translation` locale code (e.g., `es_ES`), display name, and which locale is the environment's default language. Accepts an optional `includeAllStandardLocales` boolean to also include all standard `N/translation.Locale` enum values.
- **`netsuite_list_translation_collections`**: List all Translation Collections (`custcollection_*`) in the active NetSuite environment by running `suitecloud object:list --type translationcollection` inside an isolated temporary SDF project.
- **`netsuite_view_translation_collection`**: Download a Translation Collection XML definition (`custcollection_*`) via SDF to inspect its strings, default translations, and descriptions, and call the MCP Services RESTlet (`N/translation`) to resolve translated values across requested (`locales`) or active NetSuite locales. *(Note: Non-default locales that fall back to the default translation in `N/translation` are reported as `""` to indicate they are untranslated or identical to the default language.)*
- **`netsuite_create_translation_collection`** *(Destructive)*: Create and deploy a new NetSuite Translation Collection (`custcollection_*`) and any non-default language XLIFF (`.xlf`) translation files via an isolated temporary SDF project, and optionally copy both `<scriptId>.xml` and `Translations/<scriptId>.<locale>.xlf` into your local project (`saveToProject`).
- **`netsuite_update_translation_collection`** *(Destructive)*: Update an existing NetSuite Translation Collection (`custcollection_*`) via an isolated temporary SDF project. Downloads the latest XML definition from NetSuite, retrieves existing translations via the MCP RESTlet (`N/translation`) for any modified locales so existing string translations in those `.xlf` files are preserved, merges new/updated strings and locale translations, deploys the updated XML and `.xlf` files, and optionally copies them into your local project (`saveToProject`).

### 9. Templates (Advanced PDF & Email)
*(Uses SuiteCloud CLI inside an isolated temporary SDF project to list, read, and upsert template definitions, and the MCP RESTlet `N/render` module for live rendering and previewing)*

- **`netsuite_list_templates`**: List custom Advanced PDF/HTML Templates (`custtmpl_*`) and/or Email Templates (`custemailtmpl_*`) in the active NetSuite environment by running `suitecloud object:list` inside an isolated temporary SDF project. Accepts an optional `type` filter (`'all'`, `'advancedpdftemplate'`, or `'emailtemplate'`).
- **`netsuite_read_advanced_pdf_template`**: Download and parse an Advanced PDF/HTML Template (`custtmpl_*`) and its companion BFO XML / FreeMarker source file (`<scriptId>.template.xml`) from the active NetSuite environment via an isolated temporary SDF project.
- **`netsuite_upsert_advanced_pdf_template`** *(Destructive)*: Create or update an Advanced PDF/HTML Template (`custtmpl_*`) and its companion BFO XML / FreeMarker file (`<scriptId>.template.xml`) in NetSuite via an isolated temporary SDF project. If the template already exists in NetSuite, its current definition is downloaded first and merged with the provided parameters so omitted properties are preserved. Automatically manages `ADVANCEDPRINTING` and referenced object dependencies in `manifest.xml`, and optionally copies both `<scriptId>.xml` and `<scriptId>.template.xml` into your local project (`saveToProject`).
- **`netsuite_render_advanced_pdf_template`**: Render an Advanced PDF/HTML Template (by deployed `scriptId` or inline `pdfContent` BFO XML + FreeMarker without requiring SDF deployment first) using NetSuite's `N/render` module via the MCP RESTlet. Supports binding an optional `recordType` (with explicit `recordId` or auto-sampled from the most recent record of that type), `searchId` (saved search results), and/or `customData`. Returns the binary PDF as an embedded MCP resource (`application/pdf` base64 blob), saves a temporary copy (`previewFilePath`) in an auto-cleaned preview directory, and optionally returns (or automatically includes on BFO failure) the FreeMarker-evaluated XML (`evaluatedXml`).
- **`netsuite_read_email_template`**: Download and parse an Email Template (`custemailtmpl_*`) and its inline HTML / FreeMarker body (`<scriptId>.template.html`) or File Cabinet media item reference (`<mediaitem>`) from the active NetSuite environment via an isolated temporary SDF project.
- **`netsuite_upsert_email_template`** *(Destructive)*: Create or update an Email Template (`custemailtmpl_*`) and its inline HTML / FreeMarker file (`<scriptId>.template.html`) or File Cabinet `<mediaitem>` reference in NetSuite via an isolated temporary SDF project. Downloads and merges existing definitions on update, manages `CRM` and File Cabinet dependencies in `manifest.xml`, and optionally copies the XML and companion `.template.html` files into your local project (`saveToProject`).
- **`netsuite_render_email_template`**: Render a deployed Email Template (`custemailtmpl_*`) using NetSuite's `N/render.mergeEmail` via the MCP RESTlet. Supports binding `transaction`, `entity`, `recipient`, `customRecord`, or `supportCase` records (with explicit internal IDs or auto-sampling the latest record when a type such as `transactionType`, `entityType`, `recipientType`, or `customRecordType` is provided without an ID). Returns the evaluated `subject` and HTML `body`, an embedded `text/html` MCP resource, and saves a temporary HTML preview file (`previewFilePath`) in an auto-cleaned preview directory.

## Installation

### Local Server Setup

1. **Clone the repository:**
   ```bash
   git clone <repository_url>
   cd netsuite_mcp
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Build the project:**
   ```bash
   npm run build
   ```

### Deploying the NetSuite RESTlet Backend (`netsuitescripts/rl_mcp_services.js`)

Several MCP tools (`netsuite_run_suite_ql`, `netsuite_get_script_logs`, `netsuite_run_function`, `netsuite_load_record_sample`, `netsuite_upsert_record`, `netsuite_view_file`, `netsuite_list_supported_locales`, `netsuite_view_translation_collection`, `netsuite_update_translation_collection`, `netsuite_render_advanced_pdf_template`, and `netsuite_render_email_template`) communicate with a SuiteScript 2.1 RESTlet included in this repository at `netsuitescripts/rl_mcp_services.js`. You must upload and deploy this script in each target NetSuite environment (e.g., Sandbox, Production).

1. **Upload the Script File to the File Cabinet:**
   - In NetSuite, navigate to **Documents > Files > SuiteScripts** (or a subfolder of your choice).
   - Click **Add File** and upload `netsuitescripts/rl_mcp_services.js`.

2. **Create the Script Record:**
   - Navigate to **Customization > Scripting > Scripts > New**.
   - Select the `rl_mcp_services.js` file you just uploaded and click **Create Script Record**.
   - NetSuite will detect the `@NScriptType Restlet` and `@NApiVersion 2.1` annotations automatically and link the `post` entry point function (`post`).
   - Set a descriptive **Name** (e.g., `MCP Services RESTlet`).
   - *(Optional)* Enter a custom **ID** (for example, `_rl_mcp_services`, which NetSuite saves as `customscript_rl_mcp_services`).
   - Click **Save and Deploy** (or click **Save** and then **Deploy Script**).

3. **Create and Configure the Script Deployment:**
   - On the **Script Deployment** page:
     - **Status:** Change from *Testing* to **Released** so external RESTlet calls can reach it.
     - **Log Level:** Set to **Debug** (or **Error** if you want minimal execution logs).
     - *(Optional)* **ID:** Enter a custom deployment ID (for example, `_rl_mcp_services`, which NetSuite saves as `customdeploy_rl_mcp_services`).
     - **Audience Subtab:** Select the **Roles** and/or **Employees** that will be used by your OAuth 1.0a Access Token (or check **Select All** under Roles/Employees if appropriate for your account).
   - Click **Save**.

4. **Record the `scriptId` and `deploymentId` for Configuration:**
   - **Are specific Script or Deployment IDs required?**
     **No.** Neither `rl_mcp_services.js` nor the MCP server hardcodes a specific Script ID or Deployment ID. Instead, the MCP server reads `scriptId` and `deploymentId` per environment from your `env.json` configuration file and builds the RESTlet URL dynamically:
     ```text
     https://<accountId>.restlets.api.netsuite.com/app/site/hosting/restlet.nl?script=<scriptId>&deploy=<deploymentId>
     ```
   - **Where to find the exact values:**
     On the saved **Script Deployment** page in NetSuite, look at the **External URL** field:
     ```text
     https://<accountId>.restlets.api.netsuite.com/app/site/hosting/restlet.nl?script=1234&deploy=1
     ```
     - Copy the value after `script=` into `"scriptId"` in your `env.json`.
     - Copy the value after `deploy=` into `"deploymentId"` in your `env.json`.
   - **Numeric Internal IDs vs. Custom Script IDs:**
     NetSuite's RESTlet endpoint accepts **either** the numeric internal IDs shown in the External URL (e.g., `"scriptId": "1234"`, `"deploymentId": "1"`) **or** the full custom script/deployment IDs (e.g., `"scriptId": "customscript_rl_mcp_services"`, `"deploymentId": "customdeploy_rl_mcp_services"`). Using custom IDs can be convenient if you want consistent IDs across Sandbox and Production environments.

## Configuration

The NetSuite MCP Server uses configuration files stored in your operating system's standard application data directory:

- **Windows:** `%APPDATA%\netsuite_mcp\`
- **macOS / Linux:** `~/.config/netsuite_mcp/`

### Graphical Settings UI (`netsuite_open_settings`) — Recommended

You do not need to create the configuration folder or edit JSON files by hand. After installing and starting the MCP server, simply ask your AI assistant to **open the NetSuite settings** (which invokes `netsuite_open_settings`).

This launches a local web interface in your browser where you can:
- **Create, rename, edit, and delete environments** (`env.json`) and set the **active environment and tool profile** (`state.json`).
- **Test connections** directly from the form to verify your OAuth 1.0a credentials and MCP RESTlet deployment before saving.
- **Load SQLite schema databases & build Vector databases:** Pick any `.db` file exported from `MCPSchemaLoad.html` via a file picker—the UI validates the schema, moves it into the configuration directory, and renames it to `<Environment>.db` automatically. You can also trigger and monitor the `<Environment>.lance` vector database build with a live progress bar right from the settings page.
- **Manage tool profiles & permissions** per environment: Every environment comes with a permanent `default` profile pre-configured with Core categories (`table_discovery` and `data_operations`) and supports creating additional profiles (e.g., `developer`, `admin`, `readonly`) that share the environment's credentials and databases. Each profile has quick-apply presets, hard security guardrails (`disableDestructive`, `disableSdf`, `blockedTools`), a toggle for dynamic on-demand session toolset activation (`allowDynamicActivation`), and category/tool switches.
- **Customize global & SDF object defaults** (`config.json`) for project build/upload behavior and SDF XML defaults (`RECORD`, `FIELD`, and `LIST`).
- **Zero-config initialization:** Clicking **Save Changes** automatically creates the configuration directory and writes `env.json`, `state.json`, and `config.json`, then notifies the MCP client that the tool list has updated. *(Note: If your AI client/harness does not immediately reflect newly enabled or disabled tools, toggle the MCP server off and on again.)*

---

### Manual Configuration Reference

If you prefer to create or edit the configuration files manually in the configuration directory, use the formats below.

### 1. The `state.json` File

The `state.json` file acts as a switch to determine which NetSuite environment (e.g., `Sandbox`, `Prod`) and tool profile (e.g., `default`, `developer`) you are currently targeting.

You can create this file manually or let the MCP server initialize and update it using **`netsuite_open_settings`** or **`netsuite_switch_environment`** (if `state.json` does not exist yet, only `netsuite_open_settings`, `netsuite_list_environments`, and `netsuite_switch_environment` will be exposed until an environment is selected).

To create `state.json` manually in the configuration directory, use the following structure:

```json
{
  "environment": "Sandbox",
  "profile": "default"
}
```
*(The value of `"environment"` must match a top-level key defined in your `env.json` file. If `"profile"` is omitted or not found on that environment, it defaults to `"default"`.)*

### 2. The `env.json` File (⚠️ REQUIRED)

This file stores your NetSuite credentials for one or more environments along with a `profiles` map defining one or more tool profiles per environment (`"default"` is always present):
- **`enabledCategories`**: Array of tool category IDs enabled at session startup for the profile (`"table_discovery"`, `"data_operations"`, `"script_execution"`, `"sdf_file_deployment"`, `"script_management"`, `"custom_objects"`, `"translations"`, `"templates"`). Defaults to `["table_discovery", "data_operations"]` so the server starts with a lean, high-accuracy tool footprint.
- **`blockedCategories`** *(Hard Guardrail)*: Optional array of category IDs to hard-block completely so none of their tools can be enabled at startup or via dynamic session activation.
- **`allowDynamicActivation`**: When `true` (default), exposes `netsuite_manage_toolsets` so the AI assistant can temporarily activate additional non-blocked tool categories in-memory for the current chat session as needed.
- **`disableDestructive`** *(Hard Guardrail)*: When `true` (default `false`), blocks all tools that can mutate NetSuite data or metadata (e.g., `netsuite_upsert_record`, `netsuite_run_function`, `netsuite_upload_file`, `netsuite_deploy_script`, `netsuite_create_custom_record`, `netsuite_update_custom_record`, `netsuite_upsert_custom_list`, `netsuite_create_translation_collection`, `netsuite_update_translation_collection`, `netsuite_upsert_advanced_pdf_template`, `netsuite_upsert_email_template`). Cannot be overridden by dynamic session activation.
- **`disableSdf`** *(Hard Guardrail)*: When `true` (default `false`), blocks all tools that require the SuiteCloud Development Framework (SDF) CLI. Cannot be overridden by dynamic session activation. *(Note: SDF tools are also automatically disabled if `sdfId` is omitted or empty for the environment.)*
- **`disabledTools`**: Optional array of specific tool names inside enabled categories to keep disabled at startup (defaults to `["netsuite_rebuild_vector_database"]`). Unlike `blockedTools`, these can still be toggled on or dynamically activated.
- **`enabledTools`**: Optional array of specific tool names to enable at startup even if their parent category is not in `enabledCategories`.
- **`blockedTools`** *(Hard Guardrail)*: Optional array of specific tool names to hard-block individually (cannot be dynamically activated).

*(Legacy `env.json` files using a top-level `"tools"` object on an environment are automatically migrated to `profiles.default`.)*

Create `env.json` in the configuration directory:

```json
{
  "Prod": {
    "accountId": "YOUR_ACCOUNT_ID",
    "sdfId": "YOUR_SDF_ACCOUNT_ID",
    "scriptId": "YOUR_RESTLET_SCRIPT_ID",
    "deploymentId": "YOUR_RESTLET_DEPLOYMENT_ID",
    "consumerKey": "YOUR_CONSUMER_KEY",
    "consumerSecret": "YOUR_CONSUMER_SECRET",
    "token": "YOUR_TOKEN",
    "tokenSecret": "YOUR_TOKEN_SECRET",
    "profiles": {
      "default": {
        "description": "Read-only production schema and query tools",
        "disableDestructive": true,
        "disableSdf": true,
        "allowDynamicActivation": true,
        "enabledCategories": [
          "table_discovery",
          "data_operations"
        ],
        "enabledTools": [],
        "blockedTools": [
          "netsuite_rebuild_vector_database"
        ]
      }
    }
  },
  "Sandbox": {
    "accountId": "YOUR_SB_ACCOUNT_ID",
    "sdfId": "YOUR_SB_SDF_ACCOUNT_ID",
    "scriptId": "YOUR_RESTLET_SCRIPT_ID",
    "deploymentId": "YOUR_RESTLET_DEPLOYMENT_ID",
    "consumerKey": "YOUR_SB_CONSUMER_KEY",
    "consumerSecret": "YOUR_SB_CONSUMER_SECRET",
    "token": "YOUR_SB_TOKEN",
    "tokenSecret": "YOUR_SB_TOKEN_SECRET",
    "profiles": {
      "default": {
        "description": "Core schema discovery and data querying tools",
        "disableDestructive": false,
        "disableSdf": false,
        "allowDynamicActivation": true,
        "enabledCategories": [
          "table_discovery",
          "data_operations"
        ],
        "enabledTools": [],
        "blockedTools": []
      },
      "developer": {
        "description": "SuiteScript development, logs, and SDF deployment",
        "disableDestructive": false,
        "disableSdf": false,
        "allowDynamicActivation": true,
        "enabledCategories": [
          "table_discovery",
          "data_operations",
          "script_execution",
          "sdf_file_deployment",
          "script_management"
        ],
        "enabledTools": [],
        "blockedTools": []
      }
    }
  }
}
```

### 3. The `config.json` File & Project-Level Configuration (Optional)

You can optionally create a `config.json` file in the configuration directory to define default settings for object creations as well as global SDF/build/upload defaults. You can also override the `project` settings on a per-repository basis by adding a `"netsuiteMcp"` key to your SDF project's `package.json` or creating a `.netsuitemcp.json` file in the SDF project root.

```json
{
  "objectDefaults": {
    "RECORD": {
      "accessType": "USE_PERMISSION_LIST"
    }
  },
  "project": {
    "sdfSourceDir": "dist",
    "buildBeforeUpload": "auto",
    "buildCommand": "npm run build",
    "tsRootDir": "TypeScripts",
    "jsOutDir": "dist/FileCabinet/SuiteScripts",
    "tsconfigPath": "tsconfig.json",
    "saveObjectsToProject": "auto",
    "objectsFolderStrategy": "branch"
  }
}
```

- **`sdfSourceDir`**: SDF folder relative to the project root (e.g., `"dist"`, `"src"`, `"."`). If omitted, auto-detected from `suitecloud.config.js` (`defaultProjectFolder`) or `manifest.xml` location.
- **`buildBeforeUpload`**: `"auto"` (default, runs the build only when a build script/command exists and TypeScript is used), `true` (always build), or `false` (never build).
- **`buildCommand`**: Command to run when building (defaults to `"npm run build"`).
- **`tsRootDir` / `jsOutDir`**: Optional explicit TypeScript source and JavaScript output directory overrides (if omitted, automatically resolved from `tsconfig.json`).
- **`tsconfigPath`**: Relative path to `tsconfig.json` from the project root (defaults to `"tsconfig.json"`).
- **`saveObjectsToProject`**: Controls whether SDF object XML files (along with companion template `.template.xml`/`.template.html` files, `Translations/<scriptId>.<locale>.xlf` XLIFF files, and `manifest.xml` dependencies) deployed via the temporary SDF project are copied into your local project after deployment succeeds.
  - `"auto"` (default): Copies deployed XML files into `<sdfSourceDir>/Objects/...` if `manifest.xml` or an `Objects` folder exists in your local project; otherwise runs as a background-only deployment.
  - `true`: Always copies deployed XML files into the local project.
  - `false`: Never copies files to the local project (background-only deployment).
  - *(Can be overridden on any individual tool call via the `saveToProject` boolean parameter, whose tool schema description dynamically displays the current effective default.)*
- **`objectsFolderStrategy`**: Controls where **new** SDF object XML files are placed under `<sdfSourceDir>/Objects/` when copied to the local project (`"branch"` [default] -> `Objects/<git_branch>/<scriptId>.xml`, `"flat"` -> `Objects/<scriptId>.xml`, or `"type"` -> `Objects/<rootElement>/<scriptId>.xml`). If `<scriptId>.xml` already exists anywhere under `Objects/`, it is always updated in-place to avoid duplicate object definitions.

## Generating the SQLite Schema Database (`netsuitescripts/MCPSchemaLoad.html`)

Tools such as `netsuite_get_fields`, `netsuite_get_related_tables`, `netsuite_rebuild_vector_database`, and `netsuite_search_tables` rely on a local SQLite schema database (`.db`) containing your NetSuite environment's native tables, custom records, fields, and join relationships.

This repository includes a browser-based utility at `netsuitescripts/MCPSchemaLoad.html` that extracts this metadata directly from your NetSuite session and builds the SQLite database client-side.

### 1. Hosting & Opening the Tool in NetSuite

Because `MCPSchemaLoad.html` queries NetSuite's internal Records Catalog endpoint (`/app/recordscatalog/rcendpoint.nl`) and SuiteQL APIs using your active browser session, it must be opened from within NetSuite:

1. In NetSuite, navigate to **Documents > Files > File Cabinet** (e.g., inside `SuiteScripts` or another folder of your choice).
2. Click **Add File** and upload `netsuitescripts/MCPSchemaLoad.html`.
3. Once uploaded, click on `MCPSchemaLoad.html` (or its **Preview** URL) in the File Cabinet to open the **MCP Schema Data** utility in a new browser tab.

### 2. Required Filename and Location

The MCP server looks for the SQLite file in your configuration directory (`MCP_DIR`) named after the active **environment key** configured in `state.json` and `env.json`:

```text
<config_directory>/<environment>.db
```

- **Directory Location:**
  - **Windows:** `%APPDATA%\netsuite_mcp\`
  - **macOS / Linux:** `~/.config/netsuite_mcp/` (or `$XDG_CONFIG_HOME/netsuite_mcp/`)
- **Filename Requirement:**
  - The filename **must exactly match** the environment name in `state.json` / `env.json` (including capitalization on case-sensitive filesystems) followed by `.db`.
  - For example:
    - If `"environment": "Prod"`, the file must be located at `~/.config/netsuite_mcp/Prod.db` (or `%APPDATA%\netsuite_mcp\Prod.db` on Windows).
    - If `"environment": "Sandbox"`, the file must be located at `~/.config/netsuite_mcp/Sandbox.db` (or `%APPDATA%\netsuite_mcp\Sandbox.db` on Windows).

### 3. Using the Extraction Modes

`MCPSchemaLoad.html` provides three extraction modes depending on whether you are building a database for the first time or refreshing existing schema data:

1. **Full Schema Export (Initial Setup):**
   - Scrapes all native NetSuite record types and join metadata from the Records Catalog, then runs paginated SuiteQL queries to extract all Custom Record Types (`CustomRecordType`) and Custom Fields (`CustomField`).
   - **How to run:**
     1. Select **Full Schema Export**.
     2. In **Filename (without extension)**, enter your target environment name (e.g., `Prod` or `Sandbox`) so that the output file is named `Prod.db` or `Sandbox.db`.
     3. Click **Run Extraction** and wait for the progress bar to reach `100%` (*Ready for Download*).
     4. Click **Download SQLite Database**.
     5. Open the Settings UI via **`netsuite_open_settings`** and click **Load SQLite Database (.db)...** on your environment to select the downloaded file (which automatically validates, places, and renames it to `<environment>.db`), or manually move the `<environment>.db` file into your `netsuite_mcp` configuration directory.

2. **Update All Custom Records:**
   - Refreshes all custom record types and custom fields in an existing `.db` file via SuiteQL without re-downloading all native NetSuite tables.
   - **How to run:**
     1. Select **Update All Custom Records**.
     2. Provide your existing `<environment>.db` file using one of two methods:
        - **Select & Link Local File (Overwrites in-place):** *(Supported in Chromium browsers such as Chrome and Edge)* Links directly to `~/.config/netsuite_mcp/<environment>.db` and overwrites it automatically when extraction completes.
        - **Or Choose File Manually (Downloads copy):** Uploads your existing `.db` file into memory; when finished, click **Download SQLite Database** and replace your existing file in the configuration directory.
     3. Click **Run Extraction**.

3. **Single Table Update:**
   - Re-fetches and updates a single native table or custom record (e.g., `transaction` or `customrecord_my_record`) inside an existing `.db` file.
   - **How to run:**
     1. Select **Single Table Update**.
     2. Link your existing `<environment>.db` file (for in-place overwrite) or choose it manually.
     3. Enter the script/table ID in **Table Name (to update/insert)**.
     4. Click **Run Extraction** (and download the updated file if not linked in-place).

> **Tip:** After generating or updating `<environment>.db`, click **Build / Rebuild Vector Database (.lance)** in the Settings UI (`netsuite_open_settings`)—or run the `netsuite_rebuild_vector_database` MCP tool—to generate the corresponding `<environment>.lance` vector database used by `netsuite_search_tables`.

## NetSuite Setup Requirements

To use this server, you must have a corresponding RESTlet script deployed in your NetSuite account that can handle the payloads sent by this MCP server. 

Additionally, you will need to create an Integration Record in NetSuite to generate the `consumerKey` and `consumerSecret`, and create an Access Token for a user with the appropriate roles to generate the `token` and `tokenSecret`.

## Usage

Once configured, you can start the MCP server:

```bash
npm start
```

For development, you can run TypeScript in watch mode:
```bash
npm run dev
```

### Integrating with MCP Clients

To use this server with an MCP client (such as Claude Desktop or OpenCode), add it to your client's configuration pointing to the compiled `build/index.js` file.

Example Claude Desktop `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "netsuite": {
      "command": "node",
      "args": [
        "/path/to/your/netsuite_mcp/build/index.js"
      ]
    }
  }
}
```
