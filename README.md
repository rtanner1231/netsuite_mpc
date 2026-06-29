> ⚠️ **WORK IN PROGRESS**: This project is currently under active development.

# NetSuite MCP Server

The NetSuite Model Context Protocol (MCP) Server is a powerful bridge that allows AI assistants (like Claude, ChatGPT, or custom agents) to securely interact with your NetSuite environment. It exposes a set of tools to query, update, and manage your NetSuite data and configurations using NetSuite's RESTlet and OAuth 1.0a mechanisms.

## Features

The server exposes the following MCP tools to interact directly with NetSuite:

- **`getNetsuiteFields`**: Retrieve available fields for specific NetSuite record types.
- **`runSuiteQl`**: Execute SuiteQL queries against your NetSuite instance.
- **`getScriptLogs`**: Fetch and inspect execution logs for NetSuite scripts.
- **`uploadFile`**: Upload files directly to the NetSuite File Cabinet.
- **`runFunction`**: Execute custom NetSuite server-side functions/scripts.
- **`loadRecordSample`**: Load a sample of a NetSuite record to inspect its data structure.
- **`createCustomRecord`**: Programmatically create custom records in NetSuite.
- **`createCustomList`**: Programmatically create custom lists in NetSuite.

## Installation

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

This file stores your NetSuite credentials for one or more environments. Create `env.json` in the configuration directory:

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
    "tokenSecret": "YOUR_TOKEN_SECRET"
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
