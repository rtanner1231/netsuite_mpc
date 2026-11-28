# Open Settings (`netsuite_open_settings`)

[← Back to Tools Overview](../tools-overview.md)

## Description & Usage

`netsuite_open_settings` launches the local graphical Settings Web UI in your default web browser. It is the recommended entry point for first-time initialization, credential management, schema/vector database loading, and profile/guardrail configuration.

Because this tool is marked `alwaysAvailable: true`, it is accessible even on a brand-new installation before `~/.config/netsuite_mcp/env.json` or `state.json` exist on disk. You can invoke it either by asking the AI assistant to call `netsuite_open_settings` or by running the **`/open-settings`** MCP prompt.

### When to Use It
- **First-time setup:** To create your `env.json`, `state.json`, and `config.json` files without editing JSON by hand.
- **Adding or testing environments:** To enter OAuth 1.0a and RESTlet credentials for `Sandbox`, `Prod`, etc., and run a live connection test.
- **Loading schema & vector databases:** To upload a `.db` file exported from `MCPSchemaLoad.html` and trigger a LanceDB `.lance` vector rebuild with a live progress bar.
- **Configuring profiles & guardrails:** To toggle tool categories, apply profile presets (`core`, `readonly`, `developer`, `admin`, `templates_localization`, `all`), or set security guardrails (`disableDestructive`, `disableSdf`, `blockedCategories`, `blockedTools`, `allowedTools`).

### Input Parameters

This tool takes no input parameters (`{}`).

---

## Complementary Tools

- **[List Environments (`netsuite_list_environments`)](./netsuite_list_environments.md):** Inspect which environments, tool profiles, and session toolsets are currently active after saving changes in the Settings UI.
- **[Switch Environment (`netsuite_switch_environment`)](./netsuite_switch_environment.md):** Quickly switch between the environments and profiles you created in the Settings UI directly from chat without reopening the browser.
- **[Rebuild Vector Database (`netsuite_rebuild_vector_database`)](./netsuite_rebuild_vector_database.md):** Can be used from chat to monitor or trigger the same background LanceDB rebuild that the Settings UI's **Build / Rebuild Vector Database (.lance)** button invokes.

---

## Tool Metadata

| Property | Value |
| :--- | :--- |
| **Tool ID** | `netsuite_open_settings` |
| **Human-Readable Name** | Open Settings |
| **Category** | Environment, Profile & Toolset Management |
| **Destructive (`isDestructive`)** | `false` |
| **Requires SDF (`requiresSdf`)** | `false` |
| **Always Available (`alwaysAvailable`)** | `true` |
| **MCP Prompt** | `/open-settings` (*"Open NetSuite Settings"*) |

---

## Inner Workings

1. **Singleton Local HTTP Server & Session Persistence:**
   - When invoked, `startOrGetSettingsServer` checks whether an HTTP server instance is already running in the current MCP process.
   - If not running, it reads `<MCP_DIR>/.settings-session.json` (if present from a previous run) to reuse the last port (default `45821`, falling back to an OS-assigned ephemeral port if `45821` is occupied) and 24-byte random hex security token (`crypto.randomBytes(24).toString("hex")`).
   - It binds a Node.js `http.Server` strictly to `127.0.0.1` (loopback only) and calls `httpServer.unref()` so the background HTTP server never prevents the MCP process from exiting cleanly when the AI client closes `stdio`.
   - On MCP server startup (`src/index.ts`), `resumeSettingsServerIfPersisted` automatically restarts the HTTP server if `.settings-session.json` exists, allowing an already-open browser tab to survive MCP server restarts seamlessly.

2. **Token Authentication & Endpoints:**
   - Every HTTP request to the local server must include `?token=<token>` in the query string; requests with a missing or mismatched token are rejected with `403 Forbidden`.
   - The server exposes the following local endpoints:
     - `GET /`: Renders the self-contained single-page Settings HTML/CSS/JS application (`renderSettingsHtml(token)`).
     - `GET /api/settings`: Loads `state.json`, `env.json`, `config.json`, a SHA-1 `configVersion` hash, and the complete schema of credential fields, tool categories, profile presets, and tool definitions.
     - `POST /api/settings`: Validates environment names (rejecting path separators or `.`/`..`), trims credential strings, normalizes profiles (ensuring `profiles.default` exists), renames `<OldEnv>.db` and `<OldEnv>.lance` on disk if an environment was renamed in the UI, writes `env.json`, `state.json`, and `config.json`, prunes any ineligible session toolset overrides, and emits `mcpServer.sendToolListChanged()`.
     - `POST /api/active-environment`: Quickly updates `state.json` when the user changes the active environment or profile dropdown at the top of the UI.
     - `POST /api/test-connection`: Verifies all 7 required OAuth/RESTlet credential fields and executes a live `RUN_SUITE_QL` (`SELECT 1 AS ping`) call against the target NetSuite RESTlet, returning the round-trip latency in milliseconds.
     - `GET /api/db-status`, `POST /api/upload-sqlite`, `GET /api/download-sqlite`, `GET /api/download-companion-file`: Streams and validates uploaded `.db` files (up to 250 MB) and serves version-matched companion NetSuite files (`rl_mcp_services.js` and `MCPSchemaLoad.html`) directly from the package's `netsuitescripts/` directory. Before replacing `<Environment>.db`, the server checks that no vector rebuild is currently in progress (`409 Conflict`), verifies the 16-byte `"SQLite format 3"` file header, opens a temporary `.db.tmp` file in read-only mode to verify that both `tables` and `tablefields` tables exist and count their rows, and atomically renames the temp file to `<MCP_DIR>/<Environment>.db`.
     - `POST /api/rebuild-vector-db`: Starts an asynchronous LanceDB vector rebuild (`startBackgroundRebuild`) for the specified environment.
     - `GET /api/events` & `GET /api/ping`: Provides a Server-Sent Events (SSE) stream so open browser tabs automatically detect external changes made via `netsuite_switch_environment` or manual file edits.

3. **Platform Browser Launch:**
   - Once the server is listening, `openUrlInBrowser` executes the platform-native opener command (`cmd /c start "" "<url>"` on Windows, `open "<url>"` on macOS, or `xdg-open "<url>"` on Linux) and returns the full authenticated URL in the tool response in case the user is running in a headless environment.
