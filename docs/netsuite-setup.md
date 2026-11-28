# NetSuite Backend & Schema Setup Guide

To use `@rtanner1231/netsuite-dev-mcp`, your NetSuite environment needs four things:
1. **An Integration Record & OAuth 1.0a Access Token** (for authenticated RESTlet and REST Metadata API calls).
2. **The MCP Services RESTlet (`netsuitescripts/rl_mcp_services.js`)** deployed in NetSuite.
3. **SuiteCloud CLI Authentication (`sdfId`)** (optional, required only for SDF and File Cabinet upload/object deployment tools).
4. **A Local SQLite Schema Database (`.db`)** generated using **`netsuitescripts/MCPSchemaLoad.html`**.

---

## Where to Find the Companion NetSuite Files

The companion files live in the `netsuitescripts/` directory of this package and repository:
- `netsuitescripts/rl_mcp_services.js` — The SuiteScript 2.1 RESTlet backend.
- `netsuitescripts/MCPSchemaLoad.html` — The browser-based schema extraction utility.

If you are running the server via `npx -y @rtanner1231/netsuite-dev-mcp`, you can download both files directly from the GitHub repository's `netsuitescripts/` folder or locate them inside the installed NPM package cache.

---

## 1. Creating OAuth 1.0a Credentials in NetSuite

The MCP server authenticates with NetSuite using **Token-Based Authentication (TBA / OAuth 1.0a)** with `HMAC-SHA256`.

### Step A: Enable Required Features
1. In NetSuite, navigate to **Setup > Company > Enable Features**.
2. Open the **SuiteCloud** subtab:
   - Under **SuiteScript**, ensure **Client SuiteScript** and **Server SuiteScript** are checked.
   - Under **SuiteTalk (Web Services)**, ensure **REST Web Services** is checked (used for REST Metadata API fallbacks).
   - Under **Manage Authentication**, ensure **Token-Based Authentication** is checked.
3. Click **Save**.

### Step B: Create an Integration Record (`consumerKey` & `consumerSecret`)
1. Navigate to **Setup > Integration > Manage Integrations > New**.
2. Enter a **Name** (e.g., `NetSuite MCP Server`).
3. Ensure **State** is set to **Enabled**.
4. Under the **Authentication** subtab:
   - Check **Token-Based Authentication (TBA)**.
   - Uncheck **TBA: Authorization Flow** and **OAuth 2.0** (not needed for direct token signing).
5. Click **Save**.
6. **Copy the `Consumer Key` and `Consumer Secret` immediately** from the confirmation screen—NetSuite only displays them once.

### Step C: Create an Access Token (`token` & `tokenSecret`)
1. Navigate to **Setup > Users/Roles > Access Tokens > New**.
2. Select:
   - **Application Name:** The Integration Record you created above.
   - **User:** Your NetSuite user account.
   - **Role:** The role the MCP server should execute under (must have permission to call the RESTlet, run SuiteQL queries, and access required records).
3. Click **Save**.
4. **Copy the `Token ID` and `Token Secret` immediately** from the confirmation screen.

---

## 2. Deploying the MCP Services RESTlet (`rl_mcp_services.js`)

Most live NetSuite operations (SuiteQL queries, dynamic record loading/upserting, Saved Searches, SuiteAnalytics Datasets, script execution, log inspection, File Cabinet viewing, locale/translation resolution, and PDF/Email template rendering) communicate with `netsuitescripts/rl_mcp_services.js`.

### Step 1: Upload the Script File
1. In NetSuite, navigate to **Documents > Files > SuiteScripts** (or a subfolder of your choice).
2. Click **Add File** and upload `netsuitescripts/rl_mcp_services.js`.

### Step 2: Create the Script Record
1. Navigate to **Customization > Scripting > Scripts > New**.
2. Select the `rl_mcp_services.js` file you uploaded and click **Create Script Record**.
3. NetSuite automatically detects the `@NScriptType Restlet` and `@NApiVersion 2.1` JSDoc tags and binds the `post` entry point.
4. Enter a **Name** (e.g., `MCP Services RESTlet`).
5. *(Optional)* Set a custom **ID** (e.g., `_rl_mcp_services`, which becomes `customscript_rl_mcp_services`).
6. Click **Save and Deploy**.

### Step 3: Configure the Script Deployment
1. On the **Script Deployment** page:
   - **Status:** Change from *Testing* to **Released**.
   - **Log Level:** Set to **Debug** (recommended if you plan to use `netsuite_run_function` and inspect `N/log` output via `netsuite_get_script_logs` with `runFunctionLogs: true`).
   - *(Optional)* **ID:** Enter `_rl_mcp_services` (which becomes `customdeploy_rl_mcp_services`).
   - **Audience Subtab:** Select the **Roles** and/or **Employees** used by your OAuth Access Token (or check **Select All**).
2. Click **Save**.

### Step 4: Note Your `scriptId` and `deploymentId`
On the saved **Script Deployment** record, look at the **External URL**:
```text
https://<accountId>.restlets.api.netsuite.com/app/site/hosting/restlet.nl?script=1234&deploy=1
```
- Copy the value after `script=` as your **`RESTlet Script ID` (`scriptId`)**.
- Copy the value after `deploy=` as your **`RESTlet Deployment ID` (`deploymentId`)**.
- *(Tip: You can use either the numeric IDs from the URL, such as `1234` and `1`, or the custom script/deployment IDs, such as `customscript_rl_mcp_services` and `customdeploy_rl_mcp_services`.)*

---

## 3. Setting Up SuiteCloud CLI (`sdfId`)

Tools that upload files, compare local vs. deployed files, or manage SDF XML objects (Scripts, Custom Records, Custom Fields, Custom Lists, Translation Collections, and PDF/Email Templates) execute commands through the **SuiteCloud CLI** inside an isolated temporary SDF project.

1. Ensure **Java JDK 17 or 21** is installed (`java -version`).
2. Install the SuiteCloud CLI globally:
   ```bash
   npm install -g @oracle/suitecloud-cli
   ```
3. Authenticate your NetSuite environment to create an Auth ID (`authid`):
   ```bash
   suitecloud account:setup
   ```
   *(Or use `suitecloud account:savetoken` for non-interactive TBA setup).*
4. Remember the **Auth ID** you chose (e.g., `MySandboxAuthId`). You will enter this into the **`SDF Auth ID` (`sdfId`)** field in the MCP Settings UI.
   - *Note: If `sdfId` is left blank on an environment, all SDF-dependent tools are automatically disabled for that environment while RESTlet and schema discovery tools continue working normally.*

---

## 4. Generating the SQLite Schema Database (`MCPSchemaLoad.html`)

Schema discovery tools (`netsuite_search_tables`, `netsuite_get_fields`, `netsuite_get_related_tables`, and `netsuite_rebuild_vector_database`) rely on a local SQLite database (`<Environment>.db`) containing your NetSuite environment's native tables, custom record types, fields, and join relationships.

`netsuitescripts/MCPSchemaLoad.html` is a single-file browser utility that runs inside your authenticated NetSuite session, scrapes the NetSuite Records Catalog (`/app/recordscatalog/rcendpoint.nl`) and SuiteQL metadata tables, and builds the SQLite `.db` file directly in your browser.

### Step 1: Upload and Open `MCPSchemaLoad.html` in NetSuite
1. In NetSuite, navigate to **Documents > Files > File Cabinet** (e.g., inside `SuiteScripts`).
2. Click **Add File** and upload `netsuitescripts/MCPSchemaLoad.html`.
3. Click the uploaded `MCPSchemaLoad.html` file name (or its **Preview** URL) to open the **MCP Schema Data** utility in a new browser tab.

### Step 2: Run an Extraction Mode
`MCPSchemaLoad.html` offers three modes:

1. **Full Schema Export (Initial Setup):**
   - Extracts all native NetSuite tables and join metadata from the Records Catalog, plus all Custom Record Types (`CustomRecordType`) and Custom Fields (`CustomField`) via SuiteQL.
   - Enter your environment name (e.g., `Sandbox` or `Prod`), click **Run Extraction**, wait for `100%`, and click **Download SQLite Database**.
2. **Update All Custom Records:**
   - Refreshes all custom record types and custom fields in an existing `.db` file via SuiteQL without re-scraping all native tables.
   - Select your existing `<Environment>.db` file (in Chromium browsers like Chrome/Edge, you can click **Select & Link Local File** to overwrite `~/.config/netsuite_mcp/<Environment>.db` in-place, or download a copy via **Download Existing .db** in the MCP Settings UI first).
3. **Single Table Update:**
   - Re-fetches and updates a single native table or custom record (e.g., `transaction` or `customrecord_my_record`) inside an existing `.db` file.

### Step 3: Load the Database in the MCP Settings UI
1. Open the MCP Settings UI via `/open-settings` (`netsuite_open_settings`).
2. Select your environment tab and scroll to **Schema & Vector Databases**.
3. Click **Load SQLite Database (.db)...** and choose the downloaded `.db` file.
   - The server validates that the file is a valid SQLite 3 database containing the `tables` and `tablefields` tables, places it in your configuration directory, and renames it to `<Environment>.db` automatically.
4. Click **Build / Rebuild Vector Database (.lance)** to index the schema into embeddings for `netsuite_search_tables`.

---

## Next Steps

Proceed to the **[Settings & Configuration Guide](./settings.md)** to learn how to configure environments, tool profiles, destructive/SDF guardrails, and project defaults.
