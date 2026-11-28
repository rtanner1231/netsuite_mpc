# List Environments (`netsuite_list_environments`)

[← Back to Tools Overview](../tools-overview.md)

## Description & Usage

`netsuite_list_environments` inspects your local `env.json` and `state.json` configuration files and returns a human-readable summary of all configured NetSuite environments, their available tool profiles, their enabled tool categories and security guardrails, which environment and profile are currently active, and any temporary in-memory session toolset overrides.

You can invoke this tool directly or via the **`/list-environments`** MCP prompt.

### When to Use It
- **Before running queries or deployments:** To confirm whether you are currently targeting `Sandbox` or `Prod` and which profile (`default`, `developer`, `readonly`, etc.) is active.
- **Before switching environments or profiles:** To discover the exact environment and profile names configured in `env.json`.
- **Auditing session state:** To check which categories or individual tools have been dynamically activated or deactivated in the current chat session via `netsuite_manage_toolsets`.

### Input Parameters

This tool takes no input parameters (`{}`).

---

## Complementary Tools

- **[Switch Environment (`netsuite_switch_environment`)](./netsuite_switch_environment.md):** Use the environment and profile names returned by `netsuite_list_environments` to switch the active target in `state.json`.
- **[Manage Toolsets (`netsuite_manage_toolsets`)](./netsuite_manage_toolsets.md):** Activate or reset in-memory session categories and tools after checking the active profile's baseline configuration.
- **[Open Settings (`netsuite_open_settings`)](./netsuite_open_settings.md):** Launch the browser UI if `netsuite_list_environments` reports that no environments are configured yet.

---

## Tool Metadata

| Property | Value |
| :--- | :--- |
| **Tool ID** | `netsuite_list_environments` |
| **Human-Readable Name** | List Environments |
| **Category** | Environment, Profile & Toolset Management |
| **Destructive (`isDestructive`)** | `false` |
| **Requires SDF (`requiresSdf`)** | `false` |
| **Always Available (`alwaysAvailable`)** | `true` |
| **MCP Prompt** | `/list-environments` (*"List NetSuite Environments"*) |

---

## Inner Workings

1. **Loading & Normalizing `env.json`:**
   - Calls `getAllEnvironments()` (`src/utils/config.ts`), which reads `<MCP_DIR>/env.json` and runs `normalizeEnvironmentConfig` on each environment entry.
   - If an older `env.json` uses a legacy top-level `"tools"` block on an environment, `normalizeEnvironmentConfig` automatically migrates it into `profiles.default` in memory so `profiles.default` is always guaranteed to exist.
   - If `env.json` contains no environments, it returns `"No environments are configured in env.json."`

2. **Resolving Active State (`state.json`) & In-Memory Session Overrides:**
   - Calls `getActiveStateOrNull()` to read `<MCP_DIR>/state.json` without throwing if the file does not exist yet (`ENOENT`).
   - Validates whether the `environment` key in `state.json` exists in `env.json`, and resolves the active profile via `resolveEnvironmentProfile` (falling back to `"default"` if the requested profile name is omitted or missing).
   - Queries the four in-memory session override sets (`getSessionActivatedCategories`, `getSessionDeactivatedCategories`, `getSessionActivatedTools`, `getSessionDeactivatedTools`) and prints any active session overrides at the top of the output.

3. **Formatting Environments, Profiles & Guardrails:**
   - Iterates through every environment and each of its `profiles`:
     - Marks the active environment with `* <EnvName> (current environment)` and the active profile with `* Profile '<ProfileName>' (active profile)`.
     - Lists the profile's `description`, startup `enabledCategories`, and any active guardrail flags (`disableDestructive`, `disableSdf`, `exceptions: <allowedTools>`, and `dynamicActivationOff` when `allowDynamicActivation === false`).
   - Never exposes sensitive credential values (`consumerKey`, `consumerSecret`, `token`, `tokenSecret`) in the tool output.
