import { ToolDefinition } from "../types/index.js";
import { callNetsuiteRestlet } from "../utils/api.js";

export interface DatasetJoinHopDefinition {
    fieldId: string;
    source?: string;
    target?: string;
    join?: DatasetJoinSpecification;
}

export type DatasetJoinSpecification =
    | string
    | DatasetJoinHopDefinition
    | (string | DatasetJoinHopDefinition)[];

export interface DatasetColumnDefinition {
    fieldId?: string;
    join?: DatasetJoinSpecification;
    formula?: string;
    type?:
        | "STRING"
        | "INTEGER"
        | "FLOAT"
        | "CURRENCY"
        | "PERCENT"
        | "DATE"
        | "DATETIME"
        | "BOOLEAN"
        | "CLOBTEXT"
        | "DURATION"
        | "KEY"
        | "RELATIONSHIP"
        | "ANY"
        | string;
    label?: string;
    alias?: string;
}

export interface DatasetRelativeDateValue {
    dateId: string;
    value: number;
}

export type DatasetConditionPrimitiveValue =
    | string
    | number
    | boolean
    | DatasetRelativeDateValue
    | null;

export interface DatasetFilterDefinition {
    fieldId?: string;
    join?: DatasetJoinSpecification;
    formula?: string;
    type?: string;
    columnAlias?: string;
    operator: string;
    values?: DatasetConditionPrimitiveValue | DatasetConditionPrimitiveValue[];
    caseSensitive?: boolean;
}

export interface DatasetConditionGroupDefinition {
    operator: "AND" | "OR" | string;
    children: (DatasetFilterDefinition | DatasetConditionGroupDefinition)[];
}

export type DatasetConditionDefinition =
    | DatasetFilterDefinition
    | DatasetConditionGroupDefinition;

export interface CreateDatasetArgs {
    type?: string;
    columns?: DatasetColumnDefinition[];
    filters?: DatasetFilterDefinition[];
    condition?: DatasetConditionDefinition;
    dryRun?: boolean;
    maxRows?: number;
    name?: string;
    description?: string;
    scriptId?: string;
    overwrite?: boolean;
}

const JOIN_SCHEMA_PROPERTY = {
    description:
        "(Optional) Join specification from the dataset's base record type to a related record type. Accepts:\n" +
        "1. A dot-separated forward join field path string (e.g., `'transactionlines'`, `'transactionlines.item'`, `'transactionlines.accountingimpact'`, `'entity'`, or `'salesrep.department'`),\n" +
        "2. A single join hop object `{ fieldId, source?, target?, join? }` (e.g., child custom record inverse join `{ fieldId: 'custrecord_parent_ref', source: 'customrecord_child_line' }` or polymorphic join `{ fieldId: 'entity', target: 'customer' }`), or\n" +
        "3. An ordered array of join hops from outermost (base record) to innermost (e.g., `[{ fieldId: 'custrecord_so_ref' }, { fieldId: 'transactionlines' }]`).",
    anyOf: [
        { type: "string" },
        {
            type: "object",
            properties: {
                fieldId: {
                    type: "string",
                    description:
                        "The join field ID. For forward/polymorphic joins, this is the field on the current record (e.g., 'transactionlines', 'entity', 'item', 'salesrep'). For inverse joins (`source` specified), this is the foreign-key field on the `source` child custom record that points back to the current record (e.g., `fieldId: 'custrecord_parent_ref'` when `source: 'customrecord_child_line'`)."
                },
                source: {
                    type: "string",
                    description:
                        "(Optional) For inverse (parent-to-child custom record) joins where the current record does not have a direct forward sublist join field: the child table ID that holds `fieldId` pointing back to the current table (e.g., `source: 'customrecord_child_line'` with `fieldId: 'custrecord_parent_ref'`). Note: For native transaction lines, use forward join `fieldId: 'transactionlines'` instead of `source: 'transactionline'`. Mutually exclusive with `target`."
                },
                target: {
                    type: "string",
                    description:
                        "(Optional) For polymorphic joins where `fieldId` can point to multiple record types (such as `entity`, `createdby`, or a Transaction reference field): the specific target record type (e.g., `target: 'customer'`, `'vendor'`, `'employee'`, or `'transaction'`). Mutually exclusive with `source`."
                },
                join: {
                    type: "object",
                    description: "(Optional) Next nested join hop object `{ fieldId, source?, target?, join? }`."
                }
            },
            required: ["fieldId"]
        },
        {
            type: "array",
            items: {
                anyOf: [
                    { type: "string" },
                    {
                        type: "object",
                        properties: {
                            fieldId: { type: "string" },
                            source: { type: "string" },
                            target: { type: "string" }
                        },
                        required: ["fieldId"]
                    }
                ]
            }
        }
    ]
};

const CONDITION_VALUES_SCHEMA_PROPERTY = {
    description:
        "(Optional) Filter value or array of values (e.g., `true`, `false`, `'CustInvc'`, `['SalesOrd', 'CustInvc']`, `1000`, ISO dates/datetimes like `'2026-07-01'` or `'2026-07-01T00:00:00'` [automatically formatted to the NetSuite account's date/datetime format], account-formatted date/datetime strings like `'07/01/2026'` or `'07/01/2026 12:00 am'`, a `query.RelativeDateRange` name like `'TODAY'`, `'THIS_MONTH'`, `'LAST_FISCAL_QUARTER'`, or a relative date object `{ dateId: 'DAYS_AGO', value: 30 }`). Omit for unary operators `'EMPTY'` and `'EMPTY_NOT'`.",
    anyOf: [
        { type: "string" },
        { type: "number" },
        { type: "boolean" },
        {
            type: "object",
            properties: {
                dateId: {
                    type: "string",
                    description:
                        "N/query.DateId value (e.g., 'DAYS_AGO', 'DAYS_FROM_NOW', 'WEEKS_AGO', 'MONTHS_AGO', 'QUARTERS_AGO', 'YEARS_AGO')."
                },
                value: {
                    type: "number",
                    description: "Numeric offset for the relative date (e.g., 30 for 30 days ago)."
                }
            },
            required: ["dateId", "value"]
        },
        {
            type: "array",
            items: {
                anyOf: [
                    { type: "string" },
                    { type: "number" },
                    { type: "boolean" },
                    {
                        type: "object",
                        properties: {
                            dateId: { type: "string" },
                            value: { type: "number" }
                        },
                        required: ["dateId", "value"]
                    }
                ]
            }
        },
        { type: "null" }
    ]
};

export const createDatasetTool: ToolDefinition = {
    name: "netsuite_create_dataset",
    description:
        "Builds, dry-runs (previews), and saves or updates a NetSuite SuiteAnalytics Dataset (`custdataset_*`) via the N/dataset and N/query modules in the MCP RESTlet, and returns the total match count, preview rows, and NetSuite-generated SuiteQL query.\n\n" +
        "RECOMMENDED WORKFLOW:\n" +
        "1. Always execute with `dryRun: true` (the default) first to test the dataset definition, verify all record types, joins, field IDs, and formulas, and inspect the `totalMatchCount`, `previewRows`, and `generatedSuiteQL`.\n" +
        "2. Present the sample preview rows, criteria, and generated SuiteQL to the user for approval.\n" +
        "3. Once approved, call this tool again with `dryRun: false` and `name` (plus optional `scriptId`, `description`, and `overwrite: true` if updating an existing dataset).\n" +
        "4. Tip (Inspecting an existing dataset): To inspect and preview an existing saved dataset in NetSuite without modifying it, call this tool with `scriptId: 'custdataset_...'`, `overwrite: true`, and `dryRun: true` while omitting `columns` and `filters`.\n\n" +
        "IMPORTANT SCHEMA GUIDANCE (1-to-1 Match with Local Schema Tools!):\n" +
        "- Unlike `netsuite_create_saved_search` (which uses the legacy N/search schema), `netsuite_create_dataset` uses NetSuite's SuiteAnalytics / Records Catalog data source—the EXACT same schema stored in your local SQLite database! Always use `netsuite_search_tables`, `netsuite_get_fields`, and `netsuite_get_related_tables` to discover exact table IDs, field IDs, and join relationships for datasets.\n" +
        "- How Joins Work in N/dataset (`join` property on columns and filters):\n" +
        "  • Forward Joins (`source.fieldId = target.id` in `netsuite_get_related_tables`): Pass `join: 'fieldId'` (or `{ fieldId: '...' }`). Multi-hop forward joins can use dot notation (e.g., `join: 'salesrep.department'`) or an array of hops. On a `type: 'transaction'` dataset, use the built-in forward sublist join fields:\n" +
        "    - Transaction Line fields (`transactionline`): `join: 'transactionlines'`\n" +
        "    - Item fields via Transaction Line: `join: 'transactionlines.item'` (or `join: [{ fieldId: 'transactionlines' }, { fieldId: 'item' }]`)\n" +
        "    - Transaction Accounting Line fields (`transactionaccountingline`): `join: 'transactionlines.accountingimpact'`\n" +
        "  • Inverse Joins (Parent-to-Child Custom Records where the parent has no direct forward join field): Pass `{ fieldId: '<foreign_key_on_child_table>', source: '<child_custom_record_table>' }` (e.g., `join: { fieldId: 'custrecord_parent_ref', source: 'customrecord_child_lines' }`).\n" +
        "  • Polymorphic Joins (where a field like `entity`, `createdby`, or a transaction reference can join to multiple record types such as `customer`, `vendor`, `employee`, or `transaction`): Specify `target` to select the target record type (e.g., `join: { fieldId: 'entity', target: 'customer' }` or a multi-hop join `join: [{ fieldId: 'custrecord_so_ref', target: 'transaction' }, { fieldId: 'transactionlines' }]`).\n" +
        "- Dates & Datetimes in Filters: You can pass ISO dates (`'2026-07-01'`), ISO datetimes (`'2026-07-01T00:00:00'`), account-formatted strings (`'07/01/2026'`, `'07/01/2026 12:00 am'`), `query.RelativeDateRange` names (`'TODAY'`, `'THIS_MONTH'`, `'LAST_FISCAL_QUARTER'`), or `{ dateId: 'DAYS_AGO', value: 30 }`. The RESTlet automatically formats ISO dates/datetimes to match the account's date/datetime preferences and upgrades date-only strings on `DATETIME` fields (like `createddate` or `lastmodifieddate`).\n" +
        "- Formulas: On any column or filter, omit `fieldId` and instead pass `formula` (e.g., `'{foreigntotal} * 1.1'`) AND `type` (the `query.ReturnType`, e.g., `'STRING'`, `'INTEGER'`, `'FLOAT'`, `'CURRENCY'`, `'PERCENT'`, `'DATE'`, `'DATETIME'`, `'BOOLEAN'`). Note: N/dataset does not allow both `formula` and `join` on the same column.",
    meta: {
        isDestructive: true,
        requiresSdf: false,
        category: "data_operations"
    },
    inputSchema: {
        type: "object",
        properties: {
            type: {
                type: "string",
                description:
                    "The SuiteAnalytics base record type ID (e.g., 'transaction', 'customer', 'vendor', 'employee', 'item', 'supportcase', or a custom record scriptId like 'customrecord_...'). Matches table IDs from `netsuite_search_tables` and `netsuite_get_fields`. Required unless loading/updating an existing dataset with `overwrite: true` and `scriptId`."
            },
            columns: {
                type: "array",
                description:
                    "Non-empty array of dataset column definitions specifying the fields or formulas to include in the dataset. Required when creating a new dataset; optional when inspecting or updating an existing dataset (`overwrite: true` with `scriptId`), in which case omitting `columns` preserves the existing dataset's columns.",
                items: {
                    type: "object",
                    properties: {
                        fieldId: {
                            type: "string",
                            description:
                                "The SuiteAnalytics field ID on the base record or joined record (e.g., 'id', 'tranid', 'trandate', 'entity', 'foreigntotal', 'custbody_...'). Mutually exclusive with `formula`."
                        },
                        join: JOIN_SCHEMA_PROPERTY,
                        formula: {
                            type: "string",
                            description:
                                "(Optional) SuiteAnalytics formula expression using `{fieldId}` syntax (e.g., `'{foreigntotal} - NVL({taxtotal}, 0)'` or `'CASE WHEN {foreigntotal} > 1000 THEN \\'High\\' ELSE \\'Normal\\' END'`). Mutually exclusive with `fieldId` and `join`; requires `type`."
                        },
                        type: {
                            type: "string",
                            enum: [
                                "STRING",
                                "INTEGER",
                                "FLOAT",
                                "CURRENCY",
                                "PERCENT",
                                "DATE",
                                "DATETIME",
                                "BOOLEAN",
                                "CLOBTEXT",
                                "DURATION",
                                "KEY",
                                "RELATIONSHIP",
                                "ANY"
                            ],
                            description:
                                "(Required when `formula` is specified) The formula return type (`query.ReturnType`)."
                        },
                        label: {
                            type: "string",
                            description:
                                "(Optional) Custom display label for the column in the SuiteAnalytics Workbook UI and preview output."
                        },
                        alias: {
                            type: "string",
                            description:
                                "(Optional) Unique string alias for the column (used in mapped results and workbook expressions). If omitted, a clean unique alias is generated automatically."
                        }
                    }
                }
            },
            filters: {
                type: "array",
                description:
                    "(Optional) Flat array of dataset filter condition objects (combined with logical AND). Use `filters` for standard AND criteria, OR use `condition` when you need OR logic / nested condition groups (do not pass both). Note: You can filter on any field or join even if it is not listed in `columns`—the tool automatically binds or creates the underlying `dataset.Column`. When updating an existing dataset (`overwrite: true`), omitting both `filters` and `condition` preserves the existing dataset's criteria; pass `filters: []` to explicitly clear all criteria.",
                items: {
                    type: "object",
                    properties: {
                        fieldId: {
                            type: "string",
                            description:
                                "The SuiteAnalytics field ID to filter on (e.g., 'type', 'status', 'trandate', 'isinactive', 'foreigntotal', 'mainline' on transactionline). Mutually exclusive with `formula`."
                        },
                        join: JOIN_SCHEMA_PROPERTY,
                        formula: {
                            type: "string",
                            description:
                                "(Optional) Formula expression when filtering on a calculated formula (requires `type`)."
                        },
                        type: {
                            type: "string",
                            description:
                                "(Optional) Formula return type when `formula` is used (e.g., 'STRING', 'INTEGER', 'FLOAT', 'CURRENCY', 'DATE', 'BOOLEAN')."
                        },
                        columnAlias: {
                            type: "string",
                            description:
                                "(Optional) Alias of a column already defined in `columns` to apply this condition to instead of specifying `fieldId`/`join`."
                        },
                        operator: {
                            type: "string",
                            description:
                                "The N/query.Operator value (e.g., 'EQUAL', 'EQUAL_NOT', 'IS', 'IS_NOT', 'ANY_OF', 'ANY_OF_NOT', 'CONTAIN', 'CONTAIN_NOT', 'START_WITH', 'START_WITH_NOT', 'ENDWITH', 'ENDWITH_NOT', 'EMPTY', 'EMPTY_NOT', 'GREATER', 'GREATER_OR_EQUAL', 'LESS', 'LESS_OR_EQUAL', 'BETWEEN', 'ON', 'AFTER', 'BEFORE', 'ON_OR_AFTER', 'ON_OR_BEFORE', 'WITHIN', 'INCLUDE_ALL', 'INCLUDE_ANY', 'EXCLUDE_ALL'). Common N/search operator aliases (like 'anyof', 'noneof', 'isempty', 'isnotempty', 'greaterthan') are also automatically translated."
                        },
                        values: CONDITION_VALUES_SCHEMA_PROPERTY,
                        caseSensitive: {
                            type: "boolean",
                            description: "(Optional) Whether string comparison is case-sensitive."
                        }
                    },
                    required: ["operator"]
                }
            },
            condition: {
                type: "object",
                description:
                    "(Optional) Nested condition tree supporting logical `'AND'` and `'OR'` groups via `{ operator: 'AND' | 'OR', children: [ ... ] }`, where each child is either a leaf filter object (`{ fieldId, join?, operator, values? }`) or a nested `{ operator: 'AND' | 'OR', children: [...] }` group. Do not pass both `filters` and `condition`. Pass `condition: {}` when `overwrite: true` to clear existing criteria.",
                properties: {
                    operator: {
                        type: "string",
                        description:
                            "For a logical group node: `'AND'` or `'OR'`. For a single leaf condition node: any `N/query.Operator` value (e.g., `'EQUAL'`, `'ANY_OF'`, `'IS'`)."
                    },
                    children: {
                        type: "array",
                        description:
                            "Array of child condition objects (leaf filter objects or nested `{ operator: 'AND' | 'OR', children: [...] }` groups) when `operator` is `'AND'` or `'OR'`.",
                        items: { type: "object" }
                    },
                    fieldId: { type: "string" },
                    join: JOIN_SCHEMA_PROPERTY,
                    formula: { type: "string" },
                    type: { type: "string" },
                    columnAlias: { type: "string" },
                    values: CONDITION_VALUES_SCHEMA_PROPERTY,
                    caseSensitive: { type: "boolean" }
                }
            },
            dryRun: {
                type: "boolean",
                description:
                    "(Optional) Defaults to `true`. When `true`, executes the dataset in-memory without saving it in NetSuite and returns `totalMatchCount`, the first `maxRows` preview rows, and `generatedSuiteQL`. Set to `false` only after the user approves the preview to save/update the dataset in NetSuite."
            },
            maxRows: {
                type: "number",
                description:
                    "(Optional) Maximum number of preview rows to return from the dataset execution (0 to 1000, default: 25)."
            },
            name: {
                type: "string",
                description:
                    "(Required when `dryRun: false` and creating a new dataset) The display name of the Dataset in the SuiteAnalytics Workbook UI."
            },
            description: {
                type: "string",
                description: "(Optional) Description of the Dataset in SuiteAnalytics Workbook."
            },
            scriptId: {
                type: "string",
                description:
                    "(Optional) Custom script ID for the dataset (e.g., 'custdataset_open_high_val_orders'). If provided without the 'custdataset_' prefix, 'custdataset_' is automatically prepended. If omitted when saving a new dataset, NetSuite generates an ID automatically."
            },
            overwrite: {
                type: "boolean",
                description:
                    "(Optional) When `true` and `scriptId` matches an existing dataset in NetSuite, loads the existing dataset and updates only the properties you explicitly pass (`columns`, `filters`/`condition`, `name`, `description`) while preserving omitted properties (default: false). Also works with `dryRun: true` to inspect or test changes against an existing dataset."
            }
        }
    },
    execute: async (args: CreateDatasetArgs) => {
        try {
            const payload: Record<string, any> = {
                action: "CREATE_DATASET",
                dryRun: args.dryRun !== undefined ? Boolean(args.dryRun) : true,
                maxRows: args.maxRows !== undefined ? args.maxRows : 25
            };

            if (args.type !== undefined) {
                payload.type = args.type;
            }
            if (args.columns !== undefined) {
                payload.columns = args.columns;
            }
            if (args.filters !== undefined) {
                payload.filters = args.filters;
            }
            if (args.condition !== undefined) {
                payload.condition = args.condition;
            }
            if (args.name !== undefined) {
                payload.name = args.name;
            }
            if (args.description !== undefined) {
                payload.description = args.description;
            }
            if (args.scriptId !== undefined) {
                payload.scriptId = args.scriptId;
            }
            if (args.overwrite !== undefined) {
                payload.overwrite = args.overwrite;
            }

            const response = await callNetsuiteRestlet(payload);
            return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
        } catch (error: any) {
            return { content: [{ type: "text", text: `RESTlet Error: ${error.message}` }], isError: true };
        }
    }
};
