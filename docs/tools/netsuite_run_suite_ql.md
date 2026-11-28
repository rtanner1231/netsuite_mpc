# Run SuiteQL (`netsuite_run_suite_ql`)

[← Back to Tools Overview](../tools-overview.md)

## Description & Usage

`netsuite_run_suite_ql` executes an arbitrary **SuiteQL** query against your active NetSuite environment via the deployed MCP Services RESTlet (`rl_mcp_services.js`) and returns the mapped result rows along with the query execution duration in milliseconds (`timeElapsedMS`).

### When to Use It
- **Ad-hoc data querying & reporting:** Retrieving transactions, customers, items, custom record instances, accounting lines, system notes, or configuration data from NetSuite.
- **Verifying record states:** Checking whether specific records, custom fields, or script deployments exist and inspecting their field values.
- **Prototyping queries for SuiteScript or Datasets:** Testing complex `SELECT`, `JOIN`, `GROUP BY`, and Oracle SQL functions (`BUILTIN.DF(...)`, `TO_CHAR(...)`, `NVL(...)`, `ROWNUM`) live against NetSuite.

### Input Parameters

| Parameter | Type | Required | Description |
| :--- | :--- | :---: | :--- |
| `query` | `string` | **Yes** | The SuiteQL query string to execute (e.g., `"SELECT TOP 10 id, tranid, trandate, BUILTIN.DF(entity) AS customer_name, foreigntotal FROM transaction WHERE type = 'SalesOrd' ORDER BY id DESC"`). |

---

## Complementary Tools

- **[Search Tables (`netsuite_search_tables`)](./netsuite_search_tables.md):** Discover the exact SuiteQL table IDs (`transaction`, `transactionline`, `transactionaccountingline`, `customrecord_*`, etc.) before writing a query.
- **[Get Fields (`netsuite_get_fields`)](./netsuite_get_fields.md):** Inspect all available column IDs and data types for a table so you never guess non-existent SuiteQL columns.
- **[Get Related Tables (`netsuite_get_related_tables`)](./netsuite_get_related_tables.md):** Get exact foreign-key join conditions (`source.field = target.id`) across 1 to 5 hops for SuiteQL `JOIN` clauses.
- **[Create Dataset (`netsuite_create_dataset`)](./netsuite_create_dataset.md):** If a user wants to turn a SuiteQL query into a reusable SuiteAnalytics Workbook Dataset in the NetSuite UI, `netsuite_create_dataset` uses the exact same schema and even outputs `generatedSuiteQL`.

---

## Tool Metadata

| Property | Value |
| :--- | :--- |
| **Tool ID** | `netsuite_run_suite_ql` |
| **Human-Readable Name** | Run SuiteQL |
| **Category** | `data_operations` (Data Querying & Record Operations) |
| **Destructive (`isDestructive`)** | `false` |
| **Requires SDF (`requiresSdf`)** | `false` |
| **Default Availability** | Enabled at startup by default |

---

## Inner Workings

1. **OAuth 1.0a Request Signing (`callNetsuiteRestlet`):**
   - Loads the active environment's credentials from `env.json` (`accountId`, `scriptId`, `deploymentId`, `consumerKey`, `consumerSecret`, `token`, `tokenSecret`).
   - Constructs the RESTlet endpoint URL:
     ```text
     https://<accountId>.restlets.api.netsuite.com/app/site/hosting/restlet.nl?script=<scriptId>&deploy=<deploymentId>
     ```
   - Signs the HTTP `POST` request using OAuth 1.0a (`HMAC-SHA256`) with the `realm` set to `accountId.toUpperCase().replace('-', '_')` and sends the payload `{ action: "RUN_SUITE_QL", query: args.query }`.

2. **RESTlet Execution (`handleRunSuiteQL` in `rl_mcp_services.js`):**
   - Validates that `request.query` is a non-empty string.
   - Starts an `ExecutionTimer` (`Date.now()`).
   - Executes `query.runSuiteQL({ query: request.query }).asMappedResults()` via NetSuite's `N/query` module.
     - *(Note: `N/query.runSuiteQL` is strictly read-only in NetSuite and returns up to 5,000 mapped row objects per call.)*
   - Returns `{ success: true, results, timeElapsedMS }`.
   - If NetSuite throws a SuiteQL syntax or invalid-identifier exception, `extractFieldsFromErrorMessage` parses the NetSuite JSON error object (`type`, `name`, `message`) into a clean diagnostic message (`Query failed with error: <type>: <name> - <message>`).
