# Switch Environment (`netsuite_switch_environment`)

[← Back to Tools Overview](../tools-overview.md)

## Description & Usage

`netsuite_switch_environment` changes the active NetSuite environment (e.g., from `Sandbox` to `Prod`) and/or the active tool profile (e.g., from `default` to `developer` or `readonly`) by updating or initializing `state.json`.

You can pass `environment` alone (which activates that environment's `default` profile when switching to a different environment), `profile` alone (which switches profiles on the currently active environment), or both together. You can also invoke it via the **`/switch-environment`** MCP prompt.

### When to Use It
- **Switching between Sandbox and Production:** When moving from development/testing in `Sandbox` to querying or deploying in `Prod`.
- **Elevating or restricting tool permissions:** When switching from the lean `default` profile to a `developer` or `admin` profile on the same environment, or locking down to a `readonly` profile.
- **First-time CLI initialization:** If `env.json` was created manually and `state.json` has not been initialized yet.

### Input Parameters

| Parameter | Type | Required | Description |
| :--- | :--- | :---: | :--- |
| `environment` | `string` | No* | Name of the NetSuite environment to activate (must match a top-level key in `env.json`). If omitted, keeps the currently active environment and switches only `profile`. |
| `profile` | `string` | No* | Name of the tool profile to activate on the target environment (e.g., `'default'`, `'developer'`, `'admin'`). Defaults to `'default'` when switching to a different environment. |

*\*At least one of `environment` or `profile` must be provided.*

---

## Complementary Tools

- **[List Environments (`netsuite_list_environments`)](./netsuite_list_environments.md):** Call first if you do not know the exact environment or profile names available in `env.json`.
- **[Manage Toolsets (`netsuite_manage_toolsets`)](./netsuite_manage_toolsets.md):** Temporarily unlock additional tool categories in memory for the current chat session if you do not want to permanently switch profiles in `state.json`.
- **[Open Settings (`netsuite_open_settings`)](./netsuite_open_settings.md):** Create new environments or define new profiles in `env.json`.

---

## Tool Metadata

| Property | Value |
| :--- | :--- |
| **Tool ID** | `netsuite_switch_environment` |
| **Human-Readable Name** | Switch Environment |
| **Category** | Environment, Profile & Toolset Management |
| **Destructive (`isDestructive`)** | `false` |
| **Requires SDF (`requiresSdf`)** | `false` |
| **Always Available (`alwaysAvailable`)** | `true` |
| **MCP Prompt** | `/switch-environment` (*"Switch NetSuite Environment / Profile"*, optional `environment` and `profile` arguments) |

---

## Inner Workings

1. **Input & Target Resolution:**
   - Validates that at least one of `environment` or `profile` is a non-empty string.
   - Calls `setActiveEnvironment(targetEnv, targetProfile)` (`src/utils/config.ts`), which loads `env.json` via `getAllEnvironments()` and reads any existing `state.json`.
   - If `environment` is omitted, it retains `previousEnvironment` from `state.json` (or throws an error if no environment is currently active).
   - Verifies that `targetEnvironment` exists in `env.json`; if not, throws an error listing all available environment keys.

2. **Profile Selection Logic:**
   - If `profile` is explicitly passed, verifies that `targetEnvConfig.profiles[targetProfile]` exists (throwing an error listing available profiles on that environment if not found).
   - If `profile` is omitted and the user is switching to a **different** environment (`targetEnvironment !== previousEnvironment`), `targetProfile` automatically resets to `"default"`.
   - If `profile` is omitted and the user stays on the same environment, it keeps `previousProfile` if valid, or falls back to `"default"`.

3. **Persistence, Session Reset & Client Notification:**
   - Ensures `<MCP_DIR>` exists (`fs.mkdir(MCP_DIR, { recursive: true })`) and writes the updated `{ environment, profile }` JSON to `state.json`.
   - **Automatic Session Override Reset:** If either `environment` or `profile` changed, `clearSessionCategories()` is immediately called to wipe all in-memory `sessionActivatedCategories`, `sessionDeactivatedCategories`, `sessionActivatedTools`, and `sessionDeactivatedTools`. This guarantees that temporary tools unlocked in `Sandbox` never carry over when switching to `Prod`.
   - Calls `server.sendToolListChanged()` to notify the MCP client to re-fetch `ListTools` under the new environment and profile's guardrails. (The background config watcher in `src/index.ts` also broadcasts the update to any open Settings UI browser tabs via SSE).
