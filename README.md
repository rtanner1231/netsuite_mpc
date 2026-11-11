> ⚠️ **WORK IN PROGRESS**: This project is currently under active development.

# NetSuite MCP Server

The NetSuite Model Context Protocol (MCP) Server is a powerful bridge that allows AI assistants (like Claude, ChatGPT, or custom agents) to securely interact with your NetSuite environment. It exposes a set of tools to query, update, and manage your NetSuite data and configurations using NetSuite's RESTlet and OAuth 1.0a mechanisms.

## Features

The server exposes the following MCP tools to interact directly with NetSuite:

- **`netsuite_get_fields`**: Retrieve available fields for specific NetSuite record types.
- **`netsuite_run_suite_ql`**: Execute SuiteQL queries against your NetSuite instance.
- **`netsuite_get_script_logs`**: Fetch and inspect execution logs for NetSuite scripts.
- **`netsuite_upload_file`**: Upload files directly to the NetSuite File Cabinet.
- **`netsuite_run_function`**: Execute custom NetSuite server-side functions/scripts.
- **`netsuite_load_record_sample`**: Load a sample of a NetSuite record to inspect its data structure.
- **`netsuite_create_custom_record`**: Programmatically create custom records in NetSuite.
- **`netsuite_update_custom_record`**: Programmatically update custom records in NetSuite.
- **`netsuite_create_custom_list`**: Programmatically create custom lists in NetSuite.
- **`netsuite_rebuild_vector_database`**: Asynchronously build or replace the LanceDB vector database (`.lance`) from the active environment's SQLite schema database (`.db`).
- **`netsuite_rebuild_vector_database_status`**: Check the current status and progress of the vector database rebuild for the active environment.
- **`netsuite_search_tables`**: Perform a semantic search against the vector database to discover relevant NetSuite tables and return the top 5 matches.
- **`netsuite_get_related_tables`**: Build a map of related NetSuite tables starting from a given table ID by traversing field joins across hop levels.

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

Several MCP tools (`netsuite_run_suite_ql`, `netsuite_get_script_logs`, `netsuite_run_function`, and `netsuite_load_record_sample`) communicate with a SuiteScript 2.1 RESTlet included in this repository at `netsuitescripts/rl_mcp_services.js`. You must upload and deploy this script in each target NetSuite environment (e.g., Sandbox, Production).

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

The NetSuite MCP Server uses configuration files stored in your operating system's standard application data directory.

- **Windows:** `%APPDATA%\netsuite_mcp\`
- **macOS / Linux:** `~/.config/netsuite_mcp/`

You will need to manually set up the files in this directory before running the server.

### 1. The `state.json` File (⚠️ REQUIRED)

**Important:** The `state.json` file **must be created by you (the user)**. This file acts as a switch to determine which NetSuite environment you are currently targeting (e.g., Sandbox, Production). 

**You are responsible for changing this file whenever you want to point the MCP server to a different NetSuite environment.**

Create `state.json` in the configuration directory with the following structure:

```json
{
  "environment": "Prod"
}
```
*(The value of `"environment"` must match a top-level key defined in your `env.json` file.)*

### 2. The `env.json` File (⚠️ REQUIRED)

This file stores your NetSuite credentials for one or more environments. You can also optionally specify a `disabledTools` array on any environment to disable specific MCP tools when that environment is active. Create `env.json` in the configuration directory:

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
    "disabledTools": [
      "netsuite_create_custom_record",
      "netsuite_update_custom_record",
      "netsuite_create_custom_list",
      "netsuite_upload_file"
    ]
  },
  "Sandbox": {
    "accountId": "YOUR_SB_ACCOUNT_ID",
    "sdfId": "YOUR_SB_SDF_ACCOUNT_ID",
    "scriptId": "YOUR_RESTLET_SCRIPT_ID",
    "deploymentId": "YOUR_RESTLET_DEPLOYMENT_ID",
    "consumerKey": "YOUR_SB_CONSUMER_KEY",
    "consumerSecret": "YOUR_SB_CONSUMER_SECRET",
    "token": "YOUR_SB_TOKEN",
    "tokenSecret": "YOUR_SB_TOKEN_SECRET"
  }
}
```

### 3. The `config.json` File (Optional)

You can optionally create a `config.json` file in the configuration directory to define default settings for object creations.

```json
{
  "objectDefaults": {
    "RECORD": {
      "accessType": "USE_PERMISSION_LIST"
    }
  }
}
```

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
