# `netsuite_create_record` Tool Reference

## Overview

`netsuite_create_record` is an MCP tool that creates a new record instance in the active NetSuite environment for a specified table/record type (`table_id`) and populates its body fields (`fields`), returning the newly created internal `recordId`.

- **Tool Name**: `netsuite_create_record`
- **Destructive**: Yes (disabled in environments configured with `disableDestructive: true`)
- **Requires SDF**: No (executes via the NetSuite MCP RESTlet)

---

## Input Schema

```json
{
  "type": "object",
  "properties": {
    "table_id": {
      "type": "string",
      "description": "The NetSuite record type / table ID (e.g., 'customer', 'salesorder', or a custom record scriptId such as 'customrecord_...')."
    },
    "fields": {
      "type": "array",
      "description": "An array of fieldId and value pairs to set on the newly created record.",
      "items": {
        "type": "object",
        "properties": {
          "fieldId": {
            "type": "string",
            "description": "The internal ID of the body field to set (e.g., 'companyname', 'subsidiary', or 'custrecord_...')."
          },
          "value": {
            "description": "The value to assign to the field. For date/datetime fields, pass an ISO string (e.g., 'YYYY-MM-DD' or 'YYYY-MM-DDTHH:mm:ss').",
            "anyOf": [
              { "type": "string" },
              { "type": "number" },
              { "type": "boolean" },
              {
                "type": "array",
                "items": {
                  "anyOf": [
                    { "type": "string" },
                    { "type": "number" }
                  ]
                }
              },
              { "type": "null" }
            ]
          }
        },
        "required": ["fieldId", "value"]
      }
    }
  },
  "required": ["table_id", "fields"]
}
```

### Input Parameters

| Parameter | Type | Required | Description |
| :--- | :--- | :---: | :--- |
| `table_id` | `string` | Yes | The NetSuite record type or table script ID (e.g., `"customer"`, `"employee"`, `"customrecord_my_record"`). |
| `fields` | `Array<{ fieldId, value }>` | Yes | Ordered array of body fields and values to set on the record before saving. |
| `fields[].fieldId` | `string` | Yes | The internal field ID (e.g., `"name"`, `"companyname"`, `"subsidiary"`, `"custrecord_status"`). |
| `fields[].value` | `string \| number \| boolean \| array \| null` | Yes | Value to set on the field (see value formatting conventions below). |

### Value Formatting Conventions

- **Text / Email / Phone / URL**: Pass as a `string` (e.g., `"Acme Corp"`).
- **Integer / Float / Currency / Percent**: Pass as a `number` (e.g., `100`, `49.95`).
- **Checkbox (Boolean)**: Pass as a `boolean` (`true` or `false`).
- **Select (List/Record Reference)**: Pass the internal ID of the target record or list value as a `number` or `string` (e.g., `1` or `"1"`).
- **Multi-Select**: Pass an array of internal IDs (e.g., `[1, 2, 3]` or `["1", "2"]`).
- **Date / DateTime**: Pass an ISO-8601 date string (`"YYYY-MM-DD"`, e.g., `"2026-11-16"`) or ISO-8601 datetime string (`"YYYY-MM-DDTHH:mm:ss"`, e.g., `"2026-11-16T14:30:00Z"`).
- **Clearing a Field**: Pass `null` or `""`.

> **Tip**: Because records are created in dynamic mode, field order can matter when one field sources or filters another (for example, setting `"subsidiary"` or `"customform"` first before setting subsidiary-specific fields).

---

## Example Tool Call

```json
{
  "table_id": "customrecord_project_task",
  "fields": [
    { "fieldId": "name", "value": "Initial Kickoff" },
    { "fieldId": "custrecord_task_owner", "value": 42 },
    { "fieldId": "custrecord_start_date", "value": "2026-11-16" },
    { "fieldId": "custrecord_is_billable", "value": true },
    { "fieldId": "custrecord_estimated_hours", "value": 8.5 }
  ]
}
```

---

## Output Format

The tool returns a text content block containing a JSON-formatted response object (or an error string if a transport/configuration failure occurred).

### 1. Success Response

```json
{
  "success": true,
  "recordId": 1045,
  "recordType": "customrecord_project_task",
  "timeElapsedMS": 184,
  "governanceUsed": 6
}
```

| Field | Type | Description |
| :--- | :--- | :--- |
| `success` | `boolean` | `true` when the record was created and saved in NetSuite. |
| `recordId` | `number` | The internal ID of the newly created NetSuite record. |
| `recordType` | `string` | The record type (`table_id`) that was created. |
| `timeElapsedMS` | `number` | Execution duration in milliseconds inside NetSuite. |
| `governanceUsed` | `number` | NetSuite SuiteScript governance units consumed by the operation. |

### 2. NetSuite / Validation Error Response

If record creation, field assignment, or saving fails in NetSuite (e.g., invalid `table_id`, invalid `fieldId`, invalid field value, or missing mandatory fields on save), the tool returns:

```json
{
  "success": false,
  "errorMessage": "Unable to create record: Failed to set field \"custrecord_task_owner\": Invalid custrecord_task_owner reference key 999999."
}
```

| Field | Type | Description |
| :--- | :--- | :--- |
| `success` | `boolean` | `false` when the operation failed. |
| `errorMessage` | `string` | Detailed error description indicating whether record creation, a specific `fieldId`, or `save()` failed. |

### 3. Transport / Environment Restrictions

- **Disabled in Environment**:
  ```text
  Tool 'netsuite_create_record' is disabled in the 'Prod' environment (destructive tools are disabled).
  ```
- **HTTP / Connection Error**:
  ```text
  RESTlet Error: NetSuite RESTlet HTTP Error 401: ...
  ```

---

## Recommended Agent Workflow

1. **Discover the Table / Record Type** (if unknown):
   - Use `netsuite_search_tables` to find the appropriate `table_id`.
2. **Inspect Available Fields & Existing Values**:
   - Use `netsuite_get_fields` with `table_id` to check field IDs (`fieldId`), data types, and whether the custom record includes a `"name"` field (`Include Name Field: Yes/No`).
   - Optionally call `netsuite_load_record_sample` with `record_type: table_id` to see a real record's populated fields and required values.
3. **Create the Record**:
   - Call `netsuite_create_record` with `table_id` and the `fields` array.
   - Verify `"success": true` in the response and capture `recordId`.
