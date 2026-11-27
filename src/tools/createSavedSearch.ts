import { ToolDefinition } from "../types/index.js";
import { callNetsuiteRestlet } from "../utils/api.js";

export interface SavedSearchColumnDefinition {
    name: string;
    join?: string;
    summary?: "GROUP" | "SUM" | "COUNT" | "AVG" | "MIN" | "MAX" | string;
    formula?: string;
    label?: string;
    sort?: "ASC" | "DESC" | "NONE" | string;
    function?: string;
}

export interface SavedSearchFilterDefinition {
    name: string;
    join?: string;
    operator: string;
    values?: string | number | boolean | (string | number | boolean)[] | null;
    formula?: string;
    summary?: "GROUP" | "SUM" | "COUNT" | "AVG" | "MIN" | "MAX" | string;
}

export interface SavedSearchSettingDefinition {
    name: string;
    value: string;
}

export interface CreateSavedSearchArgs {
    type?: string;
    columns?: SavedSearchColumnDefinition[];
    filters?: SavedSearchFilterDefinition[];
    filterExpression?: any[];
    settings?: SavedSearchSettingDefinition[];
    dryRun?: boolean;
    maxRows?: number;
    title?: string;
    scriptId?: string;
    isPublic?: boolean;
    overwrite?: boolean;
}

export const createSavedSearchTool: ToolDefinition = {
    name: "netsuite_create_saved_search",
    description:
        "Builds, dry-runs (previews), and saves or updates a NetSuite Saved Search via the N/search module in the MCP RESTlet.\n\n" +
        "RECOMMENDED WORKFLOW:\n" +
        "1. Always execute with `dryRun: true` (the default) first to test the search definition, verify that all column/filter field IDs are valid in N/search, and retrieve the total match count and first `maxRows` preview rows.\n" +
        "2. Present the sample preview rows and search criteria to the user for approval.\n" +
        "3. Once approved, call this tool again with `dryRun: false` and `title` (plus optional `scriptId`, `isPublic`, and `overwrite: true` if updating an existing saved search).\n\n" +
        "IMPORTANT SCHEMA GUIDANCE (SuiteQL vs. N/search):\n" +
        "- Custom Records & Custom Fields: Use `netsuite_search_tables` and `netsuite_get_fields` to discover custom record types (`customrecord_*`) and custom field IDs (`custbody_*`, `custcol_*`, `custentity_*`, `custitem_*`, `custrecord_*`). These script IDs are identical in SuiteQL and N/search.\n" +
        "- Native Tables & Native Fields: Note that `netsuite_get_fields` reflects the SuiteQL/Analytics schema, which differs in several places from the N/search (Records Browser) schema. For native record types, fields, and joins, rely on your knowledge of NetSuite's N/search Records Browser (or use `netsuite_load_record_sample` to inspect native record field IDs):\n" +
        "  • Transactions: Use `type: 'transaction'` (or specific subtypes like `'salesorder'`, `'invoice'`, `'vendorbill'`, `'purchaseorder'`, `'itemfulfillment'`, `'customerpayment'`). In N/search, transaction header vs. line rows are controlled on the same search using filters like `mainline` (`'T'` for header, `'F'` for lines), `taxline` (`'F'`), `shipping` (`'F'`), and `cogs` (`'F'`). Common native fields: `tranid`, `trandate`, `entity`, `amount`, `total`, `status` (e.g., `'SalesOrd:B'`), `type` (e.g., `'SalesOrd'`, `'CustInvc'`, `'VendBill'`), `item`, `quantity`, `rate`, `memo`, `subsidiary`, `department`, `class`, `location`.\n" +
        "  • Common N/search Joins: Use single-hop N/search join IDs on `join` (e.g., `'customer'`, `'customerMain'`, `'vendor'`, `'item'`, `'employee'`, `'salesRep'`, `'createdFrom'`, `'applyingTransaction'`, `'appliedToTransaction'`, `'userNotes'`, `'systemNotes'`, or parent-to-child custom record joins `'CUSTRECORD_<FIELD_ID>'`).\n" +
        "  • Formulas: Use `formulacurrency`, `formulanumeric`, `formulatext`, `formuladate`, `formuladatetime`, or `formulapercent` as the field `name` and supply the SQL expression in `formula` (e.g., `'{amount} - NVL({taxtotal}, 0)'`).",
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
                    "The NetSuite N/search record type (e.g., 'transaction', 'salesorder', 'invoice', 'customer', 'vendor', 'employee', 'item', 'supportcase', or a custom record scriptId like 'customrecord_...'). Required unless updating an existing search with `overwrite: true` and `scriptId`."
            },
            columns: {
                type: "array",
                description:
                    "Non-empty array of N/search column definitions specifying the fields to return. Required when creating a new search; optional when updating an existing search (`overwrite: true` with `scriptId`), in which case omitting `columns` preserves the existing search's columns.",
                items: {
                    type: "object",
                    properties: {
                        name: {
                            type: "string",
                            description:
                                "The N/search field ID (e.g., 'tranid', 'trandate', 'entity', 'amount', 'custbody_...', or a formula field like 'formulatext', 'formulanumeric', 'formulacurrency')."
                        },
                        join: {
                            type: "string",
                            description:
                                "(Optional) The N/search join ID (e.g., 'customer', 'item', 'vendor', 'createdFrom', 'applyingTransaction', or 'CUSTRECORD_...')."
                        },
                        summary: {
                            type: "string",
                            enum: ["GROUP", "SUM", "COUNT", "AVG", "MIN", "MAX"],
                            description: "(Optional) Summary/aggregation type for summary saved searches."
                        },
                        formula: {
                            type: "string",
                            description:
                                "(Optional) NetSuite search formula expression using `{fieldid}` syntax (e.g., `CASE WHEN {amount} > 1000 THEN 'High' ELSE 'Normal' END`). Required when `name` is a `formula*` column."
                        },
                        label: {
                            type: "string",
                            description: "(Optional) Custom display label for the column in the Saved Search UI and preview output."
                        },
                        sort: {
                            type: "string",
                            enum: ["ASC", "DESC", "NONE"],
                            description: "(Optional) Sort direction for this column ('ASC' or 'DESC')."
                        },
                        function: {
                            type: "string",
                            description:
                                "(Optional) N/search built-in column function (e.g., 'ageInDays', 'month', 'quarter', 'year', 'round', 'roundToTenths', 'roundToHundredths')."
                        }
                    },
                    required: ["name"]
                }
            },
            filters: {
                type: "array",
                description:
                    "(Optional) Array of structured N/search filter objects (combined with logical AND). Use `filters` for standard AND conditions, OR use `filterExpression` when you need OR logic / nested parentheses (do not pass both). When updating an existing search (`overwrite: true`), omitting both `filters` and `filterExpression` preserves the existing search's filters; pass `filters: []` to explicitly clear all filters.",
                items: {
                    type: "object",
                    properties: {
                        name: {
                            type: "string",
                            description:
                                "The N/search filter field ID (e.g., 'mainline', 'type', 'status', 'trandate', 'amount', 'isinactive', 'custbody_...', or 'formulanumeric'/'formulatext')."
                        },
                        join: {
                            type: "string",
                            description: "(Optional) The N/search join ID for joined record filtering (e.g., 'customer', 'item')."
                        },
                        operator: {
                            type: "string",
                            description:
                                "The N/search.Operator value (e.g., 'is', 'isnot', 'anyof', 'noneof', 'contains', 'doesnotcontain', 'startswith', 'isempty', 'isnotempty', 'equalto', 'notequalto', 'greaterthan', 'greaterthanorequalto', 'lessthan', 'lessthanorequalto', 'between', 'within', 'on', 'onorafter', 'onorbefore', 'after', 'before')."
                        },
                        values: {
                            description:
                                "(Optional) Filter value or array of values (e.g., 'T', ['SalesOrd', 'CustInvc'], '1000', ['2026-01-01', '2026-12-31'], or '@NONE@'). Omit for unary operators like 'isempty' or 'isnotempty'.",
                            anyOf: [
                                { type: "string" },
                                { type: "number" },
                                { type: "boolean" },
                                {
                                    type: "array",
                                    items: {
                                        anyOf: [
                                            { type: "string" },
                                            { type: "number" },
                                            { type: "boolean" }
                                        ]
                                    }
                                },
                                { type: "null" }
                            ]
                        },
                        formula: {
                            type: "string",
                            description: "(Optional) Formula expression when filtering on a `formula*` field."
                        },
                        summary: {
                            type: "string",
                            enum: ["GROUP", "SUM", "COUNT", "AVG", "MIN", "MAX"],
                            description: "(Optional) Summary type for summary criteria (HAVING-style filters)."
                        }
                    },
                    required: ["name", "operator"]
                }
            },
            filterExpression: {
                type: "array",
                description:
                    "(Optional) N/search nested filterExpression array supporting 'AND', 'OR', and 'NOT' (e.g., `[['mainline', 'is', 'T'], 'AND', [['status', 'anyof', ['SalesOrd:B']], 'OR', ['amount', 'greaterthan', '5000']]]`). Do not pass both `filters` and `filterExpression`. When updating an existing search (`overwrite: true`), omitting both `filters` and `filterExpression` preserves the existing search's filters; pass `filterExpression: []` to explicitly clear all filters.",
                items: {}
            },
            settings: {
                type: "array",
                description:
                    "(Optional) Array of search setting objects `{ name, value }` (e.g., `[{ name: 'consolidationtype', value: 'AVERAGE' }]`).",
                items: {
                    type: "object",
                    properties: {
                        name: { type: "string" },
                        value: { type: "string" }
                    },
                    required: ["name", "value"]
                }
            },
            dryRun: {
                type: "boolean",
                description:
                    "(Optional) Defaults to `true`. When `true`, executes the search in-memory without saving it in NetSuite and returns the total match count and first `maxRows` preview rows. Set to `false` only after the user approves the preview to save/update the search in NetSuite."
            },
            maxRows: {
                type: "number",
                description:
                    "(Optional) Maximum number of preview rows to return from the search execution (0 to 1000, default: 25)."
            },
            title: {
                type: "string",
                description:
                    "(Required when `dryRun: false` and creating a new search) The display title of the Saved Search in NetSuite."
            },
            scriptId: {
                type: "string",
                description:
                    "(Optional) Custom script ID for the saved search (e.g., 'customsearch_open_high_val_orders') or internal ID when updating an existing search. If a non-numeric ID is passed without the 'customsearch_' prefix, it is automatically prefixed."
            },
            isPublic: {
                type: "boolean",
                description: "(Optional) Whether to make the saved search public in NetSuite when saving (default: false)."
            },
            overwrite: {
                type: "boolean",
                description:
                    "(Optional) When `true` and `scriptId` matches an existing saved search in NetSuite, loads the existing saved search and updates only the properties you explicitly pass (`columns`, `filters`/`filterExpression`, `settings`, `title`, `isPublic`) while preserving omitted properties (default: false)."
            }
        }
    },
    execute: async (args: CreateSavedSearchArgs) => {
        try {
            const payload: Record<string, any> = {
                action: "CREATE_SAVED_SEARCH",
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
            if (args.filterExpression !== undefined) {
                payload.filterExpression = args.filterExpression;
            }
            if (args.settings !== undefined) {
                payload.settings = args.settings;
            }
            if (args.title !== undefined) {
                payload.title = args.title;
            }
            if (args.scriptId !== undefined) {
                payload.scriptId = args.scriptId;
            }
            if (args.isPublic !== undefined) {
                payload.isPublic = args.isPublic;
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
