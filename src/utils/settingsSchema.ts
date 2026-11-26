import { ObjectDefaultType } from "../defaults/types.js";
import { projectDefaultsMap } from "../defaults/index.js";

export interface FieldSchema {
    key: string;
    label: string;
    type: "text" | "secret" | "boolean" | "select" | "nullable_text";
    required?: boolean;
    placeholder?: string;
    helpText?: string;
    options?: { value: string; label: string }[];
    defaultValue?: any;
}

export interface GlobalSectionSchema {
    id: string;
    title: string;
    description: string;
    configPath: string[]; // path inside config.json, e.g. ["project"] or ["objectDefaults", "RECORD"]
    fields: FieldSchema[];
}

export interface ToolCategorySchema {
    id: string;
    title: string;
}

export const TOOL_CATEGORIES: ToolCategorySchema[] = [
    { id: "table_discovery", title: "Table & Schema Discovery" },
    { id: "data_operations", title: "Data Querying & Record Operations" },
    { id: "script_execution", title: "Script Execution & Log Inspection" },
    { id: "sdf_file_deployment", title: "File Cabinet & SDF Files" },
    { id: "script_management", title: "Script Management" },
    { id: "custom_objects", title: "Custom Objects (Records & Lists)" },
    { id: "translations", title: "Translation Collections" },
    { id: "templates", title: "Templates (Advanced PDF & Email)" }
];

export const TOOL_CATEGORY_BY_NAME: Record<string, string> = {
    // 1. Table & Schema Discovery
    netsuite_search_tables: "table_discovery",
    netsuite_get_fields: "table_discovery",
    netsuite_get_related_tables: "table_discovery",
    netsuite_rebuild_vector_database: "table_discovery",
    netsuite_rebuild_vector_database_status: "table_discovery",

    // 2. Data Querying & Record Operations
    netsuite_run_suite_ql: "data_operations",
    netsuite_load_record_sample: "data_operations",
    netsuite_create_record: "data_operations",

    // 3. Script Execution & Log Inspection
    netsuite_run_function: "script_execution",
    netsuite_get_run_function_logs: "script_execution",
    netsuite_get_script_logs: "script_execution",

    // 4. File Cabinet & SDF Files
    netsuite_view_file: "sdf_file_deployment",
    netsuite_upload_file: "sdf_file_deployment",
    netsuite_compare_files: "sdf_file_deployment",

    // 5. Script Management
    netsuite_deploy_script: "script_management",
    netsuite_get_script: "script_management",
    netsuite_search_scripts: "script_management",

    // 6. Custom Objects (Records & Lists)
    netsuite_create_custom_record: "custom_objects",
    netsuite_update_custom_record: "custom_objects",
    netsuite_create_custom_list: "custom_objects",

    // 7. Translation Collections
    netsuite_list_supported_locales: "translations",
    netsuite_list_translation_collections: "translations",
    netsuite_view_translation_collection: "translations",
    netsuite_create_translation_collection: "translations",
    netsuite_update_translation_collection: "translations",

    // 8. Templates (Advanced PDF & Email)
    netsuite_list_templates: "templates",
    netsuite_read_advanced_pdf_template: "templates",
    netsuite_upsert_advanced_pdf_template: "templates",
    netsuite_render_advanced_pdf_template: "templates",
    netsuite_read_email_template: "templates",
    netsuite_upsert_email_template: "templates",
    netsuite_render_email_template: "templates"
};

export const ENVIRONMENT_CREDENTIAL_FIELDS: FieldSchema[] = [
    {
        key: "accountId",
        label: "Account ID",
        type: "text",
        required: true,
        placeholder: "e.g., 1234567 or 1234567-sb1",
        helpText: "Your NetSuite Account ID (used for RESTlet URLs and OAuth realm)."
    },
    {
        key: "sdfId",
        label: "SDF Auth ID (SuiteCloud CLI)",
        type: "text",
        required: false,
        placeholder: "e.g., MySandboxAuthId",
        helpText: "SuiteCloud CLI authentication ID (authid). If left blank, all SDF tools are automatically disabled for this environment."
    },
    {
        key: "scriptId",
        label: "RESTlet Script ID",
        type: "text",
        required: true,
        placeholder: "e.g., 1234 or customscript_rl_mcp_services",
        helpText: "Numeric internal ID or custom script ID of the deployed MCP Services RESTlet."
    },
    {
        key: "deploymentId",
        label: "RESTlet Deployment ID",
        type: "text",
        required: true,
        placeholder: "e.g., 1 or customdeploy_rl_mcp_services",
        helpText: "Numeric deployment ID or custom deployment ID of the deployed MCP Services RESTlet."
    },
    {
        key: "consumerKey",
        label: "OAuth Consumer Key",
        type: "secret",
        required: true,
        placeholder: "Integration Record Consumer Key",
        helpText: "Consumer Key from your NetSuite Integration Record."
    },
    {
        key: "consumerSecret",
        label: "OAuth Consumer Secret",
        type: "secret",
        required: true,
        placeholder: "Integration Record Consumer Secret",
        helpText: "Consumer Secret from your NetSuite Integration Record."
    },
    {
        key: "token",
        label: "OAuth Token ID",
        type: "secret",
        required: true,
        placeholder: "Access Token ID",
        helpText: "Token ID from your NetSuite Access Token."
    },
    {
        key: "tokenSecret",
        label: "OAuth Token Secret",
        type: "secret",
        required: true,
        placeholder: "Access Token Secret",
        helpText: "Token Secret from your NetSuite Access Token."
    }
];

export const PROJECT_CONFIG_FIELDS: FieldSchema[] = [
    {
        key: "sdfSourceDir",
        label: "SDF Source Directory",
        type: "text",
        placeholder: "Auto-detected (e.g., dist, src, .)",
        helpText: "Folder relative to the project root where manifest.xml and FileCabinet live. Leave empty to auto-detect."
    },
    {
        key: "buildBeforeUpload",
        label: "Build Before Upload",
        type: "select",
        defaultValue: "auto",
        options: [
            { value: "auto", label: "Auto (build when TypeScript & build script exist)" },
            { value: "true", label: "Always (true)" },
            { value: "false", label: "Never (false)" }
        ],
        helpText: "Controls whether the project build command runs prior to uploading files."
    },
    {
        key: "buildCommand",
        label: "Build Command",
        type: "text",
        placeholder: "npm run build",
        defaultValue: "npm run build",
        helpText: "Shell command executed when building the project before file upload."
    },
    {
        key: "tsRootDir",
        label: "TypeScript Root Directory",
        type: "text",
        placeholder: "Auto-detected from tsconfig.json",
        helpText: "Optional explicit TypeScript source folder relative to project root (e.g., TypeScripts)."
    },
    {
        key: "jsOutDir",
        label: "JavaScript Output Directory",
        type: "text",
        placeholder: "Auto-detected from tsconfig.json",
        helpText: "Optional explicit compiled JavaScript folder relative to project root (e.g., dist/FileCabinet/SuiteScripts)."
    },
    {
        key: "tsconfigPath",
        label: "tsconfig.json Path",
        type: "text",
        placeholder: "tsconfig.json",
        defaultValue: "tsconfig.json",
        helpText: "Relative path to tsconfig.json from the project root."
    },
    {
        key: "saveObjectsToProject",
        label: "Save Deployed SDF Objects to Project",
        type: "select",
        defaultValue: "auto",
        options: [
            { value: "auto", label: "Auto (copy if manifest.xml or Objects/ exists in project)" },
            { value: "true", label: "Always (true)" },
            { value: "false", label: "Never — background deploy only (false)" }
        ],
        helpText: "Controls whether SDF object XML files (and manifest.xml dependencies) are copied into the local project after deploying via the temporary SDF project. Can be overridden per tool call via saveToProject."
    },
    {
        key: "objectsFolderStrategy",
        label: "SDF Objects Subfolder Strategy",
        type: "select",
        defaultValue: "branch",
        options: [
            { value: "branch", label: "Git Branch (Objects/<branch>/<scriptId>.xml)" },
            { value: "flat", label: "Flat (Objects/<scriptId>.xml)" },
            { value: "type", label: "Object Type (Objects/<type>/<scriptId>.xml)" }
        ],
        helpText: "Determines where new SDF object XML files are saved under Objects/ when copied to the local project. Existing object files are always updated in-place."
    }
];

const KNOWN_SDF_OPTIONS: Record<string, { value: string; label: string }[]> = {
    accesstype: [
        { value: "CUSTRECORDENTRYPERM", label: "CUSTRECORDENTRYPERM (Use Permission List)" },
        { value: "NONENEEDED", label: "NONENEEDED (No Permission Required)" },
        { value: "USEPERMISSIONLIST", label: "USEPERMISSIONLIST" }
    ],
    externalrolepermissionlevel: [
        { value: "NONE", label: "NONE" },
        { value: "VIEW", label: "VIEW" },
        { value: "CREATE", label: "CREATE" },
        { value: "EDIT", label: "EDIT" },
        { value: "FULL", label: "FULL" }
    ],
    publicpermissionlevel: [
        { value: "NONE", label: "NONE" },
        { value: "VIEW", label: "VIEW" },
        { value: "CREATE", label: "CREATE" },
        { value: "EDIT", label: "EDIT" },
        { value: "FULL", label: "FULL" }
    ],
    accesslevel: [
        { value: "0", label: "0 (None)" },
        { value: "1", label: "1 (View)" },
        { value: "2", label: "2 (Edit)" }
    ],
    searchlevel: [
        { value: "0", label: "0 (None)" },
        { value: "1", label: "1 (View)" },
        { value: "2", label: "2 (Edit)" }
    ],
    displaytype: [
        { value: "NORMAL", label: "NORMAL" },
        { value: "DISABLED", label: "DISABLED" },
        { value: "INLINE", label: "INLINE" },
        { value: "HIDDEN", label: "HIDDEN" },
        { value: "STATICTEXT", label: "STATICTEXT" }
    ],
    onparentdelete: [
        { value: "SET_NULL", label: "SET_NULL" },
        { value: "STOP_DELETE", label: "STOP_DELETE" },
        { value: "DELETE_THIS_CHILD", label: "DELETE_THIS_CHILD" }
    ],
    fieldtype: [
        { value: "TEXT", label: "TEXT" },
        { value: "INTEGER", label: "INTEGER" },
        { value: "FLOAT", label: "FLOAT" },
        { value: "CURRENCY", label: "CURRENCY" },
        { value: "PERCENT", label: "PERCENT" },
        { value: "DATE", label: "DATE" },
        { value: "DATETIMETZ", label: "DATETIMETZ" },
        { value: "CHECKBOX", label: "CHECKBOX" },
        { value: "SELECT", label: "SELECT" },
        { value: "MULTISELECT", label: "MULTISELECT" },
        { value: "TEXTAREA", label: "TEXTAREA" },
        { value: "CLOBTEXT", label: "CLOBTEXT" },
        { value: "RICHTEXT", label: "RICHTEXT" },
        { value: "EMAIL", label: "EMAIL" },
        { value: "PHONE", label: "PHONE" },
        { value: "URL", label: "URL" },
        { value: "DOCUMENT", label: "DOCUMENT" },
        { value: "IMAGE", label: "IMAGE" },
        { value: "INLINEHTML", label: "INLINEHTML" },
        { value: "PASSWORD", label: "PASSWORD" },
        { value: "HELP", label: "HELP" },
        { value: "TIMEOFDAY", label: "TIMEOFDAY" }
    ]
};

const buildObjectDefaultsFields = (defaultsObj: Record<string, string | null>): FieldSchema[] => {
    return Object.entries(defaultsObj).map(([key, defVal]) => {
        if (defVal === "T" || defVal === "F") {
            return {
                key,
                label: key,
                type: "select",
                defaultValue: defVal,
                options: [
                    { value: "T", label: "T (True)" },
                    { value: "F", label: "F (False)" }
                ]
            };
        }
        if (KNOWN_SDF_OPTIONS[key]) {
            return {
                key,
                label: key,
                type: "select",
                defaultValue: defVal,
                options: KNOWN_SDF_OPTIONS[key]
            };
        }
        return {
            key,
            label: key,
            type: defVal === null ? "nullable_text" : "text",
            defaultValue: defVal,
            placeholder: defVal === null ? "null (empty)" : String(defVal)
        };
    });
};

export const getGlobalSectionsSchema = (): GlobalSectionSchema[] => {
    return [
        {
            id: "project",
            title: "Project & Build Defaults",
            description: "Global defaults for SDF directory resolution, TypeScript path mapping, and pre-upload build behavior (saved under \"project\" in config.json).",
            configPath: ["project"],
            fields: PROJECT_CONFIG_FIELDS
        },
        {
            id: "objectDefaults_RECORD",
            title: "Custom Record SDF Defaults (RECORD)",
            description: "Default SDF XML attributes applied when creating custom records via netsuite_create_custom_record.",
            configPath: ["objectDefaults", ObjectDefaultType.RECORD],
            fields: buildObjectDefaultsFields(projectDefaultsMap[ObjectDefaultType.RECORD])
        },
        {
            id: "objectDefaults_FIELD",
            title: "Custom Field SDF Defaults (FIELD)",
            description: "Default SDF XML attributes applied to custom record fields when creating or updating custom records.",
            configPath: ["objectDefaults", ObjectDefaultType.FIELD],
            fields: buildObjectDefaultsFields(projectDefaultsMap[ObjectDefaultType.FIELD])
        },
        {
            id: "objectDefaults_LIST",
            title: "Custom List SDF Defaults (LIST)",
            description: "Default SDF XML attributes applied when creating custom lists via netsuite_create_custom_list.",
            configPath: ["objectDefaults", ObjectDefaultType.LIST],
            fields: buildObjectDefaultsFields(projectDefaultsMap[ObjectDefaultType.LIST])
        }
    ];
};
