import { ToolDefinition } from "../types/index.js";
import { callNetsuiteRestlet } from "../utils/api.js";

export interface ViewSavedSearchArgs {
    scriptId?: string;
    searchTerm?: string;
    recordType?: string;
    maxRows?: number;
    limit?: number;
}

export const viewSavedSearchTool: ToolDefinition = {
    name: "netsuite_view_saved_search",
    description:
        "Inspects and previews an existing NetSuite Saved Search (`customsearch_*`) OR searches/lists existing Saved Searches via the N/search module in the MCP RESTlet.\n\n" +
        "HOW TO USE (TWO MODES):\n" +
        "1. Inspect & Preview a Specific Saved Search (`scriptId` provided):\n" +
        "   - Pass `scriptId` (e.g., `'customsearch_open_orders'` or a numeric internal ID) to load the saved search's full definition (`searchType`, `title`, `scriptId`, `savedSearchId`, `isPublic`, `columns`, `filters`, `filterExpression`, `settings`) and preview its first `maxRows` result rows (default: 25; pass `maxRows: 0` to fetch only the definition without running the search).\n" +
        "   - The returned `columns`, `filters`, `filterExpression`, and `settings` are structured in the exact format accepted by `netsuite_create_saved_search`, making it easy to inspect an existing search in a new session, modify its columns or criteria, and update it with `netsuite_create_saved_search` (`overwrite: true`).\n" +
        "2. Find / List Saved Searches (`scriptId` omitted):\n" +
        "   - If you do not know the `scriptId` of the saved search you want to inspect or update, omit `scriptId` and pass an optional `searchTerm` (matches title or script ID) and/or `recordType` filter to list matching saved searches in NetSuite.",
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
                    "(Optional) The script ID (e.g., 'customsearch_open_high_val_orders') or numeric internal ID of the specific saved search to load and inspect. If provided without the 'customsearch_' prefix, 'customsearch_' is automatically prepended. Omit `scriptId` to search/list existing saved searches using `searchTerm` and/or `recordType`."
            },
            searchTerm: {
                type: "string",
                description:
                    "(Optional, used when `scriptId` is omitted) Case-insensitive partial search term to find saved searches by title or script ID."
            },
            recordType: {
                type: "string",
                description:
                    "(Optional) When listing saved searches (`scriptId` omitted), filters the list by target record type (e.g., 'transaction', 'salesorder', 'customer'). When loading a specific search (`scriptId` provided), acts as an optional N/search record type hint."
            },
            maxRows: {
                type: "number",
                description:
                    "(Optional, used when `scriptId` is provided) Maximum number of preview rows to execute and return when inspecting a specific saved search (0 to 1000, default: 25). Set to `0` to only retrieve the saved search definition (`columns`, `filters`, `filterExpression`, `settings`) without executing it."
            },
            limit: {
                type: "number",
                description:
                    "(Optional, used when `scriptId` is omitted) Maximum number of saved searches to return when listing/searching (1 to 500, default: 50)."
            }
        }
    },
    execute: async (args: ViewSavedSearchArgs) => {
        try {
            const payload: Record<string, any> = {
                action: "VIEW_SAVED_SEARCH"
            };

            if (args.scriptId !== undefined) {
                payload.scriptId = args.scriptId;
            }
            if (args.searchTerm !== undefined) {
                payload.searchTerm = args.searchTerm;
            }
            if (args.recordType !== undefined) {
                payload.recordType = args.recordType;
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
