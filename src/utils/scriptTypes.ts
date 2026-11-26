import fs from "fs/promises";

export const SUPPORTED_SCRIPT_TYPES = [
    "USEREVENT",
    "CLIENT",
    "MAPREDUCE",
    "SCHEDULED",
    "SUITELET",
    "RESTLET",
    "WORKFLOWACTION",
    "MASSUPDATE",
    "PORTLET",
    "BUNDLEINSTALLATION",
    "EVENTSUBSCRIBER"
] as const;

export type ScriptTypeKey = (typeof SUPPORTED_SCRIPT_TYPES)[number];

export type SdfScriptRootElement =
    | "usereventscript"
    | "clientscript"
    | "mapreducescript"
    | "scheduledscript"
    | "suitelet"
    | "restlet"
    | "workflowactionscript"
    | "massupdatescript"
    | "portlet"
    | "bundleinstallationscript"
    | "eventsubscriber";

export interface ScriptTypeMetadata {
    key: ScriptTypeKey;
    sdfRootElement: SdfScriptRootElement;
    jsdocName: string;
    requiresRecordType: boolean;
    supportsSchedule: boolean;
    supportsDeploymentTitle: boolean;
    entryPoints: {
        exportName: string;
        sdfTag: string;
    }[];
}

export const SCRIPT_TYPE_METADATA: Record<ScriptTypeKey, ScriptTypeMetadata> = {
    USEREVENT: {
        key: "USEREVENT",
        sdfRootElement: "usereventscript",
        jsdocName: "UserEventScript",
        requiresRecordType: true,
        supportsSchedule: false,
        supportsDeploymentTitle: false,
        entryPoints: [
            { exportName: "beforeLoad", sdfTag: "beforeloadfunction" },
            { exportName: "beforeSubmit", sdfTag: "beforesubmitfunction" },
            { exportName: "afterSubmit", sdfTag: "aftersubmitfunction" }
        ]
    },
    CLIENT: {
        key: "CLIENT",
        sdfRootElement: "clientscript",
        jsdocName: "ClientScript",
        requiresRecordType: false,
        supportsSchedule: false,
        supportsDeploymentTitle: false,
        entryPoints: [
            { exportName: "pageInit", sdfTag: "pageinitfunction" },
            { exportName: "saveRecord", sdfTag: "saverecordfunction" },
            { exportName: "validateField", sdfTag: "validatefieldfunction" },
            { exportName: "fieldChanged", sdfTag: "fieldchangedfunction" },
            { exportName: "postSourcing", sdfTag: "postsourcingfunction" },
            { exportName: "lineInit", sdfTag: "lineinitfunction" },
            { exportName: "validateDelete", sdfTag: "validatedeletefunction" },
            { exportName: "validateInsert", sdfTag: "validateinsertfunction" },
            { exportName: "validateLine", sdfTag: "validatelinefunction" },
            { exportName: "sublistChanged", sdfTag: "sublistchangedfunction" }
        ]
    },
    MAPREDUCE: {
        key: "MAPREDUCE",
        sdfRootElement: "mapreducescript",
        jsdocName: "MapReduceScript",
        requiresRecordType: false,
        supportsSchedule: true,
        supportsDeploymentTitle: true,
        entryPoints: []
    },
    SCHEDULED: {
        key: "SCHEDULED",
        sdfRootElement: "scheduledscript",
        jsdocName: "ScheduledScript",
        requiresRecordType: false,
        supportsSchedule: true,
        supportsDeploymentTitle: true,
        entryPoints: [{ exportName: "execute", sdfTag: "defaultfunction" }]
    },
    SUITELET: {
        key: "SUITELET",
        sdfRootElement: "suitelet",
        jsdocName: "Suitelet",
        requiresRecordType: false,
        supportsSchedule: false,
        supportsDeploymentTitle: true,
        entryPoints: [{ exportName: "onRequest", sdfTag: "defaultfunction" }]
    },
    RESTLET: {
        key: "RESTLET",
        sdfRootElement: "restlet",
        jsdocName: "Restlet",
        requiresRecordType: false,
        supportsSchedule: false,
        supportsDeploymentTitle: true,
        entryPoints: [
            { exportName: "get", sdfTag: "getfunction" },
            { exportName: "post", sdfTag: "postfunction" },
            { exportName: "put", sdfTag: "putfunction" },
            { exportName: "delete", sdfTag: "deletefunction" }
        ]
    },
    WORKFLOWACTION: {
        key: "WORKFLOWACTION",
        sdfRootElement: "workflowactionscript",
        jsdocName: "WorkflowActionScript",
        requiresRecordType: true,
        supportsSchedule: false,
        supportsDeploymentTitle: false,
        entryPoints: [{ exportName: "onAction", sdfTag: "defaultfunction" }]
    },
    MASSUPDATE: {
        key: "MASSUPDATE",
        sdfRootElement: "massupdatescript",
        jsdocName: "MassUpdateScript",
        requiresRecordType: true,
        supportsSchedule: false,
        supportsDeploymentTitle: false,
        entryPoints: [{ exportName: "each", sdfTag: "defaultfunction" }]
    },
    PORTLET: {
        key: "PORTLET",
        sdfRootElement: "portlet",
        jsdocName: "Portlet",
        requiresRecordType: false,
        supportsSchedule: false,
        supportsDeploymentTitle: true,
        entryPoints: [{ exportName: "render", sdfTag: "defaultfunction" }]
    },
    BUNDLEINSTALLATION: {
        key: "BUNDLEINSTALLATION",
        sdfRootElement: "bundleinstallationscript",
        jsdocName: "BundleInstallationScript",
        requiresRecordType: false,
        supportsSchedule: false,
        supportsDeploymentTitle: true,
        entryPoints: [
            { exportName: "beforeInstall", sdfTag: "beforeinstallfunction" },
            { exportName: "afterInstall", sdfTag: "afterinstallfunction" },
            { exportName: "beforeUpdate", sdfTag: "beforeupdatefunction" },
            { exportName: "afterUpdate", sdfTag: "afterupdatefunction" },
            { exportName: "beforeUninstall", sdfTag: "beforeuninstallfunction" }
        ]
    },
    EVENTSUBSCRIBER: {
        key: "EVENTSUBSCRIBER",
        sdfRootElement: "eventsubscriber",
        jsdocName: "EventSubscriber",
        requiresRecordType: false,
        supportsSchedule: false,
        supportsDeploymentTitle: false,
        entryPoints: [{ exportName: "handle", sdfTag: "defaultfunction" }]
    }
};

export const ALL_SDF_SCRIPT_ROOT_ELEMENTS: SdfScriptRootElement[] = Object.values(
    SCRIPT_TYPE_METADATA
).map((m) => m.sdfRootElement);

const ALL_KNOWN_ENTRY_POINTS: string[] = Array.from(
    new Set([
        ...Object.values(SCRIPT_TYPE_METADATA).flatMap((m) =>
            m.entryPoints.map((ep) => ep.exportName)
        ),
        "getInputData",
        "map",
        "reduce",
        "summarize"
    ])
);

export type ScriptParameterType =
    | "CHECKBOX"
    | "CLOBTEXT"
    | "CURRENCY"
    | "DATE"
    | "DATETIMETZ"
    | "DOCUMENT"
    | "EMAIL"
    | "FLOAT"
    | "HELP"
    | "IMAGE"
    | "INLINEHTML"
    | "INTEGER"
    | "MULTISELECT"
    | "PASSWORD"
    | "PERCENT"
    | "PHONE"
    | "RICHTEXT"
    | "SELECT"
    | "TEXT"
    | "TEXTAREA"
    | "TIMEOFDAY"
    | "URL";

export interface ScriptParameterInput {
    scriptId: string;
    label: string;
    type: ScriptParameterType;
    selectRecordType?: string;
    description?: string;
    helpText?: string;
    defaultValue?: string | number | boolean;
    isMandatory?: boolean;
    setting?: "COMPANY" | "USER" | "NONE" | string;
    displayType?: "NORMAL" | "DISABLED" | "INLINE" | "HIDDEN" | "STATICTEXT";
}

export type ScheduleFrequency = "NONE" | "SINGLE" | "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";

export type DayOfWeek =
    | "SUNDAY"
    | "MONDAY"
    | "TUESDAY"
    | "WEDNESDAY"
    | "THURSDAY"
    | "FRIDAY"
    | "SATURDAY";

export interface DeploymentScheduleInput {
    frequency: ScheduleFrequency;
    /** Start date in YYYY-MM-DD format in the NetSuite account's local timezone (defaults to today in the account timezone). */
    startDate?: string;
    /** Start time in HH:mm:ss or HH:mm 24-hour format in the NetSuite account's local timezone (defaults to "01:00:00"). Automatically converted to UTC for SDF deployment. */
    startTime?: string;
    /** Optional end date in YYYY-MM-DD format, or boolean false/empty for no end date. */
    endDate?: string;
    /** For DAILY recurrence: run every X days (default 1). */
    everyXDays?: number;
    /** For WEEKLY recurrence: run every X weeks (default 1). */
    everyXWeeks?: number;
    /** For WEEKLY recurrence: days of week to run (e.g. ["MONDAY", "WEDNESDAY", "FRIDAY"]). */
    daysOfWeek?: DayOfWeek[];
    /** For MONTHLY recurrence: run every X months (default 1). */
    everyXMonths?: number;
    /** For MONTHLY/YEARLY recurrence: day of month (1-31). */
    dayOfMonth?: number;
    /** For YEARLY recurrence: month name (e.g. "JANUARY") or 1-12. */
    month?: string | number;
    /** Repeat interval within the day (e.g. 15, 30, 60 minutes, or ISO duration like "PT15M", "PT1H"). */
    repeatEveryMins?: number | string;
}

export interface ScriptDeploymentInput {
    /** Deployment ID (e.g., 'customdeploy_my_script_1'). Auto-prefixed with 'customdeploy_' if omitted. */
    scriptId?: string;
    /** Deployment title (defaults to the script name if omitted on creation). */
    title?: string;
    /** Whether the deployment checkbox 'Deployed' is checked (default true). */
    isDeployed?: boolean;
    /** Deployment status (e.g., 'TESTING', 'RELEASED', 'NOTSCHEDULED', 'SCHEDULED'). */
    status?: "TESTING" | "RELEASED" | "NOTSCHEDULED" | "SCHEDULED" | string;
    /** Log level ('DEBUG', 'AUDIT', 'ERROR', 'EMERGENCY'). */
    logLevel?: "DEBUG" | "AUDIT" | "ERROR" | "EMERGENCY" | string;
    /** Target record type for record-bound scripts (e.g., 'SALESORDER', 'CUSTOMER', 'customrecord_foo'). */
    recordType?: string;
    /** Event type filter for User Event / Client scripts (e.g., 'CREATE', 'EDIT', 'DELETE', 'VIEW'). */
    eventType?: string;
    /** Role under which the script executes (e.g., 'ADMINISTRATOR' or '[scriptid=customrole_...]'). */
    runAsRole?: string;
    /** Grant audience access to all roles ('T' / 'F'). */
    allRoles?: boolean;
    /** Specific audience role IDs (e.g., ['ADMINISTRATOR', '[scriptid=customrole_foo]']). */
    audienceRoles?: string[];
    /** Grant audience access to all employees ('T' / 'F'). */
    allEmployees?: boolean;
    /** Grant audience access to all partners ('T' / 'F'). */
    allPartners?: boolean;
    /** For Suitelets: whether the Suitelet is Available Without Login (isonline). */
    isOnline?: boolean;
    /** For Scheduled / MapReduce scripts: concurrency limit. */
    concurrencyLimit?: number;
    /** For MapReduce scripts: yield after minutes. */
    yieldAfterMins?: number;
    /** For MapReduce scripts: buffer size. */
    bufferSize?: number;
    /** Key-value map of script parameter values on this deployment (e.g. { custscript_my_param: "value" }). */
    parameterValues?: Record<string, string | number | boolean | null>;
    /** For Scheduled / MapReduce scripts: recurrence schedule configuration. */
    schedule?: DeploymentScheduleInput;
}

export type EventSubscriberEventType = "CREATED" | "UPDATED" | "DELETED";

export interface EventSubscriberCriterionParameterInput {
    /** Parameter name (defaults to 'RECORDTYPE'). */
    name?: string;
    /** Comparison operator (defaults to 'EQ'). */
    operator?: string;
    /** Value to compare against (e.g. 'SALESORDER', 'CUSTOMER', 'customrecord_foo'). */
    value: string;
}

export interface EventSubscriberCriterionInput {
    /** Event domain (defaults to 'RECORD'). */
    domain?: "RECORD" | string;
    /** Event type that triggers the subscriber: 'CREATED', 'UPDATED', or 'DELETED' (also accepts 'CREATE', 'UPDATE', 'EDIT', 'DELETE'). */
    type: EventSubscriberEventType | string;
    /** Target record type ID (e.g., 'SALESORDER', 'CUSTOMER', or 'customrecord_foo'). */
    recordType?: string;
    /** Optional explicit parameters array; defaults to [{ name: 'RECORDTYPE', operator: 'EQ', value: recordType }]. */
    parameters?: EventSubscriberCriterionParameterInput[];
}

export interface DeployScriptInput {
    /**
     * Path to the script file (e.g., 'src/TypeScripts/my_ue.ts' or '/SuiteScripts/my_ue.js').
     * Required when creating a new script or uploading code changes; optional if only updating an existing script record by scriptId.
     */
    filePath?: string;
    /**
     * Custom script ID (e.g., 'customscript_my_ue' for standard scripts [max 40 chars], or 'custevsub_my_sub' for Event Subscriber scripts [max 27 chars]).
     * Auto-prefixed with 'customscript_' (or 'custevsub_' for EVENTSUBSCRIBER) if needed.
     * Optional when updating an existing script already linked to `filePath`.
     */
    scriptId?: string;
    /**
     * Script type (e.g. 'USEREVENT', 'CLIENT', 'MAPREDUCE', 'SCHEDULED', 'SUITELET', 'RESTLET', 'WORKFLOWACTION', 'MASSUPDATE', 'PORTLET', 'BUNDLEINSTALLATION', 'EVENTSUBSCRIBER').
     * Auto-detected from `@NScriptType` in the file if omitted.
     */
    scriptType?: string;
    /** Display name of the script record (required when creating a new non-EVENTSUBSCRIBER script; max 40 chars). */
    name?: string;
    /** Description of the script record. */
    description?: string;
    /** Mark the script record as inactive. */
    isInactive?: boolean;
    /** Notify script owner on unhandled errors. */
    notifyOwner?: boolean;
    /** Notify current user on unhandled errors. */
    notifyUser?: boolean;
    /** Comma-separated email addresses to notify on script error. */
    notifyEmails?: string;
    /** For Portlet scripts: portlet type ('FORM', 'HTML', 'LINKS', 'LIST'). */
    portletType?: "FORM" | "HTML" | "LINKS" | "LIST";
    /** For Workflow Action scripts: return type (e.g. 'TEXT', 'INTEGER', 'CHECKBOX', 'SELECT', etc.). */
    returnType?: string;
    /** For Workflow Action scripts when returnType is SELECT: return record type. */
    returnRecordType?: string;
    /** Script parameter definitions (`custscript_*`) to add or update on the script record. */
    parameters?: ScriptParameterInput[];
    /** Script deployments (`customdeploy_*`) to add or update on the script record. */
    deployments?: ScriptDeploymentInput[];
    /** For Event Subscriber (`EVENTSUBSCRIBER`) scripts: subscription criteria (`<criteria><criterion>...</criterion></criteria>`) defining which record events trigger the script. */
    criteria?: EventSubscriberCriterionInput[];
    /** Additional helper/library file paths to compile and upload alongside the main script file. */
    additionalFiles?: string[];
    /** Skip running the project build command before uploading files. */
    skipBuild?: boolean;
    /** Skip uploading the script `.js` file (useful when only modifying parameters, schedules, or deployments on an already-uploaded script). */
    skipFileUpload?: boolean;
    /**
     * Set to true ONLY if you intentionally want to create a brand-new script record for a file
     * that already has an existing script record with a different scriptId in NetSuite or locally.
     */
    forceCreateNewScript?: boolean;
    /** Override whether the deployed SDF XML file is copied into the local project after deployment. */
    saveToProject?: boolean;
}

export interface SuiteQlScriptMatch {
    internalId: number;
    scriptId: string;
    name: string;
    scriptType: string;
    description?: string;
    isInactive: boolean;
    apiVersion?: string;
    ownerId?: number;
    ownerName?: string;
    scriptFileId?: number;
    scriptFileName?: string;
    fileCabinetPath?: string;
}

export interface SuiteQlDeploymentMatch {
    internalId?: number;
    primaryKey?: number;
    deploymentId: string;
    title?: string;
    status?: string;
    isDeployed: boolean;
    recordType?: string;
    logLevel?: string;
    runAsRole?: string;
    isOnline?: boolean;
    scriptInternalId?: number;
    scriptId?: string;
}

export interface GetScriptOptions {
    /** Script custom ID (e.g., 'customscript_my_ue') or numeric internal ID. */
    scriptId?: string;
    /** Local or File Cabinet script file path or file name (e.g., 'src/TypeScripts/my_ue.ts', '/SuiteScripts/my_ue.js', or 'my_ue.js'). */
    filePath?: string;
    /** When true, also downloads and parses the full SDF XML definition via SuiteCloud CLI (includes full recurrence schedules, audience blocks, and parameter values). */
    includeSdfXml?: boolean;
}

export interface SearchScriptsOptions {
    /** Filter by the target record type a script is deployed against (e.g., 'salesorder', 'customer', 'customrecord_foo'). */
    recordType?: string;
    /** Filter by script type (e.g., 'USEREVENT', 'CLIENT', 'MAPREDUCE', 'SCHEDULED', 'SUITELET', 'RESTLET', 'WORKFLOWACTION', 'MASSUPDATE', 'PORTLET', 'BUNDLEINSTALLATION', 'EVENTSUBSCRIBER'). */
    scriptType?: string;
    /** Partial case-insensitive search term matching script name, scriptId (customscript_* or custevsub_*), deploymentId (customdeploy_*), deployment title, or script file name. */
    searchTerm?: string;
    /** Filter by script file name or File Cabinet path (e.g., 'my_script.js' or '/SuiteScripts/my_script.js'). */
    fileName?: string;
    /** Filter by deployment 'isdeployed' checkbox (true = only deployed, false = only undeployed). */
    isDeployed?: boolean;
    /** Filter by deployment status (e.g., 'RELEASED', 'TESTING', 'NOTSCHEDULED', 'SCHEDULED', 'INPROGRESS'). */
    status?: string;
    /** Filter by deployment log level ('DEBUG', 'AUDIT', 'ERROR', 'EMERGENCY'). */
    logLevel?: string;
    /** Whether to include inactive scripts (isinactive = 'T'). Defaults to false. */
    includeInactive?: boolean;
    /** Maximum number of script records to return (default 100, max 500). */
    limit?: number;
}

export interface ParsedScriptXml {
    xmlPath: string;
    xmlContent: string;
    rootElement: SdfScriptRootElement;
    rootObj: Record<string, any>;
}

export interface SourceInspectionResult {
    scriptType?: ScriptTypeKey;
    apiVersion?: string;
    detectedExports: Set<string>;
}

/**
 * Normalizes a single item or array of items from xmlbuilder2 into an array.
 */
export const ensureArray = <T>(value: T | T[] | undefined | null): T[] => {
    if (value === undefined || value === null) return [];
    return Array.isArray(value) ? [...value] : [value];
};

/**
 * Converts a boolean to SDF `'T'` or `'F'`.
 */
export const toSdfFlag = (val: boolean): "T" | "F" => (val ? "T" : "F");

/**
 * Parses an SDF or SuiteQL `'T'`/`'F'` flag into a boolean.
 */
export const isSdfTrue = (val: unknown): boolean =>
    String(val ?? "F")
        .trim()
        .toUpperCase() === "T";

/**
 * Normalizes a user-provided or JSDoc script type string into our canonical `ScriptTypeKey`.
 */
export const normalizeScriptTypeKey = (rawType: string): ScriptTypeKey => {
    const cleaned = (rawType || "")
        .trim()
        .toUpperCase()
        .replace(/[\s_-]+/g, "")
        .replace(/SCRIPT$/, "");

    switch (cleaned) {
        case "USEREVENT":
        case "UE":
            return "USEREVENT";
        case "CLIENT":
        case "CS":
            return "CLIENT";
        case "MAPREDUCE":
        case "MR":
            return "MAPREDUCE";
        case "SCHEDULED":
        case "SS":
            return "SCHEDULED";
        case "SUITELET":
        case "SL":
            return "SUITELET";
        case "RESTLET":
        case "RL":
            return "RESTLET";
        case "WORKFLOWACTION":
        case "ACTION":
        case "WFA":
            return "WORKFLOWACTION";
        case "MASSUPDATE":
        case "MU":
            return "MASSUPDATE";
        case "PORTLET":
            return "PORTLET";
        case "BUNDLEINSTALLATION":
        case "BUNDLEINSTALL":
            return "BUNDLEINSTALLATION";
        case "EVENTSUBSCRIBER":
        case "EVSUB":
        case "ES":
            return "EVENTSUBSCRIBER";
        default:
            throw new Error(
                `Unsupported scriptType '${rawType}'. Supported types are: ${SUPPORTED_SCRIPT_TYPES.join(", ")}.`
            );
    }
};

/**
 * Maps an SDF XML root element name (e.g. 'usereventscript') to its canonical `ScriptTypeKey`.
 */
export const scriptTypeKeyFromSdfRoot = (rootElement: string): ScriptTypeKey | null => {
    const lower = (rootElement || "").trim().toLowerCase();
    for (const meta of Object.values(SCRIPT_TYPE_METADATA)) {
        if (meta.sdfRootElement === lower) {
            return meta.key;
        }
    }
    return null;
};

/**
 * Shared validator/normalizer for SDF prefixed IDs (`customscript_`, `custevsub_`, `customdeploy_`, `custscript_`).
 */
const normalizePrefixedSdfId = (
    rawId: string,
    prefix: "customscript_" | "custevsub_" | "customdeploy_" | "custscript_",
    label: string,
    stripXmlSuffix = false,
    maxLength = 40
): string => {
    let id = (rawId || "").trim();
    if (!id) {
        throw new Error(`${label} cannot be empty.`);
    }

    if (stripXmlSuffix && id.toLowerCase().endsWith(".xml")) {
        id = id.slice(0, -4);
    }

    id = id.trim().toLowerCase();
    if (!id.startsWith(prefix)) {
        id = `${prefix}${id.replace(/^_+/, "")}`;
    }

    const pattern = new RegExp(`^${prefix}[a-z0-9_]+$`);
    if (!pattern.test(id)) {
        throw new Error(
            `Invalid ${label} '${id}'. Only lowercase letters, digits, and underscores are allowed after '${prefix}'.`
        );
    }

    if (id.length > maxLength) {
        throw new Error(
            `${label} '${id}' is ${id.length} characters long, exceeding the NetSuite SDF limit of ${maxLength} characters for ${prefix}* IDs.`
        );
    }

    return id;
};

/**
 * Normalizes and validates a NetSuite Event Subscriber SDF ID (`custevsub_*`, max 27 chars).
 * Also strips the trailing `_script` suffix that NetSuite automatically appends to `script.scriptid`
 * in the SuiteQL `script` table for Event Subscriber records (e.g. `custevsub_foo_script` -> `custevsub_foo`).
 */
export const normalizeEventSubscriberId = (rawScriptId: string): string => {
    let cleaned = (rawScriptId || "").trim();
    if (cleaned.toLowerCase().endsWith(".xml")) {
        cleaned = cleaned.slice(0, -4).trim();
    }
    if (cleaned.toLowerCase().startsWith("customscript_")) {
        cleaned = cleaned.slice("customscript_".length);
    }
    const lower = cleaned.toLowerCase();
    const withPrefix = lower.startsWith("custevsub_")
        ? lower
        : `custevsub_${lower.replace(/^_+/, "")}`;
    const withoutAutoScriptSuffix =
        withPrefix.endsWith("_script") && withPrefix.length > "custevsub__script".length
            ? withPrefix.slice(0, -"_script".length)
            : withPrefix;
    return normalizePrefixedSdfId(withoutAutoScriptSuffix, "custevsub_", "'scriptId'", true, 27);
};

/**
 * Converts a SuiteQL `script.scriptid` value into the canonical SDF object `scriptid`.
 * For Event Subscriber scripts (`custevsub_*`), NetSuite stores `<sdf_scriptid>_script` in `script.scriptid`
 * (up to 34 chars) and `<SDF_SCRIPTID>` in `script.name`; this helper returns the base SDF `custevsub_*` ID.
 */
export const canonicalizeSuiteQlScriptId = (
    rawSuiteQlScriptId: string,
    scriptName?: string,
    scriptType?: string
): string => {
    const lowerId = (rawSuiteQlScriptId || "").trim().toLowerCase();
    const lowerName = (scriptName || "").trim().toLowerCase();
    const upperType = (scriptType || "").trim().toUpperCase();

    if (
        (lowerId.startsWith("custevsub_") || upperType.includes("EVENTSUBSCRIBER")) &&
        lowerId.endsWith("_script")
    ) {
        if (lowerName.startsWith("custevsub_") && lowerId === `${lowerName}_script`) {
            return lowerName;
        }
        if (lowerId.length > "custevsub__script".length) {
            return lowerId.slice(0, -"_script".length);
        }
    }

    return lowerId;
};

/**
 * Normalizes and validates a NetSuite Script ID (`customscript_*`, or `custevsub_*` for Event Subscriber scripts).
 */
export const normalizeCustomScriptId = (
    rawScriptId: string,
    scriptTypeKey?: ScriptTypeKey
): string => {
    const trimmed = (rawScriptId || "").trim();
    if (scriptTypeKey === "EVENTSUBSCRIBER" || trimmed.toLowerCase().startsWith("custevsub_")) {
        return normalizeEventSubscriberId(trimmed);
    }
    return normalizePrefixedSdfId(trimmed, "customscript_", "'scriptId'", true, 40);
};

/**
 * Normalizes and validates a NetSuite Script Deployment ID (`customdeploy_*`).
 */
export const normalizeCustomDeploymentId = (rawDeployId: string): string =>
    normalizePrefixedSdfId(rawDeployId, "customdeploy_", "Deployment 'scriptId'");

/**
 * Normalizes and validates a NetSuite Script Custom Field / Parameter ID (`custscript_*`).
 */
export const normalizeScriptParamId = (rawParamId: string): string =>
    normalizePrefixedSdfId(rawParamId, "custscript_", "Script parameter 'scriptId'");

/**
 * Derives a default `customdeploy_*` ID from a `customscript_*` ID.
 */
export const deriveDefaultDeploymentId = (normalizedScriptId: string): string => {
    const suffix = normalizedScriptId.replace(/^customscript_/, "");
    const candidate = `customdeploy_${suffix}`;
    return candidate.length <= 40 ? candidate : candidate.slice(0, 40).replace(/_+$/, "");
};

/**
 * Parses a local `.ts` or `.js` script file for `@NScriptType`, `@NApiVersion`, and exported entry-point functions.
 */
export const inspectScriptSourceFile = async (
    filePath: string
): Promise<SourceInspectionResult> => {
    let content = "";
    try {
        content = await fs.readFile(filePath, "utf-8");
    } catch {
        return { detectedExports: new Set() };
    }

    let scriptType: ScriptTypeKey | undefined;
    const typeMatch = content.match(/@NScriptType\s+([A-Za-z0-9_]+)/i);
    if (typeMatch && typeMatch[1]) {
        try {
            scriptType = normalizeScriptTypeKey(typeMatch[1]);
        } catch {
            // Ignore unparseable tag
        }
    }

    let apiVersion: string | undefined;
    const apiMatch = content.match(/@NApiVersion\s+([0-9.x]+)/i);
    if (apiMatch && apiMatch[1]) {
        apiVersion = apiMatch[1].trim();
    }

    const detectedExports = new Set<string>();

    for (const fnName of ALL_KNOWN_ENTRY_POINTS) {
        const regex = new RegExp(
            `(?:export\\s+(?:const|let|var|function|async\\s+function)\\s+${fnName}\\b|exports\\.${fnName}\\s*=|\\b${fnName}\\s*:\\s*(?:function|[A-Za-z0-9_]+|\\([^)]*\\)\\s*=>))`,
            "m"
        );
        if (regex.test(content)) {
            detectedExports.add(fnName);
        }
    }

    // Also inspect `return { beforeLoad, afterSubmit }` blocks common in AMD `define` modules
    const returnBlockMatches = content.matchAll(/return\s*\{([^}]+)\}/g);
    for (const match of returnBlockMatches) {
        const body = match[1];
        for (const fnName of ALL_KNOWN_ENTRY_POINTS) {
            if (new RegExp(`\\b${fnName}\\b`).test(body)) {
                detectedExports.add(fnName);
            }
        }
    }

    return {
        scriptType,
        apiVersion,
        detectedExports
    };
};
