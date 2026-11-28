# Get Script (`netsuite_get_script`)

[← Back to Tools Overview](../tools-overview.md)

## Description & Usage

`netsuite_get_script` loads comprehensive metadata for a NetSuite **Script record** (`customscript_*` or `custevsub_*`) and all of its **Script Deployments** (`customdeploy_*`) or Event Subscriber subscription `criteria` from either a `scriptId` or a `filePath` / file name.

### What It Returns
- **Script Header Metadata:** `internalId`, `scriptId`, `name`, `scriptType`, `description`, `isInactive`, `apiVersion`, `ownerId`, `ownerName`, `notifyOwner`, `notifyUser`, `notifyEmails`.
- **Bi-Directional File Mapping (`scriptFile` & `localSdfObjectXml`):**
  - Resolves the exact NetSuite File Cabinet path (`fileCabinetPath`, e.g., `"/SuiteScripts/SalesOrder/ue_salesorder.js"`) by walking `mediaitemfolder` parent links via SuiteQL.
  - Maps that File Cabinet path back to your **local workspace** compiled `.js` path (`localJsPath`, `localJsExists`), TypeScript `.ts` source path (`localTsPath`, `localTsExists`), and local SDF XML path (`localSdfObjectXml`: `{ exists, path, rootElement }`).
- **Enriched Deployments (`deployments`):**
  - Lists every deployment (`internalId`, `primaryKey`, `deploymentId`, `title`, `status`, `isDeployed`, `recordType`, `logLevel`, `runAsRoleId`, `runAsRoleName`, `isOnline`, `isEffectivelyActive`), plus live `url`, `externalUrl` (for Suitelets/RESTlets), and all `custscript_*` `parameterValues` loaded directly from the live `scriptdeployment` record.
- **Optional Full SDF XML Definition (`includeSdfXml: true`):**
  - When `includeSdfXml: true` is passed, also runs `suitecloud object:import` inside an isolated temporary SDF project (and hydrates any `[ACCOUNT_SPECIFIC_VALUE]` placeholders) to return the full parsed SDF XML (`sdfDefinition`: `{ rootElement, parsedObject, rawXml }`), including parameter definitions (`<scriptcustomfields>`), recurrence schedules (`<recurrence>`), and Event Subscriber `<criteria>`.

### Input Parameters

| Parameter | Type | Required | Description |
| :--- | :--- | :---: | :--- |
| `scriptId` | `string` | No* | Script custom ID (e.g., `'customscript_my_ue'`, `'custevsub_my_sub'`, or unprefixed `'my_ue'`) or numeric internal ID (`'1234'`). |
| `filePath` | `string` | No* | Script file path or file name (e.g., `'src/TypeScripts/my_ue.ts'`, `'/SuiteScripts/my_ue.js'`, or `'my_ue.js'`). |
| `includeSdfXml` | `boolean` | No | When `true`, also imports and parses the full SDF XML definition via SuiteCloud CLI (requires `sdfId` configured in `env.json`). Defaults to `false`. |

*\*Provide either `scriptId` or `filePath`.*

---

## Complementary Tools

- **[Deploy Script (`netsuite_deploy_script`)](./netsuite_deploy_script.md):** Call `netsuite_get_script` before `netsuite_deploy_script` to inspect the existing script's ID, deployments, parameter values, and local file mappings.
- **[Search Scripts (`netsuite_search_scripts`)](./netsuite_search_scripts.md):** If you do not know the `scriptId` or `filePath`, use `netsuite_search_scripts` to search by `recordType`, `scriptType`, or `searchTerm` first.
- **[View File (`netsuite_view_file`)](./netsuite_view_file.md) & [Compare Files (`netsuite_compare_files`)](./netsuite_compare_files.md):** Use the `scriptFile.fileCabinetPath` or `scriptFile.localTsPath` returned by `netsuite_get_script` to view the deployed code or diff it against your local workspace.
- **[Get Script Logs (`netsuite_get_script_logs`)](./netsuite_get_script_logs.md):** Pass the `scriptId` returned by `netsuite_get_script` to inspect its execution logs.

---

## Tool Metadata

| Property | Value |
| :--- | :--- |
| **Tool ID** | `netsuite_get_script` |
| **Human-Readable Name** | Get Script |
| **Category** | `script_management` (Script Management) |
| **Destructive (`isDestructive`)** | `false` |
| **Requires SDF (`requiresSdf`)** | `false` *(Base SuiteQL/RESTlet lookup does not require SDF; optional `includeSdfXml: true` uses SDF when `sdfId` is configured)* |
| **Default Availability** | On-demand via `netsuite_manage_toolsets` *(or enabled at startup in the `developer` and `admin` presets)* |

---

## Inner Workings

1. **Flexible Lookup by `scriptId` or `filePath` (`getScriptData` in `src/utils/scriptQueries.ts`):**
   - If `filePath` is provided, calls `resolveProjectFile` to map a local `.ts` or `.js` path to its expected NetSuite File Cabinet path (`resolvedInputFcPath`) and base filename (`lookupFileName`).
   - If `scriptId` is provided:
     - If numeric (`/^\d+$/`), filters on `s.id = <number>`.
     - Otherwise constructs candidate script IDs covering `customscript_<id>`, `custevsub_<id>`, and NetSuite's internal SuiteQL Event Subscriber ID `custevsub_<id>_script`.
   - Executes a SuiteQL query joining `script s` and `LEFT JOIN file f ON f.id = s.scriptfile` (using `BUILTIN.DF(s.owner)` for the owner display name).

2. **Full File Cabinet Path Reconstruction & Disambiguation (`resolveRemoteFileCabinetPathsByFileIds`):**
   - Queries `file` and iteratively walks `mediaitemfolder` parent links (seeded with NetSuite's negative system root folder IDs like `-15` for `SuiteScripts`) to build the full `/SuiteScripts/.../*.js` path for each matched script.
   - If the caller searched by `filePath` (e.g., `"src/TypeScripts/subA/index.ts"`) and multiple scripts in NetSuite share the base filename `"index.js"` in different subfolders, the tool filters the results to the exact full `fileCabinetPath` match.

3. **Deployment Query & Live `scriptdeployment` Hydration (`fetchDeploymentsByScriptInternalIds`):**
   - Queries `scriptdeployment d` via SuiteQL for all deployments belonging to the matched script internal IDs (`primarykey`, `version`, `scriptid`, `title`, `status`, `isdeployed`, `recordtype`, `loglevel`, `runasrole`, `BUILTIN.DF(d.runasrole)`, `isonline`).
   - For each deployment with a valid `primaryKey`, calls `fetchLiveScriptDeploymentRecordFields(primaryKey)` (which invokes `RECORD_SAMPLE` on `recordType: "scriptdeployment"` in the RESTlet) to extract:
     - Live `url` and `externalUrl` endpoints (for Suitelets and RESTlets).
     - All `custscript_*` deployment parameter values (`parameterValues`).
   - Computes `isEffectivelyActive`: `true` when `!script.isInactive` AND (the script is an active `EVENTSUBSCRIBER` OR (`deployment.isDeployed === true` AND `status` is `'RELEASED'`, `'TESTING'`, `'SCHEDULED'`, or `'INPROGRESS'`)).

4. **Reverse Mapping to Local Workspace Files (`resolveLocalPathsFromFileCabinetPath`):**
   - Maps the resolved NetSuite File Cabinet path back to the local workspace:
     - Checks `localJsPath` (via `resolveProjectFile`, `config.jsOutDir`, `tsconfig.outDir`, and `<sdfSrcDir>/FileCabinet/SuiteScripts`).
     - Checks `localTsPath` (via `config.tsRootDir`, `tsconfig.rootDir`, `TypeScripts/`, `src/TypeScripts/`, `src/FileCabinet/`, and `tsconfig.commandLine.fileNames`), reporting both the expected path and `localTsExists: true/false`.
     - Searches `<sdfSrcDir>/Objects` recursively for `<scriptId>.xml` (`findLocalScriptXmlById`).

5. **Optional SDF XML Import & Local-Only Fallback:**
   - When `includeSdfXml: true`, imports `<scriptId>.xml` via `suitecloud object:import` in a temporary SDF project and hydrates any `[ACCOUNT_SPECIFIC_VALUE]` placeholders (`hydrateAccountSpecificValuesInParsedScript`).
   - If the script has not been deployed to NetSuite yet (`foundInNetsuite: false`) but exists in your local `<sdfSrcDir>/Objects/` folder, the tool automatically falls back to parsing and returning the local SDF XML (`foundLocally: true`, `source: "local_sdf_only"`).
