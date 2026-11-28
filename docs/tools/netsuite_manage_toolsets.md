# Manage Toolsets (`netsuite_manage_toolsets`)

[← Back to Tools Overview](../tools-overview.md)

## Description & Usage

`netsuite_manage_toolsets` dynamically activates, deactivates, resets, or lists NetSuite tool categories (`categories`) and/or individual tools (`tools`) **in memory** for the current MCP chat session without modifying `env.json`.

By default, a profile starts with only the `table_discovery` and `data_operations` categories enabled so the AI assistant's context window stays lean and tool selection remains fast and accurate. When you ask the AI assistant to perform a task outside those initial categories (such as creating a Saved Search, viewing a File Cabinet file, deploying a SuiteScript, upserting a Custom Record Type, managing Translations, or rendering an Advanced PDF Template), the assistant calls `netsuite_manage_toolsets` to unlock either the specific 1–2 tools it needs or the relevant category.

### When to Use It
- **Unlocking specific tools on-demand (Recommended for 1–2 tools):** Pass `action: "activate"` and `tools: ["netsuite_view_file"]` (or `["netsuite_rebuild_vector_database"]`) to expose just the required tool(s) while keeping context lean.
- **Unlocking an entire category workflow:** Pass `action: "activate"` and `categories: ["templates"]` (or `["report_creation"]`, `["script_management"]`, `["custom_objects"]`, `["translations"]`, `["sdf_file_deployment"]`, `["script_execution"]`) when working across multiple tools in a domain.
- **Deactivating or resetting session tools:** Pass `action: "deactivate"` to hide tools/categories you no longer need in the conversation, or `action: "reset"` to return to the active profile's startup baseline.
- **Inspecting toolset status:** Pass `action: "list"` to view all 9 categories, their enabled tools, inactive eligible tools, and any tools blocked by profile guardrails.

### Input Parameters

| Parameter | Type | Required | Description |
| :--- | :--- | :---: | :--- |
| `action` | `"activate"` \| `"deactivate"` \| `"reset"` \| `"list"` | **Yes** | Operation to perform on the current session's toolsets. |
| `categories` | `string[]` | No* | Array of category IDs to activate or deactivate: `"table_discovery"`, `"data_operations"`, `"report_creation"`, `"script_execution"`, `"sdf_file_deployment"`, `"script_management"`, `"custom_objects"`, `"translations"`, `"templates"`. |
| `tools` | `string[]` | No* | Array of specific tool IDs (e.g., `["netsuite_view_file", "netsuite_get_script_logs"]`) to activate or deactivate individually. |

*\*When `action` is `"activate"` or `"deactivate"`, at least one item must be provided in `categories` or `tools`.*

---

## Complementary Tools

- **[List Environments (`netsuite_list_environments`)](./netsuite_list_environments.md):** View the active environment, active profile, and any currently active session category/tool overrides.
- **[Switch Environment (`netsuite_switch_environment`)](./netsuite_switch_environment.md):** Permanently switch to a different profile (e.g., `developer` or `admin`) in `state.json`. Switching environments or profiles automatically clears all temporary `netsuite_manage_toolsets` overrides.
- **[Open Settings (`netsuite_open_settings`)](./netsuite_open_settings.md):** Configure a profile's startup `enabledCategories`, `allowDynamicActivation`, and hard security guardrails (`disableDestructive`, `disableSdf`, `blockedCategories`, `blockedTools`, `allowedTools`).

---

## Tool Metadata

| Property | Value |
| :--- | :--- |
| **Tool ID** | `netsuite_manage_toolsets` |
| **Human-Readable Name** | Manage Toolsets |
| **Category** | Environment, Profile & Toolset Management |
| **Destructive (`isDestructive`)** | `false` |
| **Requires SDF (`requiresSdf`)** | `false` |
| **Default Availability** | Enabled whenever an environment is active and `profile.allowDynamicActivation !== false` |

---

## Inner Workings

1. **Dynamic Schema Description Injection (`buildManageToolsetsDescription`):**
   - Every time the MCP client requests `ListTools` (`src/index.ts`), the server dynamically rebuilds `netsuite_manage_toolsets`'s tool description for the active environment and profile.
   - It partitions all non-blocked categories into **Currently Active Categories** (noting any dormant eligible tools inside them, such as `netsuite_rebuild_vector_database`) and **Inactive Categories Available to Activate** (listing the exact eligible tool names inside each category).
   - This allows the LLM to know the exact name of every inactive tool and category it can unlock without having all 37 full JSON schemas loaded in context at startup.

2. **Profile Guardrail Enforcement (`getToolHardGuardrailReason`):**
   - First checks if `profile.allowDynamicActivation === false`. If disabled, the tool clears any session state and returns an error.
   - Calls `pruneIneligibleSessionOverrides` to strip any previously activated session tools/categories that may have become ineligible due to a recent `env.json` edit.
   - Validates all requested `categories` against `VALID_CATEGORY_IDS` and all requested `tools` against the registry of selectable tools.
   - When `action === "activate"`:
     - **Hard Guardrails are never bypassed:** Each requested category and tool is checked against `getToolHardGuardrailReason`:
       1. `profile.blockedCategories`
       2. `profile.blockedTools`
       3. Missing `config.sdfId` on the environment (for tools with `requiresSdf: true`)
       4. `profile.disableDestructive === true` (for tools with `isDestructive: true`, unless the tool is listed in `profile.allowedTools`)
       5. `profile.disableSdf === true` (for tools with `requiresSdf: true`, unless the tool is listed in `profile.allowedTools`)
     - If a requested category has **all** of its tools blocked by guardrails (or is in `blockedCategories`), it is rejected with a clear explanation while any remaining eligible categories/tools in the same call still activate.
     - If a category has a mix of read-only and destructive/SDF tools (for example, activating `report_creation` under a `readonly` profile where `disableDestructive: true`), activating the category unlocks only its eligible read-only tools (`netsuite_view_saved_search` and `netsuite_view_dataset`) while keeping the destructive tools (`netsuite_create_saved_search` and `netsuite_create_dataset`) locked.

3. **In-Memory Session State & Live Tool List Refresh:**
   - Session state is tracked in four module-level `Set<string>` collections in `src/utils/config.ts`:
     - `sessionActivatedCategories` & `sessionDeactivatedCategories`
     - `sessionActivatedTools` & `sessionDeactivatedTools`
   - Activating a category removes it from `sessionDeactivatedCategories` and adds it to `sessionActivatedCategories` (and vice versa for `deactivate`).
   - Whenever any change is applied (`activate`, `deactivate`, or `reset`), the tool calls `await server.sendToolListChanged()` so the MCP client refreshes its available tools immediately, and returns a complete status breakdown of all 9 categories.
