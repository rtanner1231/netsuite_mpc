# Deploy Script (`netsuite_deploy_script`)

[← Back to Tools Overview](../tools-overview.md)

## Description & Usage

`netsuite_deploy_script` creates or updates (upserts) a NetSuite **Script record** (`customscript_*` or `custevsub_*`), its **script parameters** (`custscript_*`), and its **script deployments & recurrence schedules** (`customdeploy_*`) or **Event Subscriber subscription criteria**, while conditionally building and uploading the script `.js` file (plus any `additionalFiles`) in a **single atomic SDF deployment** inside an isolated temporary SDF project.

### Key Capabilities
- **Supports All 11 SuiteScript 2.x Types:** `USEREVENT` (`<usereventscript>`), `CLIENT` (`<clientscript>`), `MAPREDUCE` (`<mapreducescript>`), `SCHEDULED` (`<scheduledscript>`), `SUITELET` (`<suitelet>`), `RESTLET` (`<restlet>`), `WORKFLOWACTION` (`<workflowactionscript>`), `MASSUPDATE` (`<massupdatescript>`), `PORTLET` (`<portlet>`), `BUNDLEINSTALLATION` (`<bundleinstallationscript>`), and `EVENTSUBSCRIBER` (`<eventsubscriber>`).
- **Auto-Detection from Source Code:** Automatically reads `@NScriptType`, `@NApiVersion`, and exported entry-point functions from your `.ts` or `.js` file header.
- **Duplicate-Script Protection:** Before creating a new script record, the tool queries both NetSuite (via SuiteQL) and your local `Objects/` directory to see if `filePath` already has an existing script record with a different `scriptId`. If a conflict is found, it halts and reports the existing `scriptId` unless `forceCreateNewScript: true` is explicitly passed.
- **Account-Specific Value Hydration:** When updating an existing script via SDF, `suitecloud object:import` replaces certain parameter and deployment values with `[ACCOUNT_SPECIFIC_VALUE]`. `netsuite_deploy_script` automatically hydrates those placeholders from your local `Objects/<scriptId>.xml` and from live `record.load({ type: 'scriptdeployment' })` calls via the RESTlet so existing parameter values are never lost or broken!
- **Automatic Local Timezone -> UTC Schedule Conversion:** For Scheduled and Map/Reduce deployment schedules, pass `startDate` (`YYYY-MM-DD`) and `startTime` (`HH:mm:ss`) in your NetSuite account's local timezone—the tool queries the account's timezone and converts the date, time, and day-of-week/day-of-month offsets to the UTC format required by NetSuite SDF XML.

### Input Parameters

| Parameter | Type | Required | Description |
| :--- | :--- | :---: | :--- |
| `filePath` | `string` | Conditional* | Path to the `.ts` or `.js` script file (e.g., `'src/TypeScripts/my_ue.ts'` or `'/SuiteScripts/my_ue.js'`). Required when creating a new script or uploading code changes; optional when updating an existing script by `scriptId`. |
| `scriptId` | `string` | Conditional* | Custom script ID (`'customscript_...'` max 40 chars, or `'custevsub_...'` max 27 chars for Event Subscribers; auto-prefixed if omitted). Optional when updating an existing script already linked to `filePath`. |
| `scriptType` | `string` | No | Script type override (`USEREVENT`, `CLIENT`, `MAPREDUCE`, `SCHEDULED`, `SUITELET`, `RESTLET`, `WORKFLOWACTION`, `MASSUPDATE`, `PORTLET`, `BUNDLEINSTALLATION`, `EVENTSUBSCRIBER`). Auto-detected from `@NScriptType` or existing script record when omitted. |
| `name` | `string` | Conditional | Display name of the script record (max 40 chars). Required when creating a new non-`EVENTSUBSCRIBER` script. |
| `description` | `string` | No | Description of the script record. |
| `isInactive` | `boolean` | No | Mark the script record inactive (`default: false` on creation). |
| `notifyOwner` / `notifyUser` / `notifyEmails` | `boolean` / `string` | No | Error notification settings (`notifyOwner` defaults to `true` on creation). |
| `portletType` | `"FORM"` \| `"HTML"` \| `"LINKS"` \| `"LIST"` | No | *(PORTLET only)* Portlet type (`default: "FORM"`). |
| `returnType` / `returnRecordType` | `string` | No | *(WORKFLOWACTION only)* Return value type and record type (when `returnType` is `'SELECT'`). |
| `parameters` | `ScriptParameterInput[]` | No | Array of script parameters (`custscript_*`) `{ scriptId, label, type, selectRecordType?, description?, helpText?, defaultValue?, isMandatory?, setting?, displayType? }` to add or update in-place. |
| `deployments` | `ScriptDeploymentInput[]` | No | Array of script deployments (`customdeploy_*`) `{ scriptId?, title?, isDeployed?, status?, logLevel?, recordType?, eventType?, runAsRole?, allRoles?, audienceRoles?, allEmployees?, allPartners?, isOnline?, concurrencyLimit?, yieldAfterMins?, bufferSize?, parameterValues?, schedule? }` to create or update in-place. |
| `criteria` | `EventSubscriberCriterionInput[]` | Conditional | *(Required for new `EVENTSUBSCRIBER` scripts)* Array of subscription criteria `{ domain?: 'RECORD', type: 'CREATED' | 'UPDATED' | 'DELETED', recordType?: string, parameters?: [...] }`. |
| `additionalFiles` | `string[]` | No | Additional helper/library script file paths to compile and upload alongside `filePath`. |
| `skipBuild` | `boolean` | No | Skip running the project build command before uploading files. |
| `skipFileUpload` | `boolean` | No | Skip uploading the `.js` script file and only deploy the script/deployment SDF XML object. |
| `forceCreateNewScript` | `boolean` | No | Set to `true` only when intentionally creating an additional script record for a file that already has an existing script record with a different `scriptId`. |
| `saveToProject` | `boolean` | No | Override whether the deployed `<scriptId>.xml` (and `manifest.xml` dependencies) is copied into your local project (`Objects/`). Defaults to `projectConfig.saveObjectsToProject` (`"auto"`). |

*\*At least one of `filePath` or `scriptId` must be provided.*

---

## Complementary Tools

- **[Get Script (`netsuite_get_script`)](./netsuite_get_script.md):** Inspect an existing script's metadata, deployments, parameters, and schedules (with `includeSdfXml: true`) before modifying it with `netsuite_deploy_script`.
- **[Search Scripts (`netsuite_search_scripts`)](./netsuite_search_scripts.md):** Search existing scripts deployed against a `recordType` or matching a `searchTerm` before deploying a new script.
- **[Upload File (`netsuite_upload_file`)](./netsuite_upload_file.md):** If you only changed code inside an already-deployed `.ts`/`.js` file and do not need to change script parameters, deployments, or schedules, `netsuite_upload_file` is even faster because it runs `suitecloud file:upload` instead of a full `suitecloud project:deploy`.
- **[Get Script Logs (`netsuite_get_script_logs`)](./netsuite_get_script_logs.md):** Check execution logs for the deployed script after triggering it in NetSuite.

---

## Tool Metadata

| Property | Value |
| :--- | :--- |
| **Tool ID** | `netsuite_deploy_script` |
| **Human-Readable Name** | Deploy Script |
| **Category** | `script_management` (Script Management) |
| **Destructive (`isDestructive`)** | **`true`** |
| **Requires SDF (`requiresSdf`)** | **`true`** |
| **Default Availability** | On-demand via `netsuite_manage_toolsets` *(or enabled at startup in the `developer` and `admin` presets)* |

---

## Inner Workings

1. **Step 1 — Build, File Resolution & Source Code Inspection (`buildAndResolveScriptFiles` in `src/utils/scripts.ts`):**
   - If `filePath` is provided and `skipFileUpload` is not `true`, conditionally builds the project (`runProjectBuild`) and resolves `filePath` (and any `additionalFiles`) to their compiled `.js` local paths and NetSuite File Cabinet paths (`/SuiteScripts/...`). Verifies all compiled `.js` files exist on disk.
   - Calls `inspectScriptSourceFile`, which parses the source file for `@NScriptType`, `@NApiVersion`, and exported entry-point functions (`beforeLoad`, `beforeSubmit`, `afterSubmit`, `onRequest`, `get`, `post`, `execute`, `getInputData`, `map`, `reduce`, `summarize`, `handle`, etc.).

2. **Step 2 — Duplicate-Script Conflict Detection & Auto-ID Resolution (`resolveOrValidateTargetScriptId`):**
   - Normalizes `scriptId`: standard scripts are prefixed with `customscript_` (max 40 chars); Event Subscriber scripts (`EVENTSUBSCRIBER`) are prefixed with `custevsub_` (max 27 chars, and any SuiteQL `_script` suffix is stripped).
   - If `filePath` is provided, concurrently runs:
     - `findRemoteScriptsForFileCabinetPath`: Queries NetSuite's `script` and `file` tables via SuiteQL and walks `mediaitemfolder` parent links to find any deployed script record pointing to that exact File Cabinet path.
     - `findLocalScriptXmlsForFileCabinetPath`: Recursively scans local `<sdfSrcDir>/Objects/*.xml` for any script XML whose `<scriptfile>` or `<scriptfilepath>` matches `[<fileCabinetPath>]`.
   - **Conflict Guard:** If `requestedScriptId` was provided, does not exist yet, and another script record already points to that File Cabinet path, the tool halts and returns a `Duplicate Script Conflict Detected` message listing the existing script IDs unless `forceCreateNewScript: true` was passed.
   - **Auto-Resolution:** If the caller omitted `scriptId` and exactly 1 existing script record points to `filePath`, `scriptId` is resolved to that script automatically.

3. **Step 3 — Existing XML Import & `[ACCOUNT_SPECIFIC_VALUE]` Hydration (`loadExistingAndResolveScriptType`):**
   - Spins up an isolated temporary SDF project via `withTempSdfProject`.
   - Attempts `suitecloud object:import --type <rootElement|ALL> --scriptid <finalScriptId> --destinationfolder /Objects`.
   - If imported from NetSuite, calls `hydrateAccountSpecificValuesInParsedScript` (`src/utils/scriptQueries.ts`):
     - If any node in `<scriptcustomfields>` or `<scriptdeployments>` contains `[ACCOUNT_SPECIFIC_VALUE]`, it queries the deployment's `primarykey` via SuiteQL, loads the live `scriptdeployment` record via the RESTlet (`RECORD_SAMPLE`), and replaces `[ACCOUNT_SPECIFIC_VALUE]` with the actual live parameter/field value (falling back to local `Objects/<scriptId>.xml` if present).

4. **Step 4 — XML Merge, Timezone Conversion & Canonical Key Ordering (`buildMergedScriptXml` in `src/utils/scriptXml.ts`):**
   - For Scheduled and Map/Reduce scripts, `resolveNetsuiteAccountTimeZone` queries `companypreference` (`TIMEZONE`) and `SELECT SESSIONTIMEZONE FROM DUAL` via SuiteQL to determine the NetSuite account's IANA timezone or UTC offset. `convertLocalScheduleToSdfUtc` then uses a two-pass DST-aware offset calculation to convert local `(startDate, startTime)` into UTC `<startdate>YYYY-MM-DD</startdate>`, `<starttime>HH:mm:ssZ</starttime>`, and day-shift adjustments (`dayShift` for weekly day-of-week flags and monthly/yearly `dayofmonth`).
   - Merges `<scriptcustomfields>` (updating matching `custscript_*` parameters in-place and appending new ones) and `<scriptdeployments>` (updating matching `customdeploy_*` deployments in-place and appending new ones, or creating a default `customdeploy_<suffix>` deployment on creation).
   - For `EVENTSUBSCRIBER` scripts, builds `<criteria><criterion><domain>RECORD</domain><type>CREATED|UPDATED|DELETED</type><parameters>...</parameters></criterion></criteria>`.
   - **Strict SDF Element Ordering (`orderScriptRootObjectKeys` & `orderScriptDeploymentNodeKeys`):** NetSuite SDF's XSD validator rejects script XML files if elements are out of alphabetical schema order. The tool sorts all header elements alphabetically, places `<criteria>`, `<scriptcustomfields>`, and `<scriptdeployments>` at the end of the root element, and inside each `<scriptdeployment>` sorts all standard and `custscript_*` elements alphabetically with `<recurrence>` placed last.

5. **Step 5 — Staging, `manifest.xml` Dependency Injection, Deployment & Local Sync (`stageAndExecuteScriptDeploy`):**
   - Writes `<finalScriptId>.xml` to `<tempDir>/Objects/` and copies the compiled `.js` script file(s) to `<tempDir>/FileCabinet/...`.
   - Configures `<tempDir>/deploy.xml` with the staged files and object, and updates `<tempDir>/manifest.xml` with `SERVERSIDESCRIPTING`, any `[scriptid=...]` object dependencies (`customrecord_*`, `customlist_*`, `customrole_*`), and `<files>` references (if `skipFileUpload: true`).
   - Runs `suitecloud project:deploy --accountspecificvalues WARNING`.
   - If deployment succeeds and `saveToProject` resolves to `true`, calls `syncSdfObjectToMainProject` to update an existing `<scriptId>.xml` in-place or save a new one according to `objectsFolderStrategy` (`"branch"`, `"flat"`, or `"type"`) and update local `manifest.xml` dependencies.
