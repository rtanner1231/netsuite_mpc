import { create } from "xmlbuilder2";
import { getSelectRecordType } from "./customRecords.js";
import {
    ALL_SDF_SCRIPT_ROOT_ELEMENTS,
    DayOfWeek,
    DeploymentScheduleInput,
    DeployScriptInput,
    deriveDefaultDeploymentId,
    ensureArray,
    EventSubscriberCriterionInput,
    EventSubscriberEventType,
    normalizeCustomDeploymentId,
    normalizeScriptParamId,
    ParsedScriptXml,
    ScheduleFrequency,
    SCRIPT_TYPE_METADATA,
    ScriptDeploymentInput,
    ScriptParameterInput,
    ScriptTypeKey,
    SourceInspectionResult,
    toSdfFlag
} from "./scriptTypes.js";

/**
 * Formats a record type reference for a `<scriptdeployment>` `<recordtype>` tag,
 * returning both the SDF-formatted string (e.g., `SALESORDER` or `[scriptid=customrecord_foo]`)
 * and any custom object dependency for `manifest.xml`.
 */
export const formatDeploymentRecordType = (
    rawRecordType: string
): { formatted: string; objectDependency?: string } => {
    const trimmed = (rawRecordType || "").trim();
    if (!trimmed) {
        throw new Error("Deployment 'recordType' cannot be empty.");
    }

    const bracketMatch = trimmed.match(/^\[scriptid=([^\]]+)\]$/i);
    const unwrapped = (bracketMatch ? bracketMatch[1] : trimmed).trim();

    if (
        unwrapped.toLowerCase().startsWith("customrecord_") ||
        unwrapped.toLowerCase().startsWith("customtransaction_")
    ) {
        const lowerId = unwrapped.toLowerCase();
        return {
            formatted: `[scriptid=${lowerId}]`,
            objectDependency: lowerId
        };
    }

    if (unwrapped.toUpperCase() === "ALLRECORD" || unwrapped.toUpperCase() === "ALL") {
        return { formatted: "ALLRECORD" };
    }

    return {
        formatted: unwrapped.toUpperCase()
    };
};

const ALL_DAYS_OF_WEEK: DayOfWeek[] = [
    "SUNDAY",
    "MONDAY",
    "TUESDAY",
    "WEDNESDAY",
    "THURSDAY",
    "FRIDAY",
    "SATURDAY"
];

/**
 * Computes the current calendar date (`YYYY-MM-DD`) in the target timezone.
 */
const getTodayIsoDateInTimeZone = (timeZone?: string): string => {
    const now = new Date();
    const tz = timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

    const offsetMatch = tz.match(/^([+-])(\d{2}):(\d{2})$/);
    if (offsetMatch) {
        const sign = offsetMatch[1] === "-" ? -1 : 1;
        const offsetMs =
            sign * (Number(offsetMatch[2]) * 60 + Number(offsetMatch[3])) * 60 * 1000;
        const shifted = new Date(now.getTime() + offsetMs);
        const yyyy = shifted.getUTCFullYear();
        const mm = String(shifted.getUTCMonth() + 1).padStart(2, "0");
        const dd = String(shifted.getUTCDate()).padStart(2, "0");
        return `${yyyy}-${mm}-${dd}`;
    }

    try {
        const parts = new Intl.DateTimeFormat("en-CA", {
            timeZone: tz,
            year: "numeric",
            month: "2-digit",
            day: "2-digit"
        }).formatToParts(now);

        const year = parts.find((p) => p.type === "year")?.value;
        const month = parts.find((p) => p.type === "month")?.value;
        const day = parts.find((p) => p.type === "day")?.value;
        if (year && month && day) {
            return `${year}-${month}-${day}`;
        }
    } catch {
        // Fallback to UTC date below
    }

    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(now.getUTCDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
};

/**
 * Returns the UTC offset in milliseconds (local wall-clock time minus UTC time)
 * for a given UTC Date instant in the specified IANA timezone or signed offset (`+HH:mm` / `-HH:mm`).
 */
const getTimeZoneOffsetMsAtInstant = (utcInstant: Date, timeZone: string): number => {
    const offsetMatch = timeZone.match(/^([+-])(\d{2}):(\d{2})$/);
    if (offsetMatch) {
        const sign = offsetMatch[1] === "-" ? -1 : 1;
        return sign * (Number(offsetMatch[2]) * 60 + Number(offsetMatch[3])) * 60 * 1000;
    }

    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23"
    }).formatToParts(utcInstant);

    const getNum = (type: string) => Number(parts.find((p) => p.type === type)?.value || 0);
    const localAsUtcMs = Date.UTC(
        getNum("year"),
        getNum("month") - 1,
        getNum("day"),
        getNum("hour"),
        getNum("minute"),
        getNum("second")
    );
    const instantRoundedSecMs = Math.floor(utcInstant.getTime() / 1000) * 1000;
    return localAsUtcMs - instantRoundedSecMs;
};

/**
 * Converts a local `(startDate, startTime)` in the NetSuite account's timezone into
 * the UTC `<startdate>YYYY-MM-DD</startdate>` and `<starttime>HH:mm:ssZ</starttime>` required by NetSuite SDF XML,
 * along with the calendar day shift (`-1`, `0`, or `+1`) if converting to UTC crossed midnight.
 */
export const convertLocalScheduleToSdfUtc = (
    rawStartDate?: string,
    rawStartTime?: string,
    accountTimeZone?: string
): {
    utcStartDate: string;
    utcStartTime: string;
    dayShift: number;
} => {
    const tz =
        accountTimeZone?.trim() ||
        Intl.DateTimeFormat().resolvedOptions().timeZone ||
        "UTC";

    const localDateStr = rawStartDate?.trim() || getTodayIsoDateInTimeZone(tz);
    const dateMatch = localDateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!dateMatch) {
        throw new Error(
            `Invalid schedule startDate '${localDateStr}'. Expected 'YYYY-MM-DD' format.`
        );
    }

    const year = Number(dateMatch[1]);
    const month = Number(dateMatch[2]);
    const day = Number(dateMatch[3]);

    // Parse startTime: strip any trailing 'Z' (treating '01:00:00' or '01:00:00Z' as account local time)
    // unless an explicit signed offset like '01:00:00-05:00' is provided.
    const trimmedTime = (rawStartTime || "01:00:00").trim();
    const timeMatch = trimmedTime.match(
        /^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*Z|([+-]\d{2}:\d{2}))?$/i
    );

    if (!timeMatch) {
        throw new Error(
            `Invalid schedule startTime '${rawStartTime}'. Expected 'HH:mm:ss' or 'HH:mm' 24-hour format (e.g. '01:00:00').`
        );
    }

    const hours = Number(timeMatch[1]);
    const minutes = Number(timeMatch[2]);
    const seconds = timeMatch[3] !== undefined ? Number(timeMatch[3]) : 0;
    const explicitOffset = timeMatch[4];

    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59 || seconds < 0 || seconds > 59) {
        throw new Error(
            `Invalid schedule startTime '${rawStartTime}': time components out of range.`
        );
    }

    const effectiveTz = explicitOffset || tz;
    const nominalLocalAsUtcMs = Date.UTC(year, month - 1, day, hours, minutes, seconds);

    let utcMs = nominalLocalAsUtcMs;
    try {
        // Two-pass refinement handles DST boundary transitions accurately
        const offset1 = getTimeZoneOffsetMsAtInstant(new Date(nominalLocalAsUtcMs), effectiveTz);
        utcMs = nominalLocalAsUtcMs - offset1;
        const offset2 = getTimeZoneOffsetMsAtInstant(new Date(utcMs), effectiveTz);
        utcMs = nominalLocalAsUtcMs - offset2;
    } catch {
        // Fallback if timezone cannot be evaluated
        utcMs = nominalLocalAsUtcMs;
    }

    const utcDate = new Date(utcMs);
    const utcYyyy = utcDate.getUTCFullYear();
    const utcMm = String(utcDate.getUTCMonth() + 1).padStart(2, "0");
    const utcDd = String(utcDate.getUTCDate()).padStart(2, "0");
    const utcHh = String(utcDate.getUTCHours()).padStart(2, "0");
    const utcMin = String(utcDate.getUTCMinutes()).padStart(2, "0");
    const utcSec = String(utcDate.getUTCSeconds()).padStart(2, "0");

    const localMidnightMs = Date.UTC(year, month - 1, day);
    const utcMidnightMs = Date.UTC(utcYyyy, utcDate.getUTCMonth(), utcDate.getUTCDate());
    const dayShift = Math.round((utcMidnightMs - localMidnightMs) / (24 * 60 * 60 * 1000));

    return {
        utcStartDate: `${utcYyyy}-${utcMm}-${utcDd}`,
        utcStartTime: `${utcHh}:${utcMin}:${utcSec}Z`,
        dayShift
    };
};

/**
 * Normalizes a repeat interval into SDF `<repeat>` duration format (e.g., `PT15M`, `PT1H`).
 */
const normalizeSdfRepeatDuration = (repeatEveryMins: number | string): string => {
    if (typeof repeatEveryMins === "string") {
        const upper = repeatEveryMins.trim().toUpperCase();
        if (upper.startsWith("PT")) {
            return upper;
        }
        const parsed = Number(upper);
        if (!isNaN(parsed) && parsed > 0) {
            repeatEveryMins = parsed;
        } else {
            return upper;
        }
    }

    const mins = Math.round(Number(repeatEveryMins));
    if (mins <= 0) {
        throw new Error(`Invalid repeatEveryMins '${repeatEveryMins}'. Must be a positive number of minutes.`);
    }
    if (mins >= 60 && mins % 60 === 0) {
        return `PT${mins / 60}H`;
    }
    return `PT${mins}M`;
};

/**
 * Builds an SDF `<recurrence>` object for Scheduled and Map/Reduce script deployments,
 * converting `startDate` and `startTime` from the NetSuite account timezone into UTC.
 */
export const buildSdfRecurrenceNode = (
    schedule?: DeploymentScheduleInput,
    accountTimeZone?: string
): Record<string, any> => {
    const freq: ScheduleFrequency = schedule?.frequency
        ? (schedule.frequency.trim().toUpperCase() as ScheduleFrequency)
        : "SINGLE";

    const {
        utcStartDate: startDate,
        utcStartTime: startTime,
        dayShift
    } = convertLocalScheduleToSdfUtc(schedule?.startDate, schedule?.startTime, accountTimeZone);

    const repeat =
        schedule?.repeatEveryMins !== undefined
            ? normalizeSdfRepeatDuration(schedule.repeatEveryMins)
            : undefined;
    const endDate = schedule?.endDate?.trim() || undefined;

    if (freq === "NONE" || freq === "SINGLE") {
        return {
            single: {
                ...(repeat ? { repeat } : {}),
                startdate: startDate,
                starttime: startTime
            }
        };
    }

    if (freq === "DAILY") {
        return {
            daily: {
                everyxdays: String(schedule?.everyXDays && schedule.everyXDays > 0 ? schedule.everyXDays : 1),
                ...(repeat ? { repeat } : {}),
                startdate: startDate,
                starttime: startTime,
                ...(endDate ? { enddate: endDate } : {})
            }
        };
    }

    if (freq === "WEEKLY") {
        const rawDays: DayOfWeek[] =
            Array.isArray(schedule?.daysOfWeek) && schedule!.daysOfWeek.length > 0
                ? (schedule!.daysOfWeek.map((d) => d.trim().toUpperCase()) as DayOfWeek[])
                : ["MONDAY"];

        const selectedDays = new Set<DayOfWeek>();
        for (const d of rawDays) {
            const idx = ALL_DAYS_OF_WEEK.indexOf(d);
            if (idx >= 0) {
                const shiftedIdx = (idx + dayShift + 7) % 7;
                selectedDays.add(ALL_DAYS_OF_WEEK[shiftedIdx]);
            }
        }

        const dayFlags: Record<string, string> = {};
        for (const d of ALL_DAYS_OF_WEEK) {
            dayFlags[d.toLowerCase()] = toSdfFlag(selectedDays.has(d));
        }

        return {
            weekly: {
                everyxweeks: String(
                    schedule?.everyXWeeks && schedule.everyXWeeks > 0 ? schedule.everyXWeeks : 1
                ),
                ...dayFlags,
                ...(repeat ? { repeat } : {}),
                startdate: startDate,
                starttime: startTime,
                ...(endDate ? { enddate: endDate } : {})
            }
        };
    }

    if (freq === "MONTHLY") {
        const adjustedDayOfMonth =
            schedule?.dayOfMonth !== undefined
                ? Math.min(Math.max(schedule.dayOfMonth + dayShift, 1), 31)
                : undefined;
        return {
            monthly: {
                everyxmonths: String(
                    schedule?.everyXMonths && schedule.everyXMonths > 0 ? schedule.everyXMonths : 1
                ),
                ...(adjustedDayOfMonth ? { dayofmonth: String(adjustedDayOfMonth) } : {}),
                ...(repeat ? { repeat } : {}),
                startdate: startDate,
                starttime: startTime,
                ...(endDate ? { enddate: endDate } : {})
            }
        };
    }

    if (freq === "YEARLY") {
        const adjustedDayOfMonth =
            schedule?.dayOfMonth !== undefined
                ? Math.min(Math.max(schedule.dayOfMonth + dayShift, 1), 31)
                : undefined;
        return {
            yearly: {
                ...(schedule?.month !== undefined ? { month: String(schedule.month).toUpperCase() } : {}),
                ...(adjustedDayOfMonth ? { dayofmonth: String(adjustedDayOfMonth) } : {}),
                ...(repeat ? { repeat } : {}),
                startdate: startDate,
                starttime: startTime,
                ...(endDate ? { enddate: endDate } : {})
            }
        };
    }

    throw new Error(
        `Invalid schedule frequency '${schedule?.frequency}'. Expected one of: NONE, SINGLE, DAILY, WEEKLY, MONTHLY, YEARLY.`
    );
};

/**
 * Maps a `ScriptParameterInput` to an SDF `<scriptcustomfield>` object, preserving any existing properties when merging.
 */
export const buildOrMergeScriptParameterNode = (
    input: ScriptParameterInput,
    existingNode?: Record<string, any>
): { node: Record<string, any>; objectDependency?: string } => {
    const paramId = normalizeScriptParamId(input.scriptId);
    const base: Record<string, any> = existingNode
        ? { ...existingNode, "@scriptid": paramId }
        : {
              "@scriptid": paramId,
              accesslevel: "2",
              applyformatting: "T",
              checkspelling: "F",
              defaultchecked: "F",
              defaultselection: "",
              defaultvalue: "",
              description: "",
              displayheight: "",
              displaytype: "NORMAL",
              displaywidth: "",
              dynamicdefault: "",
              fieldtype: "TEXT",
              help: "",
              isformula: "F",
              ismandatory: "F",
              label: input.label,
              linktext: "",
              maxlength: "",
              maxvalue: "",
              minvalue: "",
              onparentdelete: "",
              searchlevel: "2",
              selectrecordtype: "",
              setting: "",
              storevalue: "T"
          };

    if (input.type) {
        base.fieldtype = input.type.trim().toUpperCase();
    }
    if (input.label !== undefined) {
        base.label = input.label;
    }
    if (input.description !== undefined) {
        base.description = input.description;
    }
    if (input.helpText !== undefined) {
        base.help = input.helpText;
    }
    if (input.isMandatory !== undefined) {
        base.ismandatory = toSdfFlag(input.isMandatory);
    }
    if (input.displayType !== undefined) {
        base.displaytype = input.displayType;
    }
    if (input.setting !== undefined) {
        base.setting = input.setting === "NONE" ? "" : input.setting;
    }

    if (input.defaultValue !== undefined) {
        if (base.fieldtype === "CHECKBOX") {
            const isChecked =
                input.defaultValue === true ||
                String(input.defaultValue).trim().toUpperCase() === "T" ||
                String(input.defaultValue).trim().toUpperCase() === "TRUE";
            base.defaultchecked = toSdfFlag(isChecked);
            base.defaultvalue = "";
        } else {
            base.defaultvalue = String(input.defaultValue);
        }
    }

    let objectDependency: string | undefined;
    if (
        (base.fieldtype === "SELECT" || base.fieldtype === "MULTISELECT") &&
        input.selectRecordType
    ) {
        const trimmedSel = input.selectRecordType.trim();
        const bracketMatch = trimmedSel.match(/^\[scriptid=([^\]]+)\]$/i);
        const rawSel = (bracketMatch ? bracketMatch[1] : trimmedSel).trim();
        base.selectrecordtype = getSelectRecordType(rawSel);

        if (rawSel.startsWith("customrecord_") || rawSel.startsWith("customlist_")) {
            objectDependency = rawSel;
        }
    }

    return { node: base, objectDependency };
};

const applyRecordBoundDeploymentFields = (
    node: Record<string, any>,
    deployId: string,
    scriptType: ScriptTypeKey,
    input: ScriptDeploymentInput,
    isUpdate: boolean,
    objectDependencies: string[]
) => {
    const typeMeta = SCRIPT_TYPE_METADATA[scriptType];
    if (
        scriptType !== "USEREVENT" &&
        scriptType !== "CLIENT" &&
        scriptType !== "WORKFLOWACTION" &&
        scriptType !== "MASSUPDATE"
    ) {
        return;
    }

    if (input.recordType !== undefined && input.recordType.trim() !== "") {
        const { formatted, objectDependency } = formatDeploymentRecordType(input.recordType);
        node.recordtype = formatted;
        if (objectDependency) {
            objectDependencies.push(objectDependency);
        }
    } else if (!isUpdate && typeMeta.requiresRecordType && !node.recordtype) {
        throw new Error(
            `Deployment '${deployId}' for scriptType '${scriptType}' requires 'recordType' (e.g., 'SALESORDER', 'CUSTOMER', or 'customrecord_...').`
        );
    }

    if (input.eventType !== undefined) {
        node.eventtype = input.eventType.trim().toUpperCase();
    }
};

/**
 * Formats a role reference for SDF `<runasrole>` or `<audslctrole>`.
 * - `"CURRENT_ROLE"` or `""` -> `""` (empty tag = execute as current role)
 * - `"customrole_foo"` or `"[scriptid=customrole_foo]"` -> `"[scriptid=customrole_foo]"` (and records `customrole_foo` as a manifest dependency)
 * - Standard role tokens like `"administrator"` -> `"ADMINISTRATOR"`
 */
export const formatSdfRoleReference = (
    rawRole: string
): { formatted: string; objectDependency?: string } => {
    const trimmed = (rawRole || "").trim();
    if (!trimmed) {
        return { formatted: "" };
    }

    const upper = trimmed.toUpperCase().replace(/[\s-]+/g, "_");
    if (upper === "CURRENT_ROLE" || upper === "CURRENTROLE" || upper === "CURRENT" || upper === "NONE") {
        return { formatted: "" };
    }

    const bracketMatch = trimmed.match(/^\[scriptid=([^\]]+)\]$/i);
    const unwrapped = (bracketMatch ? bracketMatch[1] : trimmed).trim();

    if (unwrapped.toLowerCase().startsWith("customrole_")) {
        const lowerRole = unwrapped.toLowerCase();
        return {
            formatted: `[scriptid=${lowerRole}]`,
            objectDependency: lowerRole
        };
    }

    return {
        formatted: unwrapped.toUpperCase()
    };
};

const applyAudienceAndRoleDeploymentFields = (
    node: Record<string, any>,
    scriptType: ScriptTypeKey,
    input: ScriptDeploymentInput,
    isUpdate: boolean,
    objectDependencies: string[]
) => {
    const typeMeta = SCRIPT_TYPE_METADATA[scriptType];

    if (!typeMeta.supportsSchedule && scriptType !== "BUNDLEINSTALLATION") {
        if (input.allRoles !== undefined) {
            node.allroles = toSdfFlag(input.allRoles);
        } else if (!isUpdate && node.allroles === undefined) {
            node.allroles = "T";
        }

        if (input.audienceRoles !== undefined) {
            const formattedRoles: string[] = [];
            for (const r of input.audienceRoles) {
                const { formatted, objectDependency } = formatSdfRoleReference(r);
                if (formatted) {
                    formattedRoles.push(formatted);
                }
                if (objectDependency) {
                    objectDependencies.push(objectDependency);
                }
            }
            node.audslctrole = formattedRoles.join("|");
            if (input.allRoles === undefined && formattedRoles.length > 0) {
                node.allroles = "F";
            }
        }

        if (input.allEmployees !== undefined) {
            node.allemployees = toSdfFlag(input.allEmployees);
        } else if (!isUpdate && node.allemployees === undefined) {
            node.allemployees = "F";
        }

        if (input.allPartners !== undefined) {
            node.allpartners = toSdfFlag(input.allPartners);
        } else if (!isUpdate && node.allpartners === undefined && scriptType !== "RESTLET") {
            node.allpartners = "F";
        }
    }

    if (
        scriptType === "USEREVENT" ||
        scriptType === "SUITELET" ||
        scriptType === "WORKFLOWACTION" ||
        scriptType === "BUNDLEINSTALLATION"
    ) {
        if (input.runAsRole !== undefined) {
            const { formatted, objectDependency } = formatSdfRoleReference(input.runAsRole);
            node.runasrole = formatted;
            if (objectDependency) {
                objectDependencies.push(objectDependency);
            }
        } else if (!isUpdate && node.runasrole === undefined) {
            node.runasrole = "ADMINISTRATOR";
        }
    }

    if (scriptType === "SUITELET") {
        if (input.isOnline !== undefined) {
            node.isonline = toSdfFlag(input.isOnline);
        } else if (!isUpdate && node.isonline === undefined) {
            node.isonline = "F";
        }
        if (input.eventType !== undefined) {
            node.eventtype = input.eventType.trim().toUpperCase();
        } else if (!isUpdate && node.eventtype === undefined) {
            node.eventtype = "";
        }
        if (!isUpdate && node.audslctrole === undefined) {
            node.audslctrole = "";
        }
    }
};

const applyScheduledAndMapReduceDeploymentFields = (
    node: Record<string, any>,
    scriptType: ScriptTypeKey,
    input: ScriptDeploymentInput,
    isUpdate: boolean,
    accountTimeZone?: string
) => {
    if (!SCRIPT_TYPE_METADATA[scriptType].supportsSchedule) {
        return;
    }

    if (input.concurrencyLimit !== undefined) {
        node.concurrencylimit = String(input.concurrencyLimit);
    } else if (!isUpdate && node.concurrencylimit === undefined && scriptType === "MAPREDUCE") {
        node.concurrencylimit = "1";
    }

    if (scriptType === "MAPREDUCE") {
        if (input.yieldAfterMins !== undefined) {
            node.yieldaftermins = String(input.yieldAfterMins);
        } else if (!isUpdate && node.yieldaftermins === undefined) {
            node.yieldaftermins = "60";
        }

        if (input.bufferSize !== undefined) {
            node.buffersize = String(input.bufferSize);
        } else if (!isUpdate && node.buffersize === undefined) {
            node.buffersize = "1";
        }
    }

    if (input.schedule !== undefined) {
        if (input.schedule.frequency === "NONE") {
            node.status = "NOTSCHEDULED";
        }
        node.recurrence = buildSdfRecurrenceNode(input.schedule, accountTimeZone);
    } else if (!isUpdate && !node.recurrence) {
        node.recurrence = buildSdfRecurrenceNode({ frequency: "SINGLE" }, accountTimeZone);
    }
};

const applyDeploymentParameterValues = (
    node: Record<string, any>,
    parameterValues: Record<string, string | number | boolean | null> | undefined,
    objectDependencies: string[]
) => {
    if (!parameterValues || typeof parameterValues !== "object") {
        return;
    }

    for (const [rawKey, rawVal] of Object.entries(parameterValues)) {
        const paramKey = normalizeScriptParamId(rawKey);
        if (rawVal === null || rawVal === undefined) {
            node[paramKey] = "";
        } else if (typeof rawVal === "boolean") {
            node[paramKey] = toSdfFlag(rawVal);
        } else {
            const strVal = String(rawVal);
            node[paramKey] = strVal;
            const refMatch = strVal.match(/^\[scriptid=([^\]]+)\]$/i);
            if (refMatch && refMatch[1]) {
                objectDependencies.push(refMatch[1].trim().split(".")[0]);
            }
        }
    }
};

/**
 * Builds or merges a `<scriptdeployment>` XML node according to the script type.
 */
export const buildOrMergeScriptDeploymentNode = (args: {
    scriptType: ScriptTypeKey;
    scriptName: string;
    defaultDeployId: string;
    input: ScriptDeploymentInput;
    existingNode?: Record<string, any>;
    accountTimeZone?: string;
}): { node: Record<string, any>; objectDependencies: string[] } => {
    const { scriptType, scriptName, defaultDeployId, input, existingNode, accountTimeZone } = args;
    const typeMeta = SCRIPT_TYPE_METADATA[scriptType];
    const objectDependencies: string[] = [];

    const deployId = input.scriptId
        ? normalizeCustomDeploymentId(input.scriptId)
        : existingNode?.["@scriptid"]
          ? String(existingNode["@scriptid"])
          : defaultDeployId;

    const isUpdate = Boolean(existingNode);
    const node: Record<string, any> = existingNode
        ? { ...existingNode, "@scriptid": deployId }
        : { "@scriptid": deployId };

    const defaultStatus = typeMeta.supportsSchedule
        ? input.schedule && input.schedule.frequency !== "NONE"
            ? "SCHEDULED"
            : "NOTSCHEDULED"
        : "TESTING";

    if (input.status !== undefined) {
        node.status = input.status.trim().toUpperCase();
    } else if (!isUpdate && !node.status) {
        node.status = defaultStatus;
    } else if (
        isUpdate &&
        typeMeta.supportsSchedule &&
        input.schedule?.frequency &&
        input.schedule.frequency !== "NONE" &&
        node.status === "NOTSCHEDULED"
    ) {
        node.status = "SCHEDULED";
    }

    if (typeMeta.supportsDeploymentTitle) {
        if (input.title !== undefined) {
            node.title = input.title;
        } else if (!isUpdate && !node.title) {
            node.title = scriptName || deployId;
        }
    } else {
        delete node.title;
    }

    if (input.isDeployed !== undefined) {
        node.isdeployed = toSdfFlag(input.isDeployed);
    } else if (!isUpdate && !node.isdeployed) {
        node.isdeployed = "T";
    }

    if (input.logLevel !== undefined) {
        node.loglevel = input.logLevel.trim().toUpperCase();
    } else if (!isUpdate && !node.loglevel) {
        node.loglevel = "DEBUG";
    }

    applyRecordBoundDeploymentFields(node, deployId, scriptType, input, isUpdate, objectDependencies);
    applyAudienceAndRoleDeploymentFields(node, scriptType, input, isUpdate, objectDependencies);
    applyScheduledAndMapReduceDeploymentFields(node, scriptType, input, isUpdate, accountTimeZone);
    applyDeploymentParameterValues(node, input.parameterValues, objectDependencies);

    return {
        node: orderScriptDeploymentNodeKeys(node),
        objectDependencies
    };
};

/**
 * Reorders keys on a `<scriptdeployment>` object so child elements appear in the exact
 * alphabetical / schema order required by NetSuite SDF (with `<recurrence>` placed last).
 */
export const orderScriptDeploymentNodeKeys = (
    node: Record<string, any>
): Record<string, any> => {
    const ordered: Record<string, any> = {};

    // 1. XML attributes first (e.g. @scriptid)
    for (const key of Object.keys(node)) {
        if (key.startsWith("@") && node[key] !== undefined) {
            ordered[key] = node[key];
        }
    }

    // 2. All standard and custom (custscript_*) element keys in alphabetical order, except 'recurrence'
    const elementKeys = Object.keys(node)
        .filter((k) => !k.startsWith("@") && k !== "recurrence" && node[k] !== undefined)
        .sort((a, b) => a.localeCompare(b));

    for (const key of elementKeys) {
        ordered[key] = node[key];
    }

    // 3. 'recurrence' block goes after standard elements on Scheduled / MapReduce deployments
    if (node.recurrence !== undefined) {
        ordered.recurrence = node.recurrence;
    }

    return ordered;
};

/**
 * Normalizes an Event Subscriber event type string into 'CREATED', 'UPDATED', or 'DELETED'.
 */
export const normalizeEventSubscriberEventType = (
    rawType: string
): EventSubscriberEventType => {
    const cleaned = (rawType || "").trim().toUpperCase();
    switch (cleaned) {
        case "CREATED":
        case "CREATE":
            return "CREATED";
        case "UPDATED":
        case "UPDATE":
        case "EDIT":
        case "EDITED":
        case "XEDIT":
            return "UPDATED";
        case "DELETED":
        case "DELETE":
            return "DELETED";
        default:
            throw new Error(
                `Invalid Event Subscriber criterion 'type' ('${rawType}'). Supported values are: CREATED, UPDATED, DELETED.`
            );
    }
};

/**
 * Formats a record type value for an `<eventsubscriber>` `<parameter>` `<value>` tag.
 * Standard record types are uppercased (e.g. `SALESORDER`); custom record / transaction script IDs
 * are kept lowercase without `[scriptid=...]` wrappers (e.g. `customrecord_foo`).
 */
export const formatEventSubscriberRecordTypeValue = (rawRecordType: string): string => {
    const trimmed = (rawRecordType || "").trim();
    if (!trimmed) {
        throw new Error("Event Subscriber criterion 'recordType' / parameter 'value' cannot be empty.");
    }

    const bracketMatch = trimmed.match(/^\[scriptid=([^\]]+)\]$/i);
    const unwrapped = (bracketMatch ? bracketMatch[1] : trimmed).trim();

    if (
        unwrapped.toLowerCase().startsWith("customrecord_") ||
        unwrapped.toLowerCase().startsWith("customtransaction_")
    ) {
        return unwrapped.toLowerCase();
    }

    return unwrapped.toUpperCase();
};

/**
 * Builds the `<criteria><criterion>...</criterion></criteria>` node for an `<eventsubscriber>` SDF XML object.
 */
export const buildEventSubscriberCriteriaNode = (
    criteriaInputs: EventSubscriberCriterionInput[]
): { criterion: Record<string, any>[] } => {
    if (!Array.isArray(criteriaInputs) || criteriaInputs.length === 0) {
        throw new Error(
            "Event Subscriber scripts require at least one subscription criterion in 'criteria' (e.g. criteria: [{ type: 'CREATED', recordType: 'SALESORDER' }])."
        );
    }

    const criterionNodes = criteriaInputs.map((c, idx) => {
        if (!c || typeof c !== "object") {
            throw new Error(`Invalid criterion at index ${idx}.`);
        }

        const domain = (c.domain || "RECORD").trim().toUpperCase();
        const type = normalizeEventSubscriberEventType(c.type);

        let paramNodes: { name: string; operator: string; value: string }[] = [];
        if (Array.isArray(c.parameters) && c.parameters.length > 0) {
            paramNodes = c.parameters.map((p) => {
                const name = (p.name || "RECORDTYPE").trim().toUpperCase();
                const operator = (p.operator || "EQ").trim().toUpperCase();
                const value =
                    name === "RECORDTYPE"
                        ? formatEventSubscriberRecordTypeValue(p.value)
                        : String(p.value || "").trim();
                if (!value) {
                    throw new Error(
                        `Event Subscriber criterion at index ${idx} has an empty parameter value.`
                    );
                }
                return { name, operator, value };
            });
        } else if (c.recordType && c.recordType.trim()) {
            paramNodes = [
                {
                    name: "RECORDTYPE",
                    operator: "EQ",
                    value: formatEventSubscriberRecordTypeValue(c.recordType)
                }
            ];
        } else {
            throw new Error(
                `Event Subscriber criterion at index ${idx} requires 'recordType' (e.g. 'SALESORDER' or 'customrecord_...') or a non-empty 'parameters' array.`
            );
        }

        return {
            domain,
            type,
            parameters: {
                parameter: paramNodes
            }
        };
    });

    return {
        criterion: criterionNodes
    };
};

/**
 * Extracts a normalized summary array of subscription criteria from a parsed `<eventsubscriber>` root object.
 */
export const extractEventSubscriberCriteriaSummary = (
    rootObj?: Record<string, any>
): {
    domain: string;
    type: string;
    recordType?: string;
    parameters: { name: string; operator: string; value: string }[];
}[] => {
    if (!rootObj?.criteria?.criterion) {
        return [];
    }

    const rawCriteria = ensureArray<Record<string, any>>(rootObj.criteria.criterion);
    return rawCriteria.map((c) => {
        const domain = String(c?.domain || "RECORD");
        const type = String(c?.type || "");
        const rawParams = ensureArray<Record<string, any>>(c?.parameters?.parameter);
        const parameters = rawParams.map((p) => ({
            name: String(p?.name || ""),
            operator: String(p?.operator || ""),
            value: String(p?.value || "")
        }));
        const recordTypeParam = parameters.find(
            (p) => p.name.toUpperCase() === "RECORDTYPE"
        );
        return {
            domain,
            type,
            ...(recordTypeParam ? { recordType: recordTypeParam.value } : {}),
            parameters
        };
    });
};

/**
 * Reorders keys on an SDF script root object so header elements appear in canonical alphabetical
 * SDF schema order followed by `<criteria>`, `<scriptcustomfields>`, and `<scriptdeployments>`.
 */
export const orderScriptRootObjectKeys = (rootObj: Record<string, any>): Record<string, any> => {
    const ordered: Record<string, any> = {};

    if (rootObj["@scriptid"] !== undefined) {
        ordered["@scriptid"] = rootObj["@scriptid"];
    }

    const headerKeys = Object.keys(rootObj)
        .filter(
            (k) =>
                !k.startsWith("@") &&
                k !== "criteria" &&
                k !== "scriptcustomfields" &&
                k !== "scriptdeployments" &&
                rootObj[k] !== undefined
        )
        .sort((a, b) => a.localeCompare(b));

    for (const key of headerKeys) {
        ordered[key] = rootObj[key];
    }

    if (rootObj.criteria !== undefined) {
        ordered.criteria = rootObj.criteria;
    }

    if (rootObj.scriptcustomfields !== undefined) {
        ordered.scriptcustomfields = rootObj.scriptcustomfields;
    }

    if (rootObj.scriptdeployments !== undefined) {
        const rawDeploys = rootObj.scriptdeployments.scriptdeployment;
        if (Array.isArray(rawDeploys)) {
            ordered.scriptdeployments = {
                ...rootObj.scriptdeployments,
                scriptdeployment: rawDeploys.map((d) =>
                    d && typeof d === "object" ? orderScriptDeploymentNodeKeys(d) : d
                )
            };
        } else if (rawDeploys && typeof rawDeploys === "object") {
            ordered.scriptdeployments = {
                ...rootObj.scriptdeployments,
                scriptdeployment: orderScriptDeploymentNodeKeys(rawDeploys)
            };
        } else {
            ordered.scriptdeployments = rootObj.scriptdeployments;
        }
    }

    return ordered;
};

/**
 * Extracts all `[scriptid=...]` object references from an SDF script XML root object
 * so they can be added to `manifest.xml` `<objects>`.
 */
export const collectScriptObjectDependencies = (
    rootObj: Record<string, any>,
    selfScriptId: string
): string[] => {
    const deps = new Set<string>();
    const selfLower = selfScriptId.toLowerCase();

    const visit = (val: any) => {
        if (!val) return;
        if (typeof val === "string") {
            for (const m of val.matchAll(/\[scriptid=([^\]]+)\]/gi)) {
                if (m[1]) {
                    const topLevelId = m[1].trim().split(".")[0].toLowerCase();
                    if (topLevelId && topLevelId !== selfLower) {
                        deps.add(topLevelId);
                    }
                }
            }
            return;
        }
        if (Array.isArray(val)) {
            for (const item of val) visit(item);
            return;
        }
        if (typeof val === "object") {
            for (const v of Object.values(val)) visit(v);
        }
    };

    visit(rootObj);
    return Array.from(deps);
};

/**
 * Parses an XML string and checks if its root element is one of `ALL_SDF_SCRIPT_ROOT_ELEMENTS`.
 */
export const parseScriptXmlString = (
    xmlPath: string,
    xmlContent: string
): ParsedScriptXml | null => {
    try {
        const parsed = create(xmlContent).toObject() as any;
        for (const rootEl of ALL_SDF_SCRIPT_ROOT_ELEMENTS) {
            if (parsed && parsed[rootEl] && typeof parsed[rootEl] === "object") {
                return {
                    xmlPath,
                    xmlContent,
                    rootElement: rootEl,
                    rootObj: parsed[rootEl]
                };
            }
        }
    } catch {
        // Ignore unparseable XML
    }
    return null;
};

/**
 * Constructs or merges the full SDF script root object (header fields, parameters, deployments, key ordering,
 * and manifest object dependencies) and serializes it to formatted XML.
 */
export const buildMergedScriptXml = (args: {
    finalScriptId: string;
    scriptTypeKey: ScriptTypeKey;
    input: DeployScriptInput;
    existingImport: ParsedScriptXml | null;
    fileCabinetPath?: string;
    sourceInspection: SourceInspectionResult;
    accountTimeZone?: string;
}): {
    rootElement: string;
    orderedRootObj: Record<string, any>;
    xmlContent: string;
    objectDependencies: Set<string>;
} => {
    const {
        finalScriptId,
        scriptTypeKey,
        input,
        existingImport,
        fileCabinetPath,
        sourceInspection,
        accountTimeZone
    } = args;

    const typeMeta = SCRIPT_TYPE_METADATA[scriptTypeKey];
    const rootElement = typeMeta.sdfRootElement;

    if (scriptTypeKey === "EVENTSUBSCRIBER") {
        const rootObj: Record<string, any> = existingImport
            ? { ...existingImport.rootObj, "@scriptid": finalScriptId }
            : { "@scriptid": finalScriptId };

        if (fileCabinetPath) {
            rootObj.scriptfilepath = `[${fileCabinetPath}]`;
        } else if (!rootObj.scriptfilepath) {
            throw new Error(
                `'filePath' is required when creating a new Event Subscriber script ('${finalScriptId}' does not exist in NetSuite yet).`
            );
        }

        if (Array.isArray(input.criteria) && input.criteria.length > 0) {
            rootObj.criteria = buildEventSubscriberCriteriaNode(input.criteria);
        } else if (
            Array.isArray(input.deployments) &&
            input.deployments.some((d) => Boolean(d.recordType && d.recordType.trim()))
        ) {
            const derivedCriteria: EventSubscriberCriterionInput[] = input.deployments
                .filter((d) => Boolean(d.recordType && d.recordType.trim()))
                .map((d) => ({
                    domain: "RECORD",
                    type: d.eventType || "CREATED",
                    recordType: d.recordType!.trim()
                }));
            rootObj.criteria = buildEventSubscriberCriteriaNode(derivedCriteria);
        } else if (!rootObj.criteria?.criterion) {
            throw new Error(
                `Creating a new 'EVENTSUBSCRIBER' script requires at least one subscription criterion in 'criteria' (e.g., criteria: [{ type: "CREATED", recordType: "SALESORDER" }]).`
            );
        }

        const orderedRootObj = orderScriptRootObjectKeys(rootObj);
        const objectDependencies = new Set<string>(
            collectScriptObjectDependencies(orderedRootObj, finalScriptId)
        );
        const xmlContent = create(
            { version: "1.0", encoding: "UTF-8" },
            { [rootElement]: orderedRootObj }
        ).end({ prettyPrint: true });

        return {
            rootElement,
            orderedRootObj,
            xmlContent,
            objectDependencies
        };
    }

    let rootObj: Record<string, any>;
    if (existingImport) {
        rootObj = { ...existingImport.rootObj, "@scriptid": finalScriptId };
    } else {
        if (!input.name || !input.name.trim()) {
            throw new Error(
                `'name' is required when creating a new script record ('${finalScriptId}' does not exist in NetSuite yet).`
            );
        }
        if (!fileCabinetPath) {
            throw new Error(
                `'filePath' is required when creating a new script record ('${finalScriptId}' does not exist in NetSuite yet).`
            );
        }

        const supportsNotifyUser =
            scriptTypeKey !== "MAPREDUCE" &&
            scriptTypeKey !== "SCHEDULED" &&
            scriptTypeKey !== "BUNDLEINSTALLATION";

        rootObj = {
            "@scriptid": finalScriptId,
            name: input.name.trim(),
            description: input.description ?? "",
            isinactive: toSdfFlag(Boolean(input.isInactive)),
            notifyadmins: "F",
            notifyemails: input.notifyEmails ?? "",
            notifyowner: toSdfFlag(input.notifyOwner !== undefined ? input.notifyOwner : true),
            ...(supportsNotifyUser ? { notifyuser: toSdfFlag(Boolean(input.notifyUser)) } : {}),
            scriptfile: `[${fileCabinetPath}]`
        };
    }

    // Apply header updates
    if (input.name !== undefined) {
        rootObj.name = input.name.trim();
    }
    if (input.description !== undefined) {
        rootObj.description = input.description;
    }
    if (input.isInactive !== undefined) {
        rootObj.isinactive = toSdfFlag(input.isInactive);
    }
    if (input.notifyOwner !== undefined) {
        rootObj.notifyowner = toSdfFlag(input.notifyOwner);
    }
    if (input.notifyUser !== undefined && "notifyuser" in rootObj) {
        rootObj.notifyuser = toSdfFlag(input.notifyUser);
    }
    if (input.notifyEmails !== undefined) {
        rootObj.notifyemails = input.notifyEmails;
    }
    if (fileCabinetPath) {
        rootObj.scriptfile = `[${fileCabinetPath}]`;
    }

    if (scriptTypeKey === "PORTLET") {
        if (input.portletType !== undefined) {
            rootObj.portlettype = input.portletType;
        } else if (!rootObj.portlettype) {
            rootObj.portlettype = "FORM";
        }
    }

    if (scriptTypeKey === "WORKFLOWACTION") {
        if (input.returnType !== undefined) {
            rootObj.returntype = input.returnType.trim().toUpperCase();
        }
        if (input.returnRecordType !== undefined) {
            rootObj.returnrecordtype = getSelectRecordType(input.returnRecordType.trim());
        }
    }

    // SuiteScript 2.x auto-binds exported entry points; only populate function tags for non-2.x scripts
    if (!existingImport && typeMeta.entryPoints.length > 0 && sourceInspection.detectedExports.size > 0) {
        const is2x = !sourceInspection.apiVersion || sourceInspection.apiVersion.startsWith("2.");
        if (!is2x) {
            for (const ep of typeMeta.entryPoints) {
                if (sourceInspection.detectedExports.has(ep.exportName)) {
                    rootObj[ep.sdfTag] = ep.exportName;
                }
            }
        }
    }

    const objectDependencies = new Set<string>();

    // Merge Script Parameters (<scriptcustomfields>)
    if (Array.isArray(input.parameters) && input.parameters.length > 0) {
        const existingParams = ensureArray<Record<string, any>>(
            rootObj.scriptcustomfields?.scriptcustomfield
        );

        for (const paramInput of input.parameters) {
            const normParamId = normalizeScriptParamId(paramInput.scriptId);
            const existingIdx = existingParams.findIndex(
                (p) => String(p?.["@scriptid"] || "").toLowerCase() === normParamId
            );
            const { node: mergedParamNode, objectDependency } = buildOrMergeScriptParameterNode(
                paramInput,
                existingIdx >= 0 ? existingParams[existingIdx] : undefined
            );
            if (objectDependency) {
                objectDependencies.add(objectDependency);
            }
            if (existingIdx >= 0) {
                existingParams[existingIdx] = mergedParamNode;
            } else {
                existingParams.push(mergedParamNode);
            }
        }

        rootObj.scriptcustomfields = {
            scriptcustomfield: existingParams
        };
    }

    // Merge Script Deployments (<scriptdeployments>)
    const existingDeployments = ensureArray<Record<string, any>>(
        rootObj.scriptdeployments?.scriptdeployment
    );
    const defaultDeployId = deriveDefaultDeploymentId(finalScriptId);
    const scriptDisplayName = String(rootObj.name || finalScriptId);

    if (Array.isArray(input.deployments) && input.deployments.length > 0) {
        for (let idx = 0; idx < input.deployments.length; idx++) {
            const depInput = input.deployments[idx];
            let targetDeployId = depInput.scriptId
                ? normalizeCustomDeploymentId(depInput.scriptId)
                : undefined;

            if (!targetDeployId) {
                if (existingDeployments.length === 1 && input.deployments.length === 1) {
                    targetDeployId = String(existingDeployments[0]["@scriptid"] || defaultDeployId);
                } else {
                    targetDeployId =
                        idx === 0
                            ? defaultDeployId
                            : normalizeCustomDeploymentId(`${defaultDeployId}_${idx + 1}`);
                }
            }

            const existingIdx = existingDeployments.findIndex(
                (d) => String(d?.["@scriptid"] || "").toLowerCase() === targetDeployId!.toLowerCase()
            );

            const { node: mergedDepNode, objectDependencies: depObjDeps } =
                buildOrMergeScriptDeploymentNode({
                    scriptType: scriptTypeKey,
                    scriptName: scriptDisplayName,
                    defaultDeployId: targetDeployId,
                    input: { ...depInput, scriptId: targetDeployId },
                    existingNode: existingIdx >= 0 ? existingDeployments[existingIdx] : undefined,
                    accountTimeZone
                });

            for (const d of depObjDeps) {
                objectDependencies.add(d);
            }

            if (existingIdx >= 0) {
                existingDeployments[existingIdx] = mergedDepNode;
            } else {
                existingDeployments.push(mergedDepNode);
            }
        }
    } else if (existingDeployments.length === 0) {
        if (typeMeta.requiresRecordType) {
            throw new Error(
                `Creating a new '${scriptTypeKey}' script requires at least one entry in 'deployments' specifying 'recordType' (e.g., deployments: [{ recordType: "SALESORDER" }]).`
            );
        }

        const { node: defaultDepNode, objectDependencies: depObjDeps } =
            buildOrMergeScriptDeploymentNode({
                scriptType: scriptTypeKey,
                scriptName: scriptDisplayName,
                defaultDeployId,
                input: { scriptId: defaultDeployId },
                accountTimeZone
            });
        for (const d of depObjDeps) {
            objectDependencies.add(d);
        }
        existingDeployments.push(defaultDepNode);
    }

    if (existingDeployments.length > 0) {
        rootObj.scriptdeployments = {
            scriptdeployment: existingDeployments
        };
    }

    const orderedRootObj = orderScriptRootObjectKeys(rootObj);
    for (const depId of collectScriptObjectDependencies(orderedRootObj, finalScriptId)) {
        objectDependencies.add(depId);
    }

    const xmlContent = create(
        { version: "1.0", encoding: "UTF-8" },
        { [rootElement]: orderedRootObj }
    ).end({ prettyPrint: true });

    return {
        rootElement,
        orderedRootObj,
        xmlContent,
        objectDependencies
    };
};
