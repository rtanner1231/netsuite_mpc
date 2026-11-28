# Search Scripts (`netsuite_search_scripts`)

[← Back to Tools Overview](../tools-overview.md)

## Description & Usage

`netsuite_search_scripts` searches NetSuite **Script records** (`customscript_*` and `custevsub_*`) and their **Script Deployments** (`customdeploy_*`) via SuiteQL in the MCP Services RESTlet, supporting rich filters for target `recordType`, `scriptType`, partial `searchTerm`, `fileName`, `isDeployed`, deployment `status`, `logLevel`, and `includeInactive`.

It returns matching scripts grouped with their resolved File Cabinet paths (`/SuiteScripts/...`), deployment lists, and an `isEffectivelyActive` boolean on every deployment.

### When to Use It
- **Auditing scripts on a record type:** Pass `recordType: "salesorder"` (or `"customer"`, `"invoice"`, `"customrecord_..."`) to see every User Event, Client, Workflow Action, or Mass Update script deployed against that record type.
- **Finding a script by partial name, ID, or file:** Pass `searchTerm: "billing"` or `fileName: "ue_order.js"` to locate a script's `scriptId`, `internalId`, and `fileCabinetPath`.
- **Filtering by script type or operational state:** Find all `MAPREDUCE` or `SCHEDULED` scripts with `status: "SCHEDULED"`, or find scripts running with `logLevel: "DEBUG"`.

### Input Parameters

| Parameter | Type | Required | Description |
| :--- | :--- | :---: | :--- |
| `recordType` | `string` | No | Filter by the target record type a script is deployed against (e.g., `'salesorder'`, `'customer'`, `'invoice'`, or `'customrecord_...'`). Case-insensitive. |
| `scriptType` | `string` | No | Filter by script type: `'USEREVENT'`, `'CLIENT'`, `'MAPREDUCE'`, `'SCHEDULED'`, `'SUITELET'`, `'RESTLET'`, `'WORKFLOWACTION'`, `'MASSUPDATE'`, `'PORTLET'`, `'BUNDLEINSTALLATION'`, or `'EVENTSUBSCRIBER'`. |
| `searchTerm` | `string` | No | Case-insensitive partial search term matched across script name, `scriptId` (`customscript_*` / `custevsub_*`), `deploymentId` (`customdeploy_*`), deployment title, or script file name. |
| `fileName` | `string` | No | Filter by script file name or path (e.g., `'my_script.js'` or `'TypeScripts/my_script.ts'`). |
| `isDeployed` | `boolean` | No | Filter by whether the deployment's **Deployed** checkbox is checked (`true` = deployed, `false` = undeployed). |
| `status` | `string` | No | Filter by deployment status (e.g., `'RELEASED'`, `'TESTING'`, `'NOTSCHEDULED'`, `'SCHEDULED'`, `'INPROGRESS'`). |
| `logLevel` | `"DEBUG"` \| `"AUDIT"` \| `"ERROR"` \| `"EMERGENCY"` | No | Filter by deployment execution log level. |
| `includeInactive` | `boolean` | No | Whether to include inactive scripts (`isinactive = 'T'`). Defaults to `false`. |
| `limit` | `number` | No | Maximum number of distinct script records to return (`default: 100`, `max: 500`). |

---

## Complementary Tools

- **[Get Script (`netsuite_get_script`)](./netsuite_get_script.md):** Once `netsuite_search_scripts` finds the script(s) you are looking for, call `netsuite_get_script` with `scriptId` (and optional `includeSdfXml: true`) to inspect live deployment `parameterValues`, URLs, local workspace `.ts`/`.js`/`Objects/*.xml` mappings, and full SDF XML definitions.
- **[View File (`netsuite_view_file`)](./netsuite_view_file.md):** Pass the `fileCabinetPath` or `fileId` from `netsuite_search_scripts` to read the script's deployed JavaScript source code in NetSuite.
- **[Get Script Logs (`netsuite_get_script_logs`)](./netsuite_get_script_logs.md):** Pass the `scriptId` from `netsuite_search_scripts` to inspect recent execution logs.
- **[Deploy Script (`netsuite_deploy_script`)](./netsuite_deploy_script.md):** Update or redeploy a script discovered via `netsuite_search_scripts`.

---

## Tool Metadata

| Property | Value |
| :--- | :--- |
| **Tool ID** | `netsuite_search_scripts` |
| **Human-Readable Name** | Search Scripts |
| **Category** | `script_management` (Script Management) |
| **Destructive (`isDestructive`)** | `false` |
| **Requires SDF (`requiresSdf`)** | `false` |
| **Default Availability** | On-demand via `netsuite_manage_toolsets` *(or enabled at startup in the `developer` and `admin` presets)* |

---

## Inner Workings

1. **Dynamic SuiteQL Query Construction (`searchScriptsInNetsuite` in `src/utils/scriptQueries.ts`):**
   - Builds a `WHERE` clause against `script s`, `LEFT JOIN file f ON f.id = s.scriptfile`, and `LEFT JOIN scriptdeployment d ON d.script = s.id`:
     - **`includeInactive`:** Adds `s.isinactive = 'F'` unless `includeInactive: true`.
     - **`recordType`:** Strips any `[scriptid=...]` wrapper and adds `UPPER(d.recordtype) = UPPER('<recordType>')`.
     - **`scriptType` (`getSuiteQlScriptTypeTokens`):** Maps canonical script types to all internal NetSuite SuiteQL `script.scripttype` token variations (for example, `SUITELET` matches `('SCRIPTLET', 'SUITELET')`; `WORKFLOWACTION` matches `('ACTION', 'WORKFLOWACTION', 'WORKFLOWACTIONSCRIPT')`; `USEREVENT` matches `('USEREVENT', 'SCRIPTLET_USEREVENT', 'USEREVENTSCRIPT')`).
     - **`fileName`:** Extracts the base filename, converts any `.ts` extension to `.js`, and adds `LOWER(f.name) LIKE LOWER('%<fileName>%')`.
     - **`isDeployed` (with Event Subscriber Awareness):** In NetSuite's internal `scriptdeployment` table, active Event Subscriber (`custevsub_*`) deployments store `d.isdeployed = 'F'` even though they are active! Therefore, when `isDeployed: true`, the SQL filter checks `(d.isdeployed = 'T' OR LOWER(s.scriptid) LIKE 'custevsub_%' OR UPPER(s.scripttype) LIKE '%EVENTSUBSCRIBER%')`.
     - **`status` & `logLevel`:** Adds `UPPER(d.status) = UPPER('<status>')` and `UPPER(d.loglevel) = UPPER('<logLevel>')`.
     - **`searchTerm`:** Matches `%<term>%` across `s.name`, `s.scriptid`, `d.scriptid`, `d.title`, and `f.name`.

2. **Grouping Scripts & Deployments:**
   - Executes the SuiteQL query via the MCP Services RESTlet (`RUN_SUITE_QL`).
   - Groups the joined rows by `s.id` (`internal_id`) up to `limit` distinct scripts (clamped between `1` and `500`, default `100`).
   - Canonicalizes Event Subscriber script IDs via `canonicalizeSuiteQlScriptId` (converting SuiteQL's `custevsub_foo_script` back to the canonical SDF ID `custevsub_foo`).

3. **Full File Cabinet Path Resolution & Effective Active Calculation:**
   - Batch-resolves all `script_file_id` values via `resolveRemoteFileCabinetPathsByFileIds` (querying `file` and walking `mediaitemfolder` parent links) so every returned script includes its full `/SuiteScripts/...` `fileCabinetPath`.
   - For each deployment on each script, computes `isEffectivelyActive` (`!script.isInactive && (isEventSubscriber || (d.isDeployed && ['RELEASED', 'TESTING', 'SCHEDULED', 'INPROGRESS'].includes(d.status)))`).
