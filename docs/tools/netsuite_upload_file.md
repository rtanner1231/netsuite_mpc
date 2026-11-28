# Upload File (`netsuite_upload_file`)

[← Back to Tools Overview](../tools-overview.md)

## Description & Usage

`netsuite_upload_file` compiles (if needed) and uploads an array of one or more local script files (`filePaths`) directly to the NetSuite File Cabinet using the SuiteCloud CLI (`suitecloud file:upload`) inside an **isolated temporary SDF project**.

### Key Features
- **Automatic TypeScript Build & Path Mapping:** You can pass TypeScript source paths (e.g., `["TypeScripts/my_script.ts"]` or `["src/FileCabinet/SuiteScripts/my_script.ts"]`) or compiled JavaScript paths (`["/SuiteScripts/my_script.js"]`). The tool automatically runs your project's build command (when `buildBeforeUpload` is `"auto"` or `true`) and maps `.ts` files to their compiled `.js` local output paths and NetSuite File Cabinet paths (`/SuiteScripts/...`) via `tsconfig.json` or project settings.
- **Zero Mutation of Your Local Repository:** Because the upload runs inside an isolated temporary SDF project in your OS temp directory, it never modifies your repository's `project.json` or `deploy.xml` and is unaffected by other dirty or broken XML objects in your workspace.

### When to Use It
- **Fast code iteration:** Uploading updated `.ts` or `.js` files for an existing deployed SuiteScript or helper library module without needing to redeploy the Script XML record (`customscript_*`).
- **Uploading modules before running `netsuite_run_function`:** Push your latest function changes to the File Cabinet so [`netsuite_run_function`](./netsuite_run_function.md) can execute them live.

### Input Parameters

| Parameter | Type | Required | Description |
| :--- | :--- | :---: | :--- |
| `filePaths` | `string[]` | **Yes** | Non-empty array of local or File Cabinet paths to upload (e.g., `['TypeScripts/myScript.ts']`, `['src/FileCabinet/SuiteScripts/myScript.ts']`, or `['/SuiteScripts/myScript.js']`). |
| `skipBuild` | `boolean` | No | If `true`, skips running the project build command (`npm run build`) before uploading. Defaults to `false`. |

---

## Complementary Tools

- **[Compare Files (`netsuite_compare_files`)](./netsuite_compare_files.md):** Run `netsuite_compare_files` before `netsuite_upload_file` to review a unified diff of what will change in the NetSuite File Cabinet.
- **[Deploy Script (`netsuite_deploy_script`)](./netsuite_deploy_script.md):** Use `netsuite_upload_file` when only the `.js` code changed on an already-deployed script or helper module. Use `netsuite_deploy_script` when creating a **new** Script record (`customscript_*` or `custevsub_*`) or modifying script parameters (`custscript_*`), deployments (`customdeploy_*`), or schedules.
- **[Run Function (`netsuite_run_function`)](./netsuite_run_function.md) & [Get Script Logs (`netsuite_get_script_logs`)](./netsuite_get_script_logs.md):** Test uploaded functions immediately and inspect their execution logs.
- **[View File (`netsuite_view_file`)](./netsuite_view_file.md):** Inspect the live file contents in the NetSuite File Cabinet.

---

## Tool Metadata

| Property | Value |
| :--- | :--- |
| **Tool ID** | `netsuite_upload_file` |
| **Human-Readable Name** | Upload File |
| **Category** | `sdf_file_deployment` (File Cabinet & SDF Files) |
| **Destructive (`isDestructive`)** | **`true`** |
| **Requires SDF (`requiresSdf`)** | **`true`** |
| **Default Availability** | On-demand via `netsuite_manage_toolsets` *(or enabled at startup in the `developer` preset)* |

---

## Inner Workings

1. **Workspace & Project Configuration Resolution:**
   - Validates that `filePaths` is a non-empty array.
   - Resolves `projectRoot` from the MCP client's workspace roots (`server.listRoots()` in `src/utils/mcp.ts`, falling back to `process.cwd()`).
   - Loads merged project configuration (`getProjectConfig(projectRoot)` in `src/utils/project.ts`) across global `config.json`, `package.json` (`"netsuiteMcp"`), `project.json` (`"netsuiteMcp"`), and `.netsuitemcp.json`.

2. **Conditional Pre-Upload Project Build (`runProjectBuild`):**
   - Evaluates `shouldBuildProject(projectRoot, { skipBuild, filePaths }, projectConfig)`:
     - Skips if `skipBuild === true` or `buildBeforeUpload === false`.
     - Runs if `buildBeforeUpload === true`.
     - In `"auto"` mode (default): checks whether a `build` script exists in `package.json` (or an explicit `buildCommand` is configured) AND TypeScript is used (any input path ends in `.ts`, `tsconfig.json` exists, or `tsRootDir` exists).
   - If building is required, executes `buildCommand` (default `"npm run build"`) in `projectRoot`. If the build fails (e.g., TypeScript compilation error), the tool halts immediately and returns the compiler `stdout`/`stderr` without uploading stale `.js` files.

3. **TypeScript-to-File-Cabinet Path Resolution (`resolveProjectFiles`):**
   - For each path in `filePaths`, `resolveProjectFile` resolves:
     - `localOutputPath`: The absolute path on local disk to the compiled `.js` file (resolved via explicit `tsRootDir`/`jsOutDir`, `tsconfig.json` `ts.getOutputFileNames` / `rootDir`+`outDir` / in-place compilation, or `<sdfSourceDir>/FileCabinet/...`).
     - `fileCabinetPath`: The target NetSuite File Cabinet path starting with `/` (e.g., `"/SuiteScripts/sub/myScript.js"`).
   - Verifies that `existsOnDisk` is `true` for every resolved file. If any compiled `.js` file is missing on disk, halts before invoking SDF and reports the exact expected path(s).

4. **Isolated Temporary SDF Project Upload (`withTempSdfProject`):**
   - Calls `withTempSdfProject({ projectRoot, projectConfig, tempDirPrefix: "netsuite-mcp-upload-" })` (`src/utils/tempSdfProject.ts`):
     - Creates `<os.tmpdir()>/netsuite-mcp-upload-<random>/` with `FileCabinet/SuiteScripts/`, `Objects/`, `Translations/`, `project.json` (`{ "defaultAuthId": "<activeEnv.sdfId>" }`), `manifest.xml`, and `deploy.xml`.
   - Copies each compiled local file from `file.localOutputPath` into `<tempDir>/FileCabinet/<file.fileCabinetPath>`.
   - Deduplicates target File Cabinet paths and executes:
     ```bash
     suitecloud file:upload --paths "/SuiteScripts/file1.js" "/SuiteScripts/file2.js"
     ```
     inside `tempProject.tempDir`.
   - Guarantees removal of the temporary directory (`fs.rm(tempDir, { recursive: true, force: true })`) in a `finally` block.
