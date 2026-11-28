# Upsert Custom Field (`netsuite_upsert_custom_field`)

[← Back to Tools Overview](../tools-overview.md)

## Description & Usage

`netsuite_upsert_custom_field` creates or updates one or more **standalone Custom Fields** on native NetSuite records in a **single atomic SDF deployment pass** via an isolated temporary SDF project.

### Supported Standalone Custom Field Categories (`fieldCategory`)

| `fieldCategory` | SDF Root Element | Required Prefix | Max ID Length | How Target Records Are Specified |
| :--- | :--- | :--- | :---: | :--- |
| `'transaction_body'` | `<transactionbodycustomfield>` | `custbody_` | 38 chars | `appliesTo` (e.g., `['SALE', 'PURCHASE', 'ITEM_FULFILLMENT', 'JOURNAL']`) |
| `'transaction_line'` | `<transactioncolumncustomfield>` | `custcol_` | 38 chars | `appliesTo` (e.g., `['SALE', 'PURCHASE', 'EXPENSE_REPORT', 'TIME']`) |
| `'crm'` | `<crmcustomfield>` | `custevent_` | 38 chars | `appliesTo` (e.g., `['CASE', 'TASK', 'PHONE_CALL', 'EVENT', 'CAMPAIGN']`) |
| `'item'` | `<itemcustomfield>` | `custitem_` | 38 chars | `appliesTo` (e.g., `['INVENTORY', 'NON_INVENTORY', 'SERVICE', 'ASSEMBLY', 'KIT']`) + optional `itemSubType` (`'BOTH'`, `'PURCHASE'`, `'SALE'`) |
| `'entity'` | `<entitycustomfield>` | `custentity_` | 38 chars | `appliesTo` (e.g., `['CUSTOMER', 'VENDOR', 'EMPLOYEE', 'CONTACT', 'PARTNER', 'PROJECT']`) |
| `'other_record'` | `<othercustomfield>` | `custrecord_` | 38 chars | `recordType` (e.g., `'account'`, `'department'`, `'location'`, `'subsidiary'`, `'class'`) |
| `'item_option'` | `<itemoptioncustomfield>` | `custcol_` | 40 chars | `appliesTo` (e.g., `['ALL_ITEMS', 'SALE', 'PURCHASE', 'WEB_STORE']`) |
| `'item_number'` | `<itemnumbercustomfield>` | `custitemnumber_` | 38 chars | `appliesTo` (e.g., `['ALL_ITEMS', 'SERIAL', 'LOT', 'GIFT_CERTIFICATE']`) |

*(Note: To add or update `custrecord_*` fields on a **Custom Record Type** (`customrecord_*`), use **[Upsert Custom Record Type (`netsuite_upsert_custom_record_type`)](./netsuite_upsert_custom_record_type.md)** instead. Use `fieldCategory: 'other_record'` here only for standalone `<othercustomfield>` definitions that apply to standard NetSuite classification/setup records like Account, Department, Location, Subsidiary, or Class.)*

### Input Parameters

| Parameter | Type | Required | Description |
| :--- | :--- | :---: | :--- |
| `fields` | `UpsertCustomFieldInput[]` | **Yes** | Non-empty array of custom field definitions to create or update in a single SDF deployment pass. Each item accepts: `fieldCategory` (required), `scriptId` (required; prefix auto-prepended if omitted), `label` (required on creation, max 40 chars), `type` (defaults to `'TEXT'` on creation), `selectRecordType` (required when `type` is `'SELECT'` or `'MULTISELECT'`), `appliesTo` (`string[]`), `recordType` (required for `'other_record'`), `description`, `helpText`, `isMandatory`, `storeValue`, `showInList`, `globalSearch`, `displayType`, `defaultValue`, `defaultChecked`, `dynamicDefault`, `isFormula`, `subtab`, `isParent`, `parentSubtab`, `itemSubType`. |
| `saveToProject` | `boolean` | No | Override whether all deployed `<scriptId>.xml` files (and `manifest.xml` dependencies) are copied into your local project (`Objects/`). |

---

## Complementary Tools

- **[View Custom Object (`netsuite_view_custom_object`)](./netsuite_view_custom_object.md):** Always call `netsuite_view_custom_object` before updating an existing standalone custom field to verify its `fieldCategory`, current `appliesTo` flags, `displayType`, and `selectRecordType`.
- **[Upsert Custom List (`netsuite_upsert_custom_list`)](./netsuite_upsert_custom_list.md) & [Upsert Custom Record Type (`netsuite_upsert_custom_record_type`)](./netsuite_upsert_custom_record_type.md):** Create custom lists or custom record types before referencing them in a standalone custom field's `selectRecordType`.
- **[Load Record Sample (`netsuite_load_record_sample`)](./netsuite_load_record_sample.md) & [Upsert Record (`netsuite_upsert_record`)](./netsuite_upsert_record.md):** Test setting values on your newly deployed custom fields.

---

## Tool Metadata

| Property | Value |
| :--- | :--- |
| **Tool ID** | `netsuite_upsert_custom_field` |
| **Human-Readable Name** | Upsert Custom Field |
| **Category** | `custom_objects` (Custom Objects — Records, Fields & Lists) |
| **Destructive (`isDestructive`)** | **`true`** |
| **Requires SDF (`requiresSdf`)** | **`true`** |
| **Default Availability** | On-demand via `netsuite_manage_toolsets` *(or enabled at startup in the `admin` preset)* |

---

## Inner Workings

1. **Category & Script ID Validation (`normalizeCustomFieldCategory` & `normalizeCustomFieldScriptId` in `src/utils/customFields.ts`):**
   - Accepts both canonical category names (`transaction_line`) and common aliases (`transaction_column`, `transactioncolumncustomfield`, `custcol`).
   - Auto-prepends the category's required prefix (`custbody_`, `custcol_`, `custevent_`, `custitem_`, `custentity_`, `custrecord_`, `custitemnumber_`) if omitted.
   - **Mismatched Prefix Guard:** If a caller passes a `scriptId` starting with `custbody_` while specifying `fieldCategory: "entity"`, the tool immediately throws a clear validation error before spinning up SDF.
   - Enforces the category's max `scriptId` length (`38` characters for most categories; `40` characters for `item_option`).

2. **Friendly `appliesTo` Alias Resolution (`resolveAppliesToTags`):**
   - Maps human-readable record/transaction targets (as well as raw SDF tag names) to their exact SDF XML boolean tags for each category:
     - For example, on `transaction_body`, `'SALE'` (or `'SALES_ORDER'`, `'INVOICE'`, `'QUOTE'`, `'bodysale'`) maps to `<bodysale>T</bodysale>`; `'ITEM_FULFILLMENT'` maps to `<bodyitemfulfillment>T</bodyitemfulfillment>`.
     - On `item`, `'ASSEMBLY'` (or `'BOM'`) maps to `<appliestoitemassembly>T</appliestoitemassembly>`.
     - On `item_number`, `'SERIAL'` maps to `<appliestoserialized>T</appliestoserialized>` and `'LOT'` maps to `<appliestolots>T</appliestolots>`.
   - On `other_record` (`<othercustomfield>`), validates that `recordType` is provided instead of `appliesTo` and maps `recordType` to `<rectype>` via `getSelectRecordType` (e.g., `'account'` -> `'-112'`, `'subsidiary'` -> `'-117'`).

3. **Category-Aware Default Filtering & XML Merge (`buildOrMergeCustomFieldXml`):**
   - Inside an isolated temporary SDF project (`withTempSdfProject`), loops through each field in `fields`:
     - Attempts `suitecloud object:import --type ALL --scriptid <scriptId> --destinationfolder /Objects`.
     - **If the field already exists in NetSuite:** Verifies that its existing XML root element matches the requested `fieldCategory`, and merges updated properties and new `appliesTo` tags in-place while preserving existing subtabs, permissions, role restrictions, and sourcing/filter rules.
     - **If the field is new:** Applies `ObjectDefaultType.FIELD` defaults (`config.json` + `fieldDefaults.ts`), normalizes `<displaytype>` (`'DISABLED'` -> `'LOCKED'`, `'INLINE'` -> `'STATICTEXT'`), and **strips category-unsupported default tags** (`spec.unsupportedDefaultTags`). For example, NetSuite SDF rejects `<globalsearch>`, `<showinlist>`, `<searchlevel>`, `<isparent>`, and `<onparentdelete>` on `<transactioncolumncustomfield>` and `<itemoptioncustomfield>`, so those tags are automatically omitted for those categories.

4. **Batch Single-Pass SDF Deployment (`deployObjectsFromTempProject`):**
   - Collects all `<selectrecordtype>`, `<rectype>`, `<subtab>`, and `<parentsubtab>` custom object dependencies across the entire batch of fields, plus required features (such as `ITEMOPTIONS` when deploying `item_option` fields).
   - Removes any object ID from `manifest.xml` `<dependencies><objects>` if that object is itself part of the current deployment batch.
   - Stages all `<scriptId>.xml` files into `<tempDir>/Objects/`, lists all of them in `<tempDir>/deploy.xml`, and runs a **single** `suitecloud project:deploy` command to deploy the entire batch at once.
   - If `saveToProject` resolves to `true`, syncs every deployed XML file and `manifest.xml` dependency back to your local project.
