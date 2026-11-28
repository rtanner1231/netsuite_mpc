# Run Function (`netsuite_run_function`)

[← Back to Tools Overview](../tools-overview.md)

## Description & Usage

`netsuite_run_function` dynamically loads a SuiteScript 2.x AMD module from the NetSuite File Cabinet inside the MCP Services RESTlet (`rl_mcp_services.js`), invokes a specified exported function with an `args` array, and returns the function's return value (`result`), execution duration in milliseconds (`timeElapsedMS`), and NetSuite governance units consumed (`governanceUsed`).

It supports:
- **Local TypeScript or File Cabinet paths:** You can pass either a File Cabinet path (`"/SuiteScripts/utils/pricing.js"`) or a local workspace path (`"TypeScripts/utils/pricing.ts"` or `"src/FileCabinet/SuiteScripts/utils/pricing.ts"`), which is automatically mapped to its deployed `/SuiteScripts/*.js` File Cabinet path.
- **Dot-notation for nested exported functions:** Pass `functionName: "__test.calculateDiscount"` to call a function nested inside an exported object (`return { __test: { calculateDiscount } }`).

### When to Use It
- **Unit and integration testing SuiteScript modules live in NetSuite:** Upload a `.ts`/`.js` module with [`netsuite_upload_file`](./netsuite_upload_file.md) and immediately invoke its helper or entry-point functions against real NetSuite data and APIs (`N/record`, `N/search`, `N/query`, `N/https`, etc.) without needing to trigger a UI record save or schedule a Map/Reduce run.
- **Benchmarking governance & performance:** Measure exact governance unit usage (`governanceUsed`) and execution latency (`timeElapsedMS`) for individual SuiteScript functions.

### Input Parameters

| Parameter | Type | Required | Description |
| :--- | :--- | :---: | :--- |
| `filePath` | `string` | **Yes** | Path to the SuiteScript module in the File Cabinet (e.g., `'/SuiteScripts/myModule.js'`) or local workspace path (e.g., `'TypeScripts/myModule.ts'` or `'src/FileCabinet/SuiteScripts/myModule.ts'`). |
| `functionName` | `string` | **Yes** | Name of the exported function to execute. Supports dot notation for nested objects (e.g., `'myFunc'` or `'__test.func1'`). |
| `args` | `any[]` | **Yes** | Array of arguments to pass to the function (`[]` if the function takes no arguments). |

---

## Complementary Tools

- **[Get Script Logs (`netsuite_get_script_logs`)](./netsuite_get_script_logs.md):** Any `log.debug`, `log.audit`, `log.error`, or `log.emergency` calls executed inside your function are logged under the **MCP Services RESTlet** deployment. Call `netsuite_get_script_logs` with **`runFunctionLogs: true`** immediately after `netsuite_run_function` to inspect those execution logs.
- **[Upload File (`netsuite_upload_file`)](./netsuite_upload_file.md):** Compile and upload your local `.ts`/`.js` module to the File Cabinet before calling `netsuite_run_function` to test your changes.
- **[Deploy Script (`netsuite_deploy_script`)](./netsuite_deploy_script.md):** Once your functions are tested and verified via `netsuite_run_function`, deploy the full Script record and its deployments.

---

## Tool Metadata

| Property | Value |
| :--- | :--- |
| **Tool ID** | `netsuite_run_function` |
| **Human-Readable Name** | Run Function |
| **Category** | `script_execution` (Script Execution & Log Inspection) |
| **Destructive (`isDestructive`)** | **`true`** |
| **Requires SDF (`requiresSdf`)** | `false` |
| **Default Availability** | On-demand via `netsuite_manage_toolsets` *(or enabled at startup in the `developer` preset)* |

---

## Inner Workings

1. **Workspace-to-File-Cabinet Path Normalization (`normalizeRequestedFilePath` in `src/tools/runFunction.ts`):**
   - Strips any surrounding `[...]` brackets and normalizes backslashes to forward slashes.
   - If `filePath` ends with `.ts` or contains `TypeScripts/` or `FileCabinet/`:
     - Resolves the workspace root via `getProjectRoot(server)` and loads the project configuration (`getProjectConfig`) and `tsconfig.json`.
     - Calls `resolveProjectFile(projectRoot, cleaned, projectConfig)` to map the local source path to its exact compiled NetSuite File Cabinet path (`/SuiteScripts/.../*.js`).
     - Falls back to regex replacement (`/TypeScripts/` -> `/SuiteScripts/`, stripping up to `FileCabinet/`, and `.ts` -> `.js`) if outside a workspace.

2. **Dynamic AMD Module Loading (`loadModule` in `rl_mcp_services.js`):**
   - Inside `handleRunFunction`, the RESTlet applies `updateFilePath` as a secondary safeguard (`TypeScripts` -> `SuiteScripts`, `.ts` -> `.js`).
   - Calls NetSuite's synchronous server-side AMD `require([targetPath], (mod) => { loaded = mod; })` runtime to load the File Cabinet script module into memory.
   - If the module cannot be loaded (e.g., syntax error or missing file in the File Cabinet), logs the error and returns `Unable to load module <targetPath>`.

3. **Dot-Notation Function Resolution (`resolveTargetFunction`):**
   - Splits `functionName` by `"."` (rejecting empty segments).
   - Walks the exported module object graph (`for (const part of parts)`), tracking both `target` (the resolved function) and `context` (its immediate parent object so `this` binding is preserved when calling `resolved.fn.apply(resolved.context, args)`).

4. **Execution, Governance & Timing Measurement:**
   - Captures `startGovernance = runtime.getCurrentScript().getRemainingUsage()` and starts an `ExecutionTimer`.
   - Invokes `const result = resolved.fn.apply(resolved.context, args)`.
     - *(Note: Because the target function runs inside the RESTlet's execution context, it inherits the RESTlet's 5,000-unit governance pool and role permissions.)*
   - Computes `timeElapsedMS = timer.elapsed` and `governanceUsed = startGovernance - script.getRemainingUsage()`.
   - Returns `{ success: true, result, timeElapsedMS, governanceUsed }`.
