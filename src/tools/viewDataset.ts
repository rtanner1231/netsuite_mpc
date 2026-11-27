import { ToolDefinition } from "../types/index.js";
import { callNetsuiteRestlet } from "../utils/api.js";

export interface ViewDatasetArgs {
    scriptId?: string;
    searchTerm?: string;
    maxRows?: number;
    limit?: number;
}

export const viewDatasetTool: ToolDefinition = {
    name: "netsuite_view_dataset",
    description:
        "Inspects and previews an existing NetSuite SuiteAnalytics Dataset (`custdataset_*`) OR searches/lists existing Datasets via the N/dataset and N/query modules in the MCP RESTlet.\n\n" +
        "HOW TO USE (TWO MODES):\n" +
        "1. Inspect & Preview a Specific Dataset (`scriptId` provided):\n" +
        "   - Pass `scriptId` (e.g., `'custdataset_open_orders'`) to load the dataset's full definition (`datasetType`, `name`, `description`, `scriptId`, `datasetUrl`, `columns` with joins/formulas, `condition` tree, and NetSuite-generated SuiteQL `generatedSuiteQL`) and preview its first `maxRows` result rows (default: 25; pass `maxRows: 0` to fetch only the definition and generated SuiteQL without executing the dataset).\n" +
        "   - The returned `columns` and `condition` are structured in the exact format accepted by `netsuite_create_dataset`, making it easy to inspect an existing dataset in a new session, modify its columns or criteria, and update it with `netsuite_create_dataset` (`overwrite: true`).\n" +
        "2. Find / List Datasets (`scriptId` omitted):\n" +
        "   - If you do not know the `scriptId` of the dataset you want to inspect or update, omit `scriptId` and pass an optional `searchTerm` (matches dataset name, script ID, or description) to list matching SuiteAnalytics Datasets in NetSuite.",
    meta: {
        isDestructive: false,
        requiresSdf: false,
        category: "report_creation"
    },
    inputSchema: {
        type: "object",
        properties: {
            scriptId: {
                type: "string",
                description:
                    "(Optional) The script ID (e.g., 'custdataset_open_high_val_orders' or 'custdataset65') of the specific SuiteAnalytics Dataset to load and inspect. If provided without the 'custdataset' prefix, 'custdataset_' is automatically prepended. Omit `scriptId` to search/list existing datasets using `searchTerm`."
            },
            searchTerm: {
                type: "string",
                description:
                    "(Optional, used when `scriptId` is omitted) Case-insensitive partial search term to filter datasets by name, script ID, or description."
            },
            maxRows: {
                type: "number",
                description:
                    "(Optional, used when `scriptId` is provided) Maximum number of preview rows to execute and return when inspecting a specific dataset (0 to 1000, default: 25). Set to `0` to only retrieve the dataset definition (`columns`, `condition`, `generatedSuiteQL`) without executing it."
            },
            limit: {
                type: "number",
                description:
                    "(Optional, used when `scriptId` is omitted) Maximum number of datasets to return when listing/searching (1 to 500, default: 50)."
            }
        }
    },
    execute: async (args: ViewDatasetArgs) => {
        try {
            const payload: Record<string, any> = {
                action: "VIEW_DATASET"
            };

            if (args.scriptId !== undefined) {
                payload.scriptId = args.scriptId;
            }
            if (args.searchTerm !== undefined) {
                payload.searchTerm = args.searchTerm;
            }
            if (args.maxRows !== undefined) {
                payload.maxRows = args.maxRows;
            }
            if (args.limit !== undefined) {
                payload.limit = args.limit;
            }

            const response = await callNetsuiteRestlet(payload);
            return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }] };
        } catch (error: any) {
            return { content: [{ type: "text", text: `RESTlet Error: ${error.message}` }], isError: true };
        }
    }
};
