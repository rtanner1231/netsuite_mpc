# Compare Files (`netsuite_compare_files`)

[← Back to Tools Overview](../tools-overview.md)

## Description & Usage

`netsuite_compare_files` compares one or more local script files (`filePaths`) against the versions currently deployed in your active NetSuite environment's File Cabinet and returns a JSON array of comparison results with unified diffs (`diff`).

Just like [`netsuite_upload_file`](./netsuite_upload_file.md), it conditionally runs your project's TypeScript build first (`buildBeforeUpload`), resolves `.ts` or `.js` paths to their compiled local `.js` files and NetSuite File Cabinet paths, downloads the deployed files from NetSuite into an isolated temporary SDF project via `suitecloud file:import`, and computes a line-ending-normalized unified diff for each file.

### Comparison Status Values
For each file in `filePaths`, the returned object includes a `status` field:
- `"identical"` (`hasDifferences: false`, `diff: ""`): The compiled local file and the deployed NetSuite File Cabinet file match (ignoring CRLF vs. LF line-ending differences).
- `"modified"` (`hasDifferences: true`, `diff: "--- netsuite:/SuiteScripts/...\n+++ local:/SuiteScripts/..."`): Both files exist and differ; `diff` contains the unified patch.
- `"missing_remote"` (`hasDifferences: true`): The file exists locally on disk, but has not been uploaded to the NetSuite File Cabinet yet.
- `"missing_local"` (`hasDifferences: true`): The file exists in the NetSuite File Cabinet, but was not found on local disk.
- `"not_found"` (`hasDifferences: true`): The file was not found locally or in the NetSuite File Cabinet.

### Input Parameters

| Parameter | Type | Required | Description |
| :--- | :--- | :---: | :--- |
| `filePaths` | `string[]` | **Yes** | Non-empty array of local or File Cabinet paths to compare (e.g., `['TypeScripts/myScript.ts']`, `['src/FileCabinet/SuiteScripts/myScript.ts']`, or `['/SuiteScripts/myScript.js']`). |
| `skipBuild` | `boolean` | No | If `true`, skips running the project build command (`npm run build`) before comparing. Defaults to `false`. |
| `contextLines` | `number` | No | Number of surrounding context lines to include in unified diffs. Defaults to `3`. |

---

## Complementary Tools

- **[Upload File (`netsuite_upload_file`)](./netsuite_upload_file.md):** Run `netsuite_compare_files` before `netsuite_upload_file` to verify that no unexpected remote changes will be overwritten when you upload.
- **[Deploy Script (`netsuite_deploy_script`)](./netsuite_deploy_script.md):** Compare local script changes before running a full script deployment.
- **[View File (`netsuite_view_file`)](./netsuite_view_file.md):** Read the complete remote file directly via the RESTlet if you want to inspect the full file rather than a diff.

---

## Tool Metadata

| Property | Value |
| :--- | :--- |
| **Tool ID** | `netsuite_compare_files` |
| **Human-Readable Name** | Compare Files |
| **Category** | `sdf_file_deployment` (File Cabinet & SDF Files) |
| **Destructive (`isDestructive`)** | `false` |
| **Requires SDF (`requiresSdf`)** | **`true`** |
| **Default Availability** | On-demand via `netsuite_manage_toolsets` *(or enabled at startup in the `developer` preset)* |

---

## Inner Workings

1. **Conditional Build & Path Resolution:**
   - Resolves `projectRoot` and loads merged `projectConfig` (`getProjectConfig`).
   - Runs `runProjectBuild(projectRoot, { skipBuild, filePaths }, projectConfig)` so that if you edited a `.ts` file, it is compiled to `.js` before diffing against the deployed `.js` file in NetSuite.
   - Calls `resolveProjectFiles(projectRoot, filePaths, projectConfig)` to map every input path to `{ inputPath, fileCabinetPath, localOutputPath, existsOnDisk }`.

2. **Resilient Batch & Per-File SDF Import (`importFilesFromNetsuite`):**
   - Spins up an isolated temporary SDF project via `withTempSdfProject({ tempDirPrefix: "netsuite-mcp-compare-" })` configured with the active environment's `sdfId`.
   - First attempts a single batch import command for all unique `fileCabinetPaths`:
     ```bash
     suitecloud file:import --paths "/SuiteScripts/a.js" "/SuiteScripts/b.js" --excludeproperties
     ```
   - **Per-File Fallback on Batch Failure:** If one of the requested files is a brand-new local file that does not exist in NetSuite yet, `suitecloud file:import` fails the batch. When `uniquePaths.length > 1` and the batch command fails, `importFilesFromNetsuite` automatically falls back to running `suitecloud file:import` for each path individually so existing remote files still download and only the missing file is flagged in `importErrors`.

3. **Line-Ending Normalization & Unified Diff Computation:**
   - For each file:
     - Checks `localExists` (`file.localOutputPath`) and `remoteExists` (`tempProject.getLocalFileCabinetPath(file.fileCabinetPath)`), assigning `"not_found"`, `"missing_remote"`, or `"missing_local"` if either side is absent.
     - When both files exist, reads both as UTF-8 and normalizes `\r\n` to `\n` (`normalizeLineEndings`) so Windows vs. Unix line endings never produce noisy full-file diffs.
     - If `localContent === remoteContent`, returns `status: "identical"`, `hasDifferences: false`.
     - Otherwise calls `createTwoFilesPatch` (from the `diff` library) with headers `"netsuite:<fileCabinetPath>"` (`NetSuite Deployed`) and `"local:<fileCabinetPath>"` (`Local Build`) and `{ context: contextLines }`, returning `status: "modified"`, `hasDifferences: true`, and the unified `diff` string.
   - Cleans up the temporary SDF directory automatically on completion.
