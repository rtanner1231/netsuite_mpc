/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 * @NModuleScope SameAccount
 *
 * Consolidated MCP Services RESTlet.
 * Provides endpoints for executing SuiteQL queries, retrieving script execution logs,
 * dynamically running SuiteScript functions, and inspecting record samples.
 */
define(["N/config", "N/dataset", "N/file", "N/format", "N/log", "N/query", "N/record", "N/render", "N/runtime", "N/search", "N/translation"], (
  config,
  dataset,
  file,
  format,
  log,
  query,
  record,
  render,
  runtime,
  search,
  translation,
) => {
  // =========================================================================
  // CONSTANTS & ACTION ENUM
  // =========================================================================
  const MCP_ACTION = {
    SCRIPT_LOGS: "SCRIPT_LOGS",
    SCRIPT_LOGS_BY_ID: "SCRIPT_LOGS_BY_ID",
    RUN_SUITE_QL: "RUN_SUITE_QL",
    RUN_FUNCTION: "RUN_FUNCTION",
    RECORD_SAMPLE: "RECORD_SAMPLE",
    UPSERT_RECORD: "UPSERT_RECORD",
    GET_SUPPORTED_LOCALES: "GET_SUPPORTED_LOCALES",
    GET_TRANSLATIONS: "GET_TRANSLATIONS",
    RENDER_PDF_TEMPLATE: "RENDER_PDF_TEMPLATE",
    RENDER_EMAIL_TEMPLATE: "RENDER_EMAIL_TEMPLATE",
    GET_FILE: "GET_FILE",
    VIEW_SAVED_SEARCH: "VIEW_SAVED_SEARCH",
    CREATE_SAVED_SEARCH: "CREATE_SAVED_SEARCH",
    VIEW_DATASET: "VIEW_DATASET",
    CREATE_DATASET: "CREATE_DATASET",
  };

  // =========================================================================
  // UTILITY HELPERS
  // =========================================================================

  /**
   * Execution timer to measure execution duration in milliseconds.
   */
  class ExecutionTimer {
    constructor() {
      this.startTime = Date.now();
    }

    start() {
      this.startTime = Date.now();
    }

    get elapsed() {
      return Date.now() - this.startTime;
    }
  }

  /**
   * Standard error response formatter.
   * @param {string} errorMessage
   * @returns {{ success: false, errorMessage: string }}
   */
  function makeErrorResponse(errorMessage) {
    return {
      success: false,
      errorMessage: String(errorMessage),
    };
  }

  /**
   * Safely normalizes error objects or strings into a standard error string.
   * @param {*} err
   * @returns {string}
   */
  function getErrorMessage(err) {
    if (!err) return "Unknown error";
    if (typeof err === "string") return err;
    if (err.message) return err.message;
    if (err.details) return err.details;
    return String(err);
  }

  /**
   * Formats NetSuite JSON-formatted query errors when available.
   * @param {string} msg
   * @returns {string}
   */
  function extractFieldsFromErrorMessage(msg) {
    try {
      const parsed = typeof msg === "string" ? JSON.parse(msg) : msg;
      const { type, name, message } = parsed;
      if (type && name && message) {
        return `${type}: ${name} - ${message}`;
      }
      return msg;
    } catch {
      return msg;
    }
  }

  /**
   * Synchronously loads a module using NetSuite's AMD require runtime.
   * @param {string} modulePath
   * @returns {*} The exported module object, or null if loading failed.
   */
  function loadModule(modulePath) {
    let loaded = null;
    try {
      require([modulePath], (mod) => {
        loaded = mod;
      });
    } catch (e) {
      log.error({
        title: "loadModule failure",
        details: `Failed to load "${modulePath}": ${getErrorMessage(e)}`,
      });
      return null;
    }
    return loaded;
  }

  /**
   * Converts any script file name to end in .js.
   * @param {string} filename
   * @returns {string}
   */
  function toJsExtension(filename) {
    const lastDotIndex = filename.lastIndexOf(".");
    if (lastDotIndex <= 0) {
      return `${filename}.js`;
    }
    return `${filename.substring(0, lastDotIndex)}.js`;
  }

  /**
   * Maps TypeScript source file paths to their deployed SuiteScripts JavaScript counterparts.
   * @param {string} filePath
   * @returns {string}
   */
  function updateFilePath(filePath) {
    return filePath
      .replace(/TypeScripts/g, "SuiteScripts")
      .replace(/\.ts$/, ".js");
  }

  /**
   * Resolves a target function from an exported module object, supporting dot-notation paths
   * for nested objects (e.g., "__test.func1").
   *
   * @param {Object} mod
   * @param {string} functionPath
   * @returns {{ fn: Function, context: * } | null}
   */
  function resolveTargetFunction(mod, functionPath) {
    if (!mod || !functionPath || typeof functionPath !== "string") {
      return null;
    }

    const parts = functionPath.split(".");
    if (parts.some((part) => !part)) {
      return null;
    }

    let context = mod;
    let target = mod;

    for (const part of parts) {
      if (
        target == null ||
        (typeof target !== "object" && typeof target !== "function")
      ) {
        return null;
      }
      context = target;
      target = target[part];
    }

    if (typeof target !== "function") {
      return null;
    }

    return { fn: target, context: context };
  }

  /**
   * Executes a SuiteQL script-log query and formats the rows into the standard log response.
   *
   * @param {string} sql
   * @param {string} notFoundMessage
   * @returns {Object}
   */
  function queryAndFormatScriptLogs(sql, notFoundMessage) {
    let queryResults;
    try {
      queryResults = query.runSuiteQL({ query: sql }).asMappedResults();
    } catch (e) {
      const errMsg = getErrorMessage(e);
      return makeErrorResponse(`Unable to retrieve logs: ${errMsg}`);
    }

    if (!queryResults || queryResults.length === 0) {
      return makeErrorResponse(notFoundMessage);
    }

    const firstRow = queryResults[0];
    const scriptName = firstRow.script_name || firstRow.scriptName || "";
    const scriptType = firstRow.script_type || firstRow.scriptType || "";

    // Extract and sort logs descending by timestamp
    const logs = [];
    for (const row of queryResults) {
      const timestamp =
        row.full_date_time || row.fulldatetime || row.fullDateTime || null;
      const title = row.title || null;
      const message = row.detail != null ? row.detail : row.message || null;
      const type = row.type || null;

      // Only append when an actual scriptnote row was matched
      if (timestamp || title || message || type) {
        logs.push({
          timestamp: timestamp,
          title: title,
          message: message,
          type: type,
        });
      }
    }

    logs.sort((a, b) => {
      const timeA = a.timestamp
        ? new Date(a.timestamp.replace(" ", "T")).getTime()
        : 0;
      const timeB = b.timestamp
        ? new Date(b.timestamp.replace(" ", "T")).getTime()
        : 0;
      return timeB - timeA;
    });

    return {
      success: true,
      scriptName: scriptName,
      scriptType: scriptType,
      logs: logs,
    };
  }

  // =========================================================================
  // ACTION HANDLERS
  // =========================================================================

  /**
   * ACTION: SCRIPT_LOGS
   * Retrieves the latest 500 execution logs for a script associated with the given file.
   *
   * @param {Object} request
   * @param {string} request.scriptFileName
   * @returns {Object}
   */
  function handleScriptLogs(request) {
    if (!request.scriptFileName || typeof request.scriptFileName !== "string") {
      return makeErrorResponse("No script file name provided");
    }

    const fileName = toJsExtension(request.scriptFileName).replace(/'/g, "''");

    const sql = `
            SELECT
                top 500
                s.name AS script_name,
                s.scripttype AS script_type,
                n.title AS title,
                n.detail AS detail,
                n.type AS type,
                TO_CHAR(n.date, 'YYYY-MM-DD HH24:MI:SS') AS full_date_time
            FROM
                script s
                JOIN file f ON f.id = s.scriptfile
                LEFT JOIN scriptnote n ON n.scripttype = s.id
            WHERE
                f.name = '${fileName}'
            ORDER BY
                n.date DESC
        `;

    return queryAndFormatScriptLogs(sql, "No script found for file");
  }

  /**
   * ACTION: SCRIPT_LOGS_BY_ID
   * Retrieves the latest 500 execution logs for a script and deployment identified by scriptId and deploymentId.
   * Supports both numeric internal/version IDs and custom script/deployment IDs.
   *
   * @param {Object} request
   * @param {string|number} request.scriptId
   * @param {string|number} request.deploymentId
   * @returns {Object}
   */
  function handleScriptLogsById(request) {
    const rawScriptId =
      request.scriptId != null ? String(request.scriptId).trim() : "";
    const rawDeploymentId =
      request.deploymentId != null ? String(request.deploymentId).trim() : "";

    if (!rawScriptId) {
      return makeErrorResponse("No script ID provided");
    }
    if (!rawDeploymentId) {
      return makeErrorResponse("No script deployment ID provided");
    }

    const escapedScriptId = rawScriptId.replace(/'/g, "''");
    const escapedDeploymentId = rawDeploymentId.replace(/'/g, "''");

    const scriptFilter = /^\d+$/.test(rawScriptId)
      ? `s.id = ${Number(rawScriptId)}`
      : `UPPER(s.scriptid) = UPPER('${escapedScriptId}')`;

    const deploymentFilter = /^\d+$/.test(rawDeploymentId)
      ? `(d.version = ${Number(rawDeploymentId)} OR d.primarykey = ${Number(rawDeploymentId)})`
      : `UPPER(d.scriptid) = UPPER('${escapedDeploymentId}')`;

    const sql = `
            SELECT
                top 500
                s.name AS script_name,
                s.scripttype AS script_type,
                n.title AS title,
                n.detail AS detail,
                n.type AS type,
                TO_CHAR(n.date, 'YYYY-MM-DD HH24:MI:SS') AS full_date_time
            FROM
                script s
                JOIN scriptdeployment d ON d.script = s.id
                LEFT JOIN scriptnote n ON n.scripttype = s.id
            WHERE
                ${scriptFilter}
                AND ${deploymentFilter}
            ORDER BY
                n.date DESC
        `;

    return queryAndFormatScriptLogs(
      sql,
      "No script found for script ID and deployment ID",
    );
  }

  /**
   * ACTION: RUN_SUITE_QL
   * Executes arbitrary SuiteQL and returns mapped results along with execution time.
   *
   * @param {Object} request
   * @param {string} request.query
   * @returns {Object}
   */
  function handleRunSuiteQL(request) {
    if (!request.query || typeof request.query !== "string") {
      return makeErrorResponse("No query provided");
    }

    try {
      const timer = new ExecutionTimer();
      const results = query
        .runSuiteQL({ query: request.query })
        .asMappedResults();
      const timeElapsedMS = timer.elapsed;

      return {
        success: true,
        results: results,
        timeElapsedMS: timeElapsedMS,
      };
    } catch (e) {
      const rawMsg = getErrorMessage(e);
      const errMsg = extractFieldsFromErrorMessage(rawMsg);
      return makeErrorResponse(`Query failed with error: \n${errMsg}`);
    }
  }

  /**
   * ACTION: RUN_FUNCTION
   * Loads a SuiteScript module dynamically and executes a targeted exported function.
   *
   * @param {Object} request
   * @param {string} request.filePath
   * @param {string} request.functionName
   * @param {Array}  [request.args]
   * @returns {Object}
   */
  function handleRunFunction(request) {
    if (!request.filePath || typeof request.filePath !== "string") {
      return makeErrorResponse('Missing or invalid "filePath"');
    }
    if (!request.functionName || typeof request.functionName !== "string") {
      return makeErrorResponse('Missing or invalid "functionName"');
    }

    const args = Array.isArray(request.args) ? request.args : [];
    const targetPath = updateFilePath(request.filePath);

    const mod = loadModule(targetPath);
    if (!mod) {
      return makeErrorResponse(`Unable to load module ${targetPath}`);
    }

    const resolved = resolveTargetFunction(mod, request.functionName);
    if (!resolved) {
      return makeErrorResponse(
        `Function ${request.functionName} not found in module ${targetPath}`,
      );
    }

    try {
      const script = runtime.getCurrentScript();
      const startGovernance = script.getRemainingUsage();
      const timer = new ExecutionTimer();
      const result = resolved.fn.apply(resolved.context, args);
      const timeElapsedMS = timer.elapsed;
      const governanceUsed = startGovernance - script.getRemainingUsage();

      return {
        success: true,
        result: result,
        timeElapsedMS: timeElapsedMS,
        governanceUsed: governanceUsed,
      };
    } catch (e) {
      const errMsg = getErrorMessage(e);
      return makeErrorResponse(
        `Error running function ${request.functionName} in module ${targetPath}: ${errMsg}`,
      );
    }
  }

  /**
   * ACTION: RECORD_SAMPLE
   * Loads a record instance in dynamic mode, either by explicit ID or by sampling the latest record.
   *
   * @param {Object} request
   * @param {string} request.recordType
   * @param {string|number} [request.recordId]
   * @returns {Object}
   */
  function handleRecordSample(request) {
    if (!request.recordType || typeof request.recordType !== "string") {
      return makeErrorResponse('Missing or invalid "recordType"');
    }

    const recordType = request.recordType;
    const requestedId =
      request.recordId != null ? String(request.recordId) : null;
    let resolvedId = requestedId;
    const isAutoSampled = !requestedId;

    // Auto-sample: discover the latest internal ID
    if (isAutoSampled) {
      try {
        const latestRecordSearch = search.create({
          type: recordType,
          filters: [],
          columns: [
            search.createColumn({
              name: "internalid",
              sort: search.Sort.DESC,
            }),
          ],
        });

        const searchResult = latestRecordSearch
          .run()
          .getRange({ start: 0, end: 1 });

        if (!searchResult || searchResult.length === 0) {
          return makeErrorResponse(
            `No existing records found for type '${recordType}' to use as a sample.`,
          );
        }

        resolvedId = String(searchResult[0].id);
      } catch (e) {
        const errMsg = getErrorMessage(e);
        return makeErrorResponse(`Unable to load record: ${errMsg}`);
      }
    }

    // Load the record object
    try {
      const recordObj = record.load({
        type: recordType,
        id: resolvedId,
        isDynamic: true,
      });

      return {
        success: true,
        metadata: {
          record_type: recordType,
          requested_id: requestedId,
          resolved_id: resolvedId,
          is_auto_sampled: isAutoSampled,
        },
        recordData: recordObj,
      };
    } catch (e) {
      const errMsg = getErrorMessage(e);
      return makeErrorResponse(`Unable to load record: ${errMsg}`);
    }
  }

  /**
   * Parses an ISO date or datetime string into a JavaScript Date object.
   * Returns null if the string does not match an ISO date format or is invalid.
   *
   * @param {string} str
   * @returns {Date|null}
   */
  function parseIsoDateString(str) {
    if (typeof str !== "string") return null;
    const trimmed = str.trim();

    // Match YYYY-MM-DD using local calendar components to avoid UTC day-shift
    const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
    if (dateOnlyMatch) {
      const year = Number(dateOnlyMatch[1]);
      const monthIndex = Number(dateOnlyMatch[2]) - 1;
      const day = Number(dateOnlyMatch[3]);
      const dateObj = new Date(year, monthIndex, day);
      if (
        !isNaN(dateObj.getTime()) &&
        dateObj.getFullYear() === year &&
        dateObj.getMonth() === monthIndex &&
        dateObj.getDate() === day
      ) {
        return dateObj;
      }
      return null;
    }

    // Match ISO datetime strings (e.g. YYYY-MM-DDTHH:mm:ss...)
    if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(trimmed)) {
      const dateObj = new Date(trimmed);
      if (!isNaN(dateObj.getTime())) {
        return dateObj;
      }
    }

    return null;
  }

  /**
   * Normalizes a field value prior to calling recordObj.setValue, converting
   * ISO date strings to Date instances when the target NetSuite field is a date/datetime field.
   *
   * @param {Object} recordObj
   * @param {string} fieldId
   * @param {*} value
   * @returns {*}
   */
  function normalizeFieldValue(recordObj, fieldId, value) {
    if (typeof value !== "string") {
      return value;
    }

    try {
      const fieldObj = recordObj.getField({ fieldId: fieldId });
      if (fieldObj && fieldObj.type) {
        const fieldType = String(fieldObj.type).toLowerCase();
        if (fieldType === "date" || fieldType === "datetimetz" || fieldType === "datetime") {
          const parsedDate = parseIsoDateString(value);
          if (parsedDate) {
            return parsedDate;
          }
        }
      }
    } catch {
      // Ignore getField lookup errors and fall back to raw value / retry
    }

    return value;
  }

  /**
   * ACTION: UPSERT_RECORD
   * Creates a new NetSuite record or loads an existing one (when id / recordId is provided)
   * in dynamic mode, sets the specified body fields, and saves it.
   *
   * @param {Object} request
   * @param {string} [request.recordType]
   * @param {string} [request.tableId]
   * @param {string|number} [request.id]
   * @param {string|number} [request.recordId]
   * @param {Array<{ fieldId: string, value: * }>} request.fields
   * @returns {Object}
   */
  function handleUpsertRecord(request) {
    const rawRecordType =
      typeof request.recordType === "string" && request.recordType.trim()
        ? request.recordType.trim()
        : typeof request.tableId === "string" && request.tableId.trim()
          ? request.tableId.trim()
          : "";

    if (!rawRecordType) {
      return makeErrorResponse('Missing or invalid "recordType" (or "tableId")');
    }

    const rawId =
      request.id != null && String(request.id).trim() !== ""
        ? String(request.id).trim()
        : request.recordId != null && String(request.recordId).trim() !== ""
          ? String(request.recordId).trim()
          : null;
    const isUpdate = Boolean(rawId);

    if (!Array.isArray(request.fields)) {
      return makeErrorResponse('Missing or invalid "fields": expected an array of { fieldId, value } objects');
    }

    for (let i = 0; i < request.fields.length; i++) {
      const entry = request.fields[i];
      if (
        !entry ||
        typeof entry !== "object" ||
        typeof entry.fieldId !== "string" ||
        !entry.fieldId.trim()
      ) {
        return makeErrorResponse(
          `Invalid field entry at index ${i}: each item must include a non-empty string "fieldId"`,
        );
      }
      if (!Object.prototype.hasOwnProperty.call(entry, "value")) {
        return makeErrorResponse(
          `Invalid field entry for "${entry.fieldId}" at index ${i}: missing "value" property`,
        );
      }
    }

    try {
      const script = runtime.getCurrentScript();
      const startGovernance = script.getRemainingUsage();
      const timer = new ExecutionTimer();

      const recordObj = isUpdate
        ? record.load({
            type: rawRecordType,
            id: rawId,
            isDynamic: true,
          })
        : record.create({
            type: rawRecordType,
            isDynamic: true,
          });

      for (const entry of request.fields) {
        const fieldId = entry.fieldId.trim();
        const normalizedValue = normalizeFieldValue(recordObj, fieldId, entry.value);

        try {
          recordObj.setValue({
            fieldId: fieldId,
            value: normalizedValue,
          });
        } catch (fieldErr) {
          // If a date string failed because getField metadata was unavailable, retry with Date conversion
          if (typeof normalizedValue === "string") {
            const fallbackDate = parseIsoDateString(normalizedValue);
            if (fallbackDate) {
              try {
                recordObj.setValue({
                  fieldId: fieldId,
                  value: fallbackDate,
                });
                continue;
              } catch {
                // Fall through to report original error
              }
            }
          }
          throw new Error(
            `Failed to set field "${fieldId}": ${getErrorMessage(fieldErr)}`,
          );
        }
      }

      const recordId = recordObj.save();
      const timeElapsedMS = timer.elapsed;
      const governanceUsed = startGovernance - script.getRemainingUsage();

      return {
        success: true,
        operation: isUpdate ? "update" : "create",
        recordId: recordId,
        recordType: rawRecordType,
        timeElapsedMS: timeElapsedMS,
        governanceUsed: governanceUsed,
      };
    } catch (e) {
      const errMsg = getErrorMessage(e);
      return makeErrorResponse(
        `Unable to ${isUpdate ? "update" : "create"} record: ${errMsg}`,
      );
    }
  }

  /**
   * Normalizes a locale identifier into both NetSuite format (e.g., "en_US")
   * and SDF/XLIFF format (e.g., "en-US").
   *
   * @param {string} rawLocale
   * @returns {{ netsuiteLocale: string, sdfLocale: string } | null}
   */
  function normalizeLocaleFormats(rawLocale) {
    if (!rawLocale || typeof rawLocale !== "string") return null;
    const trimmed = rawLocale.trim();
    if (!trimmed) return null;

    // Resolve enum keys if passed (e.g., "ENGLISH_US")
    if (translation && translation.Locale && translation.Locale[trimmed]) {
      const enumVal = String(translation.Locale[trimmed]);
      return {
        netsuiteLocale: enumVal.replace(/-/g, "_"),
        sdfLocale: enumVal.replace(/_/g, "-"),
      };
    }

    const parts = trimmed.split(/[-_]/);
    if (parts.length === 2 && parts[0].length >= 2 && parts[1].length >= 2) {
      const lang = parts[0].toLowerCase();
      const region = parts[1].toUpperCase();
      return {
        netsuiteLocale: `${lang}_${region}`,
        sdfLocale: `${lang}-${region}`,
      };
    }

    return {
      netsuiteLocale: trimmed.replace(/-/g, "_"),
      sdfLocale: trimmed.replace(/_/g, "-"),
    };
  }

  /**
   * Discovers the active/configured languages in the NetSuite environment.
   *
   * @returns {{ defaultLocale: string | null, locales: Array<{ sdfLocale: string, netsuiteLocale: string, name?: string, isDefault: boolean, source: string }> }}
   */
  function discoverSupportedLocales() {
    let defaultNetsuiteLocale = null;

    try {
      const currentUser = runtime.getCurrentUser();
      const userLang = currentUser.getPreference({ name: "LANGUAGE" });
      if (userLang) {
        const norm = normalizeLocaleFormats(String(userLang));
        if (norm) defaultNetsuiteLocale = norm.netsuiteLocale;
      }
    } catch {
      // Ignore runtime preference lookup errors
    }

    try {
      if (config && config.load && config.Type && config.Type.COMPANY_PREFERENCES) {
        const compPrefs = config.load({
          type: config.Type.COMPANY_PREFERENCES,
        });
        if (compPrefs) {
          const compLang = compPrefs.getValue({ fieldId: "LOCALE" }) || compPrefs.getValue({ fieldId: "LANGUAGE" });
          if (compLang) {
            const norm = normalizeLocaleFormats(String(compLang));
            if (norm) defaultNetsuiteLocale = norm.netsuiteLocale;
          }
        }
      }
    } catch {
      // Ignore if role lacks Set Up Company permission
    }

    const localeMap = {};

    const addLocaleEntry = (rawLocale, name, source, isDefaultOverride) => {
      const norm = normalizeLocaleFormats(rawLocale);
      if (!norm) return;
      const key = norm.sdfLocale;
      const isDef =
        Boolean(isDefaultOverride) ||
        (defaultNetsuiteLocale != null && norm.netsuiteLocale === defaultNetsuiteLocale);

      if (!localeMap[key]) {
        localeMap[key] = {
          sdfLocale: norm.sdfLocale,
          netsuiteLocale: norm.netsuiteLocale,
          name: name || norm.sdfLocale,
          isDefault: isDef,
          source: source,
        };
      } else {
        if (name && localeMap[key].name === localeMap[key].sdfLocale) {
          localeMap[key].name = name;
        }
        if (isDef) {
          localeMap[key].isDefault = true;
        }
      }
    };

    // 1. Query enabled languages from NetSuite's Setup > Company > General Preferences > Languages.
    // In SuiteQL:
    // - companypreference (preference = 'LANGUAGE') stores the company default locale (e.g. 'en_US').
    // - websitelanguage contains the exact set of languages enabled under General Preferences > Languages.
    // - companypreference (preference = 'TRANSLATION_LANGUAGES') stores the \u0005-delimited language keys.
    // - language (key, descr, deflocale, inactive) maps language keys/locales to their display names.
    const languageByLocale = {};
    const languageByKey = {};

    try {
      const langRows = query
        .runSuiteQL({
          query: "SELECT key, descr, deflocale, inactive FROM language",
        })
        .asMappedResults();

      if (Array.isArray(langRows)) {
        for (const r of langRows) {
          const defLoc = r.deflocale ? String(r.deflocale).trim() : "";
          const langKey = r.key ? String(r.key).trim() : "";
          const descr = r.descr ? String(r.descr).trim() : "";
          const normKey = langKey.replace(/_/g, " ").toUpperCase();

          const info = {
            key: langKey,
            descr: descr,
            deflocale: defLoc,
            inactive: r.inactive,
          };

          if (defLoc) {
            languageByLocale[defLoc] = info;
            const norm = normalizeLocaleFormats(defLoc);
            if (norm) {
              languageByLocale[norm.netsuiteLocale] = info;
              languageByLocale[norm.sdfLocale] = info;
            }
          }
          if (normKey) {
            languageByKey[normKey] = info;
          }
        }
      }
    } catch {
      // Ignore if language table is unavailable
    }

    // 1a. Check companypreference for LANGUAGE (company default) and TRANSLATION_LANGUAGES
    let translationLanguageKeys = [];
    try {
      const prefRows = query
        .runSuiteQL({
          query:
            "SELECT preference, value FROM companypreference WHERE preference IN ('LANGUAGE', 'TRANSLATION_LANGUAGES')",
        })
        .asMappedResults();

      if (Array.isArray(prefRows)) {
        for (const row of prefRows) {
          const prefName = row.preference ? String(row.preference).trim() : "";
          const prefVal = row.value != null ? String(row.value).trim() : "";
          if (prefName === "LANGUAGE" && prefVal) {
            const norm = normalizeLocaleFormats(prefVal);
            if (norm) defaultNetsuiteLocale = norm.netsuiteLocale;
          } else if (prefName === "TRANSLATION_LANGUAGES" && prefVal) {
            translationLanguageKeys = prefVal
              .split(/\u0005|,/)
              .map((s) => s.trim())
              .filter(Boolean);
          }
        }
      }
    } catch {
      // Ignore if companypreference table is unavailable
    }

    // 1b. Query websitelanguage (which reflects all languages listed under General Preferences > Languages)
    try {
      const wsRows = query
        .runSuiteQL({
          query:
            "SELECT DISTINCT locale, languagename FROM websitelanguage WHERE locale IS NOT NULL ORDER BY locale",
        })
        .asMappedResults();

      if (Array.isArray(wsRows) && wsRows.length > 0) {
        for (const row of wsRows) {
          const rawLoc = row.locale ? String(row.locale).trim() : "";
          if (!rawLoc) continue;
          const langInfo = languageByLocale[rawLoc];
          const displayName =
            (langInfo && langInfo.descr) ||
            (row.languagename ? String(row.languagename).trim() : undefined);
          addLocaleEntry(rawLoc, displayName, "general_preferences");
        }
      }
    } catch {
      // Ignore if websitelanguage is unavailable
    }

    // 1c. Also include any languages from companypreference TRANSLATION_LANGUAGES and language where inactive = 'T'
    for (const rawKey of translationLanguageKeys) {
      const normKey = rawKey.replace(/_/g, " ").toUpperCase();
      const langInfo = languageByKey[normKey];
      if (langInfo && langInfo.deflocale) {
        addLocaleEntry(langInfo.deflocale, langInfo.descr, "company_preferences");
      }
    }

    for (const locKey of Object.keys(languageByLocale)) {
      const langInfo = languageByLocale[locKey];
      if (langInfo && langInfo.inactive === "T" && langInfo.deflocale) {
        addLocaleEntry(langInfo.deflocale, langInfo.descr, "general_preferences");
      }
    }

    // 2. Also inspect N/config COMPANY_PREFERENCES sublists if accessible
    try {
      if (config && config.load && config.Type && config.Type.COMPANY_PREFERENCES) {
        const compPrefs = config.load({
          type: config.Type.COMPANY_PREFERENCES,
        });
        if (compPrefs && typeof compPrefs.getLineCount === "function") {
          const sublists = ["languages", "language", "systemlanguages", "tranlanguages"];
          for (const sublistId of sublists) {
            const lineCount = compPrefs.getLineCount({ sublistId: sublistId });
            if (lineCount > 0) {
              for (let i = 0; i < lineCount; i++) {
                const rawLoc =
                  compPrefs.getSublistValue({ sublistId: sublistId, fieldId: "locale", line: i }) ||
                  compPrefs.getSublistValue({ sublistId: sublistId, fieldId: "language", line: i }) ||
                  compPrefs.getSublistValue({ sublistId: sublistId, fieldId: "id", line: i });
                const rawName =
                  compPrefs.getSublistText({ sublistId: sublistId, fieldId: "locale", line: i }) ||
                  compPrefs.getSublistText({ sublistId: sublistId, fieldId: "language", line: i }) ||
                  null;
                if (rawLoc) {
                  addLocaleEntry(String(rawLoc), rawName ? String(rawName) : undefined, "company_preferences");
                }
              }
              break;
            }
          }
        }
      }
    } catch {
      // Ignore sublist inspection errors
    }

    // 3. Always ensure the default locale is included if known
    if (defaultNetsuiteLocale) {
      const defInfo = languageByLocale[defaultNetsuiteLocale];
      addLocaleEntry(
        defaultNetsuiteLocale,
        defInfo ? defInfo.descr : undefined,
        "account_default",
        true,
      );
    }

    let localesList = Object.keys(localeMap).map((k) => localeMap[k]);

    // 4. If neither company preferences nor SuiteQL returned the account's active languages,
    // return the N/translation.Locale enum values so the caller still has valid NetSuite locale codes
    let allStandardLocales = [];
    if (translation && translation.Locale) {
      allStandardLocales = Object.keys(translation.Locale).map((enumKey) => {
        const val = String(translation.Locale[enumKey]);
        const norm = normalizeLocaleFormats(val);
        return {
          enumKey: enumKey,
          sdfLocale: norm ? norm.sdfLocale : val.replace(/_/g, "-"),
          netsuiteLocale: norm ? norm.netsuiteLocale : val,
          isDefault: defaultNetsuiteLocale != null && norm != null && norm.netsuiteLocale === defaultNetsuiteLocale,
        };
      });
    }

    return {
      defaultLocale: defaultNetsuiteLocale ? defaultNetsuiteLocale.replace(/_/g, "-") : null,
      locales: localesList,
      standardLocales: allStandardLocales,
    };
  }

  /**
   * ACTION: GET_SUPPORTED_LOCALES
   * Returns active languages configured in the NetSuite environment along with standard N/translation locales.
   *
   * @returns {Object}
   */
  function handleGetSupportedLocales() {
    try {
      const timer = new ExecutionTimer();
      const discovered = discoverSupportedLocales();
      return {
        success: true,
        defaultLocale: discovered.defaultLocale,
        activeLocales: discovered.locales,
        standardLocales: discovered.standardLocales,
        timeElapsedMS: timer.elapsed,
      };
    } catch (e) {
      return makeErrorResponse(`Unable to discover supported locales: ${getErrorMessage(e)}`);
    }
  }

  /**
   * ACTION: GET_TRANSLATIONS
   * Uses N/translation to load translated strings for a translation collection across requested or active locales.
   * For non-default locales where N/translation falls back to the default string (meaning no translation is entered
   * for that locale), returns "" (empty string) to accurately reflect the state of the translation string.
   *
   * @param {Object} request
   * @param {string} request.collectionId
   * @param {Array<string>} request.keys
   * @param {Array<string>} [request.locales]
   * @param {string} [request.defaultLocale]
   * @returns {Object}
   */
  function handleGetTranslations(request) {
    const collectionId =
      typeof request.collectionId === "string" ? request.collectionId.trim() : "";
    if (!collectionId) {
      return makeErrorResponse('Missing or invalid "collectionId"');
    }

    const keys = Array.isArray(request.keys)
      ? request.keys.filter((k) => typeof k === "string" && k.trim() !== "").map((k) => k.trim())
      : [];

    if (keys.length === 0) {
      return {
        success: true,
        collectionId: collectionId,
        localesChecked: [],
        translations: {},
      };
    }

    try {
      const timer = new ExecutionTimer();
      const discovered = discoverSupportedLocales();

      let defaultNorm = request.defaultLocale
        ? normalizeLocaleFormats(String(request.defaultLocale))
        : discovered.defaultLocale
          ? normalizeLocaleFormats(String(discovered.defaultLocale))
          : null;

      let targetLocaleNorms = [];
      const explicitLocalesProvided = Array.isArray(request.locales) && request.locales.length > 0;

      if (explicitLocalesProvided) {
        for (const rawLoc of request.locales) {
          const norm = normalizeLocaleFormats(String(rawLoc));
          if (norm) targetLocaleNorms.push(norm);
        }
      } else {
        if (discovered.locales && discovered.locales.length > 0) {
          targetLocaleNorms = discovered.locales.map((l) => ({
            sdfLocale: l.sdfLocale,
            netsuiteLocale: l.netsuiteLocale,
          }));
        } else if (discovered.standardLocales && discovered.standardLocales.length > 0) {
          targetLocaleNorms = discovered.standardLocales.map((l) => ({
            sdfLocale: l.sdfLocale,
            netsuiteLocale: l.netsuiteLocale,
          }));
        }
      }

      if (!defaultNorm && targetLocaleNorms.length > 0) {
        defaultNorm = targetLocaleNorms[0];
      }

      // Deduplicate target locales by sdfLocale
      const uniqueLocales = [];
      const seen = {};
      for (const loc of targetLocaleNorms) {
        if (!seen[loc.sdfLocale]) {
          seen[loc.sdfLocale] = true;
          uniqueLocales.push(loc);
        }
      }

      // If no target locales were resolved, use defaultNorm if available
      if (uniqueLocales.length === 0 && defaultNorm) {
        uniqueLocales.push(defaultNorm);
      }

      // Initialize result map: translations[key][sdfLocale] = value
      const translationsByKey = {};
      for (const k of keys) {
        translationsByKey[k] = {};
      }

      if (uniqueLocales.length === 0) {
        return {
          success: true,
          collectionId: collectionId,
          localesChecked: [],
          translations: translationsByKey,
          timeElapsedMS: timer.elapsed,
        };
      }

      // Helper to resolve a key function on a loaded collection handle (supporting case-insensitive key match)
      const invokeHandleKey = (colObj, keyName) => {
        if (!colObj) return null;
        if (typeof colObj[keyName] === "function") {
          return colObj[keyName]();
        }
        const upper = keyName.toUpperCase();
        if (typeof colObj[upper] === "function") {
          return colObj[upper]();
        }
        const lower = keyName.toLowerCase();
        if (typeof colObj[lower] === "function") {
          return colObj[lower]();
        }
        return null;
      };

      // Chunk keys in batches of 1000 (N/translation.load has a 1000-key limit per call)
      const KEY_BATCH_SIZE = 1000;
      const keyBatches = [];
      for (let i = 0; i < keys.length; i += KEY_BATCH_SIZE) {
        keyBatches.push(keys.slice(i, i + KEY_BATCH_SIZE));
      }

      // 1. Load baseline (default locale) values across all key batches so we can detect
      // when a non-default locale falls back to the default string (untranslated -> "")
      const baselineLocale = (defaultNorm || uniqueLocales[0]).netsuiteLocale;
      const baselineValues = {};

      for (let b = 0; b < keyBatches.length; b++) {
        const batchKeys = keyBatches[b];
        const baseHandle = translation.load({
          collections: [
            {
              alias: "col",
              collection: collectionId,
              keys: batchKeys,
            },
          ],
          locales: [baselineLocale],
        });

        for (const k of batchKeys) {
          try {
            const val = invokeHandleKey(baseHandle && baseHandle.col, k);
            baselineValues[k] = val != null ? String(val) : null;
          } catch {
            baselineValues[k] = null;
          }
        }
      }

      // 2. N/translation.load only loads the locales passed in its `locales` array (max 5 locales per call),
      // and translation.selectLocale only works for locales that were loaded in that handle!
      // Therefore, chunk uniqueLocales into batches of 5.
      const LOCALE_BATCH_SIZE = 5;
      const localeBatches = [];
      for (let i = 0; i < uniqueLocales.length; i += LOCALE_BATCH_SIZE) {
        localeBatches.push(uniqueLocales.slice(i, i + LOCALE_BATCH_SIZE));
      }

      const checkedLocalesSet = {};
      const localesChecked = [];

      for (let lb = 0; lb < localeBatches.length; lb++) {
        const locBatch = localeBatches[lb];
        const nsLocalesInBatch = locBatch.map((l) => l.netsuiteLocale);

        for (let kb = 0; kb < keyBatches.length; kb++) {
          const batchKeys = keyBatches[kb];
          let batchHandle = null;

          try {
            batchHandle = translation.load({
              collections: [
                {
                  alias: "col",
                  collection: collectionId,
                  keys: batchKeys,
                },
              ],
              locales: nsLocalesInBatch,
            });
          } catch {
            // If one of the locales in the batch of 5 is rejected by N/translation.load,
            // fall back to loading each locale in this batch individually
            batchHandle = null;
          }

          for (let li = 0; li < locBatch.length; li++) {
            const loc = locBatch[li];
            const isDefaultLoc =
              defaultNorm != null && loc.sdfLocale === defaultNorm.sdfLocale;

            let localeHandle = null;
            try {
              if (batchHandle) {
                localeHandle =
                  li === 0
                    ? batchHandle
                    : translation.selectLocale({
                        handle: batchHandle,
                        locale: loc.netsuiteLocale,
                      });
              } else {
                localeHandle = translation.load({
                  collections: [
                    {
                      alias: "col",
                      collection: collectionId,
                      keys: batchKeys,
                    },
                  ],
                  locales: [loc.netsuiteLocale],
                });
              }
            } catch {
              // Skip unsupported locale
              continue;
            }

            if (!localeHandle || !localeHandle.col) continue;

            if (!checkedLocalesSet[loc.sdfLocale]) {
              checkedLocalesSet[loc.sdfLocale] = true;
              localesChecked.push(loc.sdfLocale);
            }

            for (const k of batchKeys) {
              try {
                const rawVal = invokeHandleKey(localeHandle.col, k);
                const strVal = rawVal != null ? String(rawVal) : "";

                if (isDefaultLoc) {
                  translationsByKey[k][loc.sdfLocale] = strVal;
                } else {
                  // In N/translation, if a locale has no translation entered, it falls back
                  // to returning the default locale's string. Report "" in that case.
                  const baseVal = baselineValues[k];
                  if (baseVal != null && strVal === baseVal) {
                    translationsByKey[k][loc.sdfLocale] = "";
                  } else {
                    translationsByKey[k][loc.sdfLocale] = strVal;
                  }
                }
              } catch {
                translationsByKey[k][loc.sdfLocale] = "";
              }
            }
          }
        }
      }

      return {
        success: true,
        collectionId: collectionId,
        defaultLocale: defaultNorm ? defaultNorm.sdfLocale : null,
        localesChecked: localesChecked,
        translations: translationsByKey,
        timeElapsedMS: timer.elapsed,
      };
    } catch (e) {
      return makeErrorResponse(`Unable to load translations for "${collectionId}": ${getErrorMessage(e)}`);
    }
  }

  /**
   * Resolves a record ID for a given recordType: uses requestedId if provided,
   * otherwise searches for the most recently created record of that type.
   *
   * @param {string} recordType
   * @param {string|number|null} [requestedId]
   * @returns {{ resolvedId: number, isAutoSampled: boolean }}
   */
  function resolveOrAutoSampleRecordId(recordType, requestedId) {
    if (requestedId != null && String(requestedId).trim() !== "") {
      const numId = Number(String(requestedId).trim());
      if (isNaN(numId) || numId <= 0) {
        throw new Error(`Invalid record ID "${requestedId}" for recordType "${recordType}": must be a positive numeric internal ID.`);
      }
      return {
        resolvedId: numId,
        isAutoSampled: false,
      };
    }

    const latestRecordSearch = search.create({
      type: recordType,
      filters: [],
      columns: [
        search.createColumn({
          name: "internalid",
          sort: search.Sort.DESC,
        }),
      ],
    });

    const searchResult = latestRecordSearch.run().getRange({ start: 0, end: 1 });
    if (!searchResult || searchResult.length === 0) {
      throw new Error(`No existing records found for type "${recordType}" to use as a sample.`);
    }

    return {
      resolvedId: Number(searchResult[0].id),
      isAutoSampled: true,
    };
  }

  /**
   * ACTION: RENDER_PDF_TEMPLATE
   * Uses N/render to render an Advanced PDF/HTML Template (by scriptId or inline pdfContent)
   * against a record (explicit or auto-sampled), saved search, and/or custom data sources,
   * returning the base64-encoded PDF binary and optional evaluated BFO XML string.
   *
   * @param {Object} request
   * @param {string} [request.scriptId]
   * @param {string} [request.pdfContent]
   * @param {string} [request.recordType]
   * @param {string|number} [request.recordId]
   * @param {string} [request.searchId]
   * @param {Object} [request.customData]
   * @param {boolean} [request.returnEvaluatedXml]
   * @returns {Object}
   */
  function handleRenderPdfTemplate(request) {
    const rawScriptId =
      typeof request.scriptId === "string" ? request.scriptId.trim() : "";
    const rawPdfContent =
      typeof request.pdfContent === "string" ? request.pdfContent.trim() : "";

    if (!rawScriptId && !rawPdfContent) {
      return makeErrorResponse('Either "scriptId" or "pdfContent" is required to render an Advanced PDF Template.');
    }

    try {
      const script = runtime.getCurrentScript();
      const startGovernance = script.getRemainingUsage();
      const timer = new ExecutionTimer();

      const renderer = render.create();

      // 1. Set template source: inline pdfContent (if provided) or deployed scriptId
      if (rawPdfContent) {
        renderer.templateContent = request.pdfContent;
      } else {
        renderer.setTemplateByScriptId({
          scriptId: rawScriptId.toUpperCase(),
        });
      }

      // 2. Bind record if recordType is specified
      let resolvedRecordId = null;
      let isAutoSampled = false;
      const recordType =
        typeof request.recordType === "string" && request.recordType.trim()
          ? request.recordType.trim()
          : null;

      if (recordType) {
        const sampleInfo = resolveOrAutoSampleRecordId(recordType, request.recordId);
        resolvedRecordId = sampleInfo.resolvedId;
        isAutoSampled = sampleInfo.isAutoSampled;

        const recordObj = record.load({
          type: recordType,
          id: resolvedRecordId,
          isDynamic: false,
        });

        renderer.addRecord({
          templateName: "record",
          record: recordObj,
        });
      }

      // 3. Bind saved search results if searchId is specified
      const searchId =
        typeof request.searchId === "string" && request.searchId.trim()
          ? request.searchId.trim()
          : null;

      if (searchId) {
        const searchObj = search.load({ id: searchId });
        renderer.addSearchResults({
          templateName: "results",
          searchResult: searchObj.run(),
        });
      }

      // 4. Bind any custom data sources (customData: { [alias]: object })
      if (
        request.customData &&
        typeof request.customData === "object" &&
        !Array.isArray(request.customData)
      ) {
        for (const alias of Object.keys(request.customData)) {
          const dataVal = request.customData[alias];
          if (dataVal && typeof dataVal === "object") {
            renderer.addCustomDataSource({
              alias: alias,
              format: render.DataSource.OBJECT,
              data: dataVal,
            });
          }
        }
      }

      // 5. Evaluate FreeMarker if requested or needed for BFO error diagnostics
      let evaluatedXml = null;
      if (request.returnEvaluatedXml) {
        evaluatedXml = renderer.renderAsString();
      }

      // 6. Render as PDF binary
      let pdfBase64;
      try {
        const pdfFile = renderer.renderAsPdf();
        pdfBase64 = pdfFile.getContents();
      } catch (renderErr) {
        // Attempt to capture the FreeMarker-evaluated XML so the agent can see the exact BFO error context
        if (evaluatedXml === null) {
          try {
            evaluatedXml = renderer.renderAsString();
          } catch {
            // Ignore if FreeMarker evaluation itself failed
          }
        }
        const errMsg = getErrorMessage(renderErr);
        return {
          success: false,
          errorMessage: `PDF rendering failed: ${errMsg}`,
          ...(evaluatedXml ? { evaluatedXml: evaluatedXml } : {}),
        };
      }

      const timeElapsedMS = timer.elapsed;
      const governanceUsed = startGovernance - script.getRemainingUsage();

      return {
        success: true,
        scriptId: rawScriptId || null,
        usedInlinePdfContent: Boolean(rawPdfContent),
        recordType: recordType,
        resolvedRecordId: resolvedRecordId,
        isAutoSampled: isAutoSampled,
        searchId: searchId,
        pdfBase64: pdfBase64,
        ...(evaluatedXml !== null ? { evaluatedXml: evaluatedXml } : {}),
        timeElapsedMS: timeElapsedMS,
        governanceUsed: governanceUsed,
      };
    } catch (e) {
      return makeErrorResponse(`Unable to render Advanced PDF Template: ${getErrorMessage(e)}`);
    }
  }

  /**
   * ACTION: RENDER_EMAIL_TEMPLATE
   * Uses N/render.mergeEmail to render an Email Template (custemailtmpl_*) with optional
   * transaction, entity, recipient, customRecord, or supportCase records, returning the merged subject and HTML body.
   *
   * @param {Object} request
   * @param {string} [request.scriptId]
   * @param {number|string} [request.templateId]
   * @param {number|string} [request.transactionId]
   * @param {string} [request.transactionType]
   * @param {string} [request.entityType]
   * @param {number|string} [request.entityId]
   * @param {string} [request.recipientType]
   * @param {number|string} [request.recipientId]
   * @param {string} [request.customRecordType]
   * @param {number|string} [request.customRecordId]
   * @param {number|string} [request.supportCaseId]
   * @returns {Object}
   */
  function handleRenderEmailTemplate(request) {
    const rawScriptId =
      typeof request.scriptId === "string" ? request.scriptId.trim() : "";
    const rawTemplateId =
      request.templateId != null && String(request.templateId).trim() !== ""
        ? String(request.templateId).trim()
        : "";

    if (!rawScriptId && !rawTemplateId) {
      return makeErrorResponse('Either "scriptId" (e.g., "custemailtmpl_...") or numeric "templateId" is required.');
    }

    try {
      const script = runtime.getCurrentScript();
      const startGovernance = script.getRemainingUsage();
      const timer = new ExecutionTimer();

      let resolvedTemplateId = null;
      let templateName = null;

      if (rawTemplateId && /^\d+$/.test(rawTemplateId)) {
        resolvedTemplateId = Number(rawTemplateId);
      } else {
        const lookupScriptId = (rawScriptId || rawTemplateId).replace(/'/g, "''");
        const sql = `SELECT id, name FROM emailtemplate WHERE UPPER(scriptid) = UPPER('${lookupScriptId}')`;
        const rows = query.runSuiteQL({ query: sql }).asMappedResults();
        if (!rows || rows.length === 0) {
          return makeErrorResponse(
            `Email Template with scriptId "${rawScriptId || rawTemplateId}" was not found in NetSuite.`,
          );
        }
        resolvedTemplateId = Number(rows[0].id);
        templateName = rows[0].name || null;
      }

      const mergeOptions = {
        templateId: resolvedTemplateId,
      };

      const boundRecords = {};

      // 1. Transaction binding (explicit transactionId, or auto-sampled via transactionType)
      if (request.transactionId != null && String(request.transactionId).trim() !== "") {
        const txId = Number(String(request.transactionId).trim());
        if (isNaN(txId) || txId <= 0) {
          return makeErrorResponse(`Invalid "transactionId": "${request.transactionId}". Must be a positive integer.`);
        }
        mergeOptions.transactionId = txId;
        boundRecords.transaction = { id: txId, isAutoSampled: false };
      } else if (typeof request.transactionType === "string" && request.transactionType.trim() !== "") {
        const txType = request.transactionType.trim();
        const sampled = resolveOrAutoSampleRecordId(txType, null);
        mergeOptions.transactionId = sampled.resolvedId;
        boundRecords.transaction = {
          type: txType,
          id: sampled.resolvedId,
          isAutoSampled: true,
        };
      }

      // 2. Entity binding
      if (typeof request.entityType === "string" && request.entityType.trim() !== "") {
        const entType = request.entityType.trim();
        const entSample = resolveOrAutoSampleRecordId(entType, request.entityId);
        mergeOptions.entity = {
          type: entType,
          id: entSample.resolvedId,
        };
        boundRecords.entity = {
          type: entType,
          id: entSample.resolvedId,
          isAutoSampled: entSample.isAutoSampled,
        };
      }

      // 3. Recipient binding
      if (typeof request.recipientType === "string" && request.recipientType.trim() !== "") {
        const recType = request.recipientType.trim();
        const recSample = resolveOrAutoSampleRecordId(recType, request.recipientId);
        mergeOptions.recipient = {
          type: recType,
          id: recSample.resolvedId,
        };
        boundRecords.recipient = {
          type: recType,
          id: recSample.resolvedId,
          isAutoSampled: recSample.isAutoSampled,
        };
      }

      // 4. Custom Record binding
      if (typeof request.customRecordType === "string" && request.customRecordType.trim() !== "") {
        const crType = request.customRecordType.trim();
        const crSample = resolveOrAutoSampleRecordId(crType, request.customRecordId);
        mergeOptions.customRecord = {
          type: crType,
          id: crSample.resolvedId,
        };
        boundRecords.customRecord = {
          type: crType,
          id: crSample.resolvedId,
          isAutoSampled: crSample.isAutoSampled,
        };
      }

      // 5. Support Case binding
      if (request.supportCaseId != null && String(request.supportCaseId).trim() !== "") {
        const caseId = Number(String(request.supportCaseId).trim());
        if (isNaN(caseId) || caseId <= 0) {
          return makeErrorResponse(`Invalid "supportCaseId": "${request.supportCaseId}". Must be a positive integer.`);
        }
        mergeOptions.supportCaseId = caseId;
        boundRecords.supportCase = { id: caseId, isAutoSampled: false };
      }

      const mergeResult = render.mergeEmail(mergeOptions);
      const subject = mergeResult ? mergeResult.subject : "";
      const body = mergeResult ? mergeResult.body : "";

      const timeElapsedMS = timer.elapsed;
      const governanceUsed = startGovernance - script.getRemainingUsage();

      return {
        success: true,
        scriptId: rawScriptId || null,
        templateId: resolvedTemplateId,
        ...(templateName ? { templateName: templateName } : {}),
        boundRecords: boundRecords,
        subject: subject,
        body: body,
        timeElapsedMS: timeElapsedMS,
        governanceUsed: governanceUsed,
      };
    } catch (e) {
      return makeErrorResponse(`Unable to render Email Template: ${getErrorMessage(e)}`);
    }
  }

  /**
   * Standard NetSuite File Cabinet root folders (which have negative internal IDs in NetSuite).
   */
  const SYSTEM_ROOT_FOLDERS = {
    "-15": { name: "SuiteScripts", parent: null },
    "-16": { name: "SuiteBundles", parent: null },
    "-10": { name: "Templates", parent: null },
    "-11": { name: "Letter Templates", parent: -10 },
    "-12": { name: "E-mail Templates", parent: -10 },
    "-13": { name: "Fax Templates", parent: -10 },
    "-14": { name: "Marketing Templates", parent: -10 },
    "-100": { name: "Web Site Hosting Files", parent: null },
    "-101": { name: "Live Hosting Files", parent: -100 },
    "-102": { name: "Staging Hosting Files", parent: -100 },
    "-6": { name: "Images", parent: null },
    "-4": { name: "Attachments Received", parent: null },
    "-5": { name: "Attachments Sent", parent: null },
    "-9": { name: "SuiteApps", parent: null },
  };

  /**
   * Resolves full File Cabinet paths (e.g. "/SuiteScripts/sub/foo.js") for an array of
   * { id, name, folder } objects by walking mediaitemfolder parent links via SuiteQL.
   *
   * @param {Array<{ id: number, name: string, folder: number|null }>} fileEntries
   * @returns {Object} Map of fileId -> resolved File Cabinet path
   */
  function resolveFileCabinetPathsByEntries(fileEntries) {
    const resultMap = {};
    if (!Array.isArray(fileEntries) || fileEntries.length === 0) {
      return resultMap;
    }

    const folderMap = {};
    for (const sysId of Object.keys(SYSTEM_ROOT_FOLDERS)) {
      folderMap[Number(sysId)] = {
        name: SYSTEM_ROOT_FOLDERS[sysId].name,
        parent: SYSTEM_ROOT_FOLDERS[sysId].parent,
      };
    }

    const foldersToFetch = {};
    for (const entry of fileEntries) {
      const folderId =
        entry.folder != null && Number(entry.folder) !== 0 && !isNaN(Number(entry.folder))
          ? Number(entry.folder)
          : null;
      if (folderId !== null && !folderMap[folderId]) {
        foldersToFetch[folderId] = true;
      }
    }

    let currentBatch = Object.keys(foldersToFetch).map(Number);
    let depth = 0;

    try {
      while (currentBatch.length > 0 && depth < 12) {
        depth++;
        const folderRows = query
          .runSuiteQL({
            query: `SELECT id, name, parent FROM mediaitemfolder WHERE id IN (${currentBatch.join(", ")})`,
          })
          .asMappedResults();

        const nextBatchMap = {};
        if (Array.isArray(folderRows)) {
          for (const fr of folderRows) {
            const fId = Number(fr.id);
            const fName = String(fr.name || "");
            const fParent =
              fr.parent != null && Number(fr.parent) !== 0 && !isNaN(Number(fr.parent))
                ? Number(fr.parent)
                : null;
            folderMap[fId] = { name: fName, parent: fParent };
            if (fParent !== null && !folderMap[fParent]) {
              nextBatchMap[fParent] = true;
            }
          }
        }
        currentBatch = Object.keys(nextBatchMap).map(Number);
      }
    } catch {
      // Ignore if mediaitemfolder is not accessible for the current role
    }

    for (const entry of fileEntries) {
      const segments = [String(entry.name || "")];
      let currFolder =
        entry.folder != null && Number(entry.folder) !== 0 && !isNaN(Number(entry.folder))
          ? Number(entry.folder)
          : null;
      let guard = 0;
      while (currFolder !== null && folderMap[currFolder] && guard < 15) {
        guard++;
        const fNode = folderMap[currFolder];
        segments.unshift(fNode.name);
        currFolder = fNode.parent;
      }
      resultMap[Number(entry.id)] = "/" + segments.filter(Boolean).join("/");
    }

    return resultMap;
  }

  /**
   * ACTION: GET_FILE
   * Loads a file from the NetSuite File Cabinet by internal ID (`fileId`) or File Cabinet path / file name (`filePath`),
   * returning file metadata and contents (plain text when `fileObj.isText` is true, or base64 when `fileObj.isText` is false).
   *
   * @param {Object} request
   * @param {number|string} [request.fileId]
   * @param {string} [request.filePath]
   * @returns {Object}
   */
  function handleGetFile(request) {
    const rawFileId =
      request.fileId != null && String(request.fileId).trim() !== ""
        ? String(request.fileId).trim()
        : "";
    let rawFilePath =
      typeof request.filePath === "string" && request.filePath.trim() !== ""
        ? request.filePath.trim()
        : "";

    if (!rawFileId && !rawFilePath) {
      return makeErrorResponse('Either "fileId" or "filePath" is required to load a File Cabinet file.');
    }

    try {
      const script = runtime.getCurrentScript();
      const startGovernance = script.getRemainingUsage();
      const timer = new ExecutionTimer();

      let fileObj = null;
      let loadError = null;

      // 1. If a numeric fileId is provided (or filePath itself is purely numeric when fileId is omitted)
      const numericIdStr =
        rawFileId && /^\d+$/.test(rawFileId)
          ? rawFileId
          : !rawFileId && /^\d+$/.test(rawFilePath)
            ? rawFilePath
            : "";

      if (numericIdStr) {
        try {
          fileObj = file.load({ id: Number(numericIdStr) });
        } catch (err) {
          return makeErrorResponse(
            `Unable to load File Cabinet file with internal ID ${numericIdStr}: ${getErrorMessage(err)}`,
          );
        }
      }

      // 2. Otherwise, resolve by File Cabinet path or file name
      if (!fileObj && rawFilePath) {
        let cleanedPath = rawFilePath;
        if (cleanedPath.startsWith("[") && cleanedPath.endsWith("]")) {
          cleanedPath = cleanedPath.slice(1, -1).trim();
        }
        cleanedPath = cleanedPath.replace(/\\/g, "/").trim();

        const pathNoLeadSlash = cleanedPath.replace(/^\/+/, "");
        const pathWithLeadSlash = "/" + pathNoLeadSlash;

        const pathCandidates = [pathNoLeadSlash, pathWithLeadSlash];

        // If the path does not start with a top-level folder like SuiteScripts/, also try under SuiteScripts/
        if (!/^suitescripts\//i.test(pathNoLeadSlash)) {
          pathCandidates.push(`SuiteScripts/${pathNoLeadSlash}`);
          pathCandidates.push(`/SuiteScripts/${pathNoLeadSlash}`);
        }

        const tried = {};
        for (const candidate of pathCandidates) {
          if (!candidate || tried[candidate]) continue;
          tried[candidate] = true;
          try {
            fileObj = file.load({ id: candidate });
            if (fileObj) break;
          } catch (err) {
            if (!loadError) loadError = err;
          }
        }

        // 3. Fallback: Search by file name in SuiteQL `file` table and match folder path
        if (!fileObj) {
          const baseName = pathNoLeadSlash.split("/").pop() || "";
          if (baseName) {
            const escapedBaseName = baseName.replace(/'/g, "''");
            let fileRows = [];
            try {
              fileRows = query
                .runSuiteQL({
                  query: `
                    SELECT
                      f.id AS id,
                      f.name AS name,
                      f.folder AS folder,
                      f.filetype AS filetype,
                      f.filesize AS filesize
                    FROM
                      file f
                    WHERE
                      LOWER(f.name) = LOWER('${escapedBaseName}')
                    ORDER BY
                      f.id ASC
                  `,
                })
                .asMappedResults();
            } catch {
              fileRows = [];
            }

            if (Array.isArray(fileRows) && fileRows.length > 0) {
              const pathMap = resolveFileCabinetPathsByEntries(fileRows);
              const lowerTargetWithSlash = pathWithLeadSlash.toLowerCase();
              const lowerTargetSuffix = "/" + pathNoLeadSlash.toLowerCase();

              const candidates = fileRows.map((r) => {
                const fId = Number(r.id);
                return {
                  fileId: fId,
                  name: String(r.name || ""),
                  folderId: r.folder != null ? Number(r.folder) : null,
                  fileType: r.filetype != null ? String(r.filetype) : null,
                  byteSize: r.filesize != null ? Number(r.filesize) : null,
                  fileCabinetPath: pathMap[fId] || `/${r.name}`,
                };
              });

              // Check exact full path match first, then suffix match (e.g. "sub/foo.js" matching "/SuiteScripts/sub/foo.js")
              let matchedCandidates = candidates.filter(
                (c) => c.fileCabinetPath.toLowerCase() === lowerTargetWithSlash,
              );
              if (matchedCandidates.length === 0) {
                matchedCandidates = candidates.filter((c) =>
                  c.fileCabinetPath.toLowerCase().endsWith(lowerTargetSuffix),
                );
              }
              if (matchedCandidates.length === 0 && !pathNoLeadSlash.includes("/")) {
                matchedCandidates = candidates;
              }

              if (matchedCandidates.length === 1) {
                try {
                  fileObj = file.load({ id: matchedCandidates[0].fileId });
                } catch (err) {
                  loadError = err;
                }
              } else if (matchedCandidates.length > 1) {
                return {
                  success: false,
                  errorMessage: `Multiple files (${matchedCandidates.length}) matched "${rawFilePath}" in the File Cabinet. Please specify the exact "fileId" or full "fileCabinetPath".`,
                  candidates: matchedCandidates,
                };
              }
            }
          }
        }
      }

      if (!fileObj) {
        const detail = loadError ? `: ${getErrorMessage(loadError)}` : "";
        return makeErrorResponse(
          `File "${rawFilePath || rawFileId}" was not found in the NetSuite File Cabinet${detail}`,
        );
      }

      const fileId = Number(fileObj.id);
      const fileName = String(fileObj.name || "");
      const folderId =
        fileObj.folder != null && !isNaN(Number(fileObj.folder))
          ? Number(fileObj.folder)
          : null;

      // Resolve full canonical File Cabinet path
      const resolvedPaths = resolveFileCabinetPathsByEntries([
        { id: fileId, name: fileName, folder: folderId },
      ]);
      let fileCabinetPath = resolvedPaths[fileId] || "";
      if (!fileCabinetPath || fileCabinetPath === `/${fileName}`) {
        const rawObjPath = fileObj.path ? String(fileObj.path).replace(/\\/g, "/").trim() : "";
        if (rawObjPath) {
          fileCabinetPath = rawObjPath.startsWith("/") ? rawObjPath : `/${rawObjPath}`;
        } else if (!fileCabinetPath) {
          fileCabinetPath = `/${fileName}`;
        }
      }

      let rawContents = "";
      try {
        rawContents = fileObj.getContents();
      } catch (contentErr) {
        return makeErrorResponse(
          `Loaded metadata for "${fileCabinetPath}" (fileId: ${fileId}, size: ${fileObj.size} bytes), but failed to read file contents: ${getErrorMessage(contentErr)}`,
        );
      }

      const timeElapsedMS = timer.elapsed;
      const governanceUsed = startGovernance - script.getRemainingUsage();

      return {
        success: true,
        fileId: fileId,
        name: fileName,
        folderId: folderId,
        fileCabinetPath: fileCabinetPath,
        fileType: fileObj.fileType != null ? String(fileObj.fileType) : null,
        size: fileObj.size != null ? Number(fileObj.size) : null,
        encoding: fileObj.encoding != null ? String(fileObj.encoding) : null,
        description: fileObj.description != null ? String(fileObj.description) : null,
        url: fileObj.url != null ? String(fileObj.url) : null,
        isOnline: Boolean(fileObj.isOnline),
        isInactive: Boolean(fileObj.isInactive),
        rawIsText: Boolean(fileObj.isText),
        contents: rawContents != null ? String(rawContents) : "",
        timeElapsedMS: timeElapsedMS,
        governanceUsed: governanceUsed,
      };
    } catch (e) {
      return makeErrorResponse(`Unable to load File Cabinet file: ${getErrorMessage(e)}`);
    }
  }

  /**
   * Normalizes a custom search script ID so that non-numeric IDs always start with "customsearch_".
   *
   * @param {string|number|null} rawId
   * @returns {string|null}
   */
  function normalizeSearchScriptId(rawId) {
    if (rawId == null) return null;
    const trimmed = String(rawId).trim();
    if (!trimmed) return null;
    if (/^\d+$/.test(trimmed)) {
      return trimmed;
    }
    const lower = trimmed.toLowerCase();
    if (lower.startsWith("customsearch_")) {
      return lower;
    }
    return `customsearch_${lower.replace(/^_+/, "")}`;
  }

  /**
   * Resolves a search summary string (e.g., "GROUP", "SUM", "COUNT", "AVG", "MIN", "MAX")
   * to the corresponding N/search.Summary enum value.
   *
   * @param {string} rawSummary
   * @returns {string|null}
   */
  function resolveSearchSummary(rawSummary) {
    if (!rawSummary || typeof rawSummary !== "string") return null;
    const upper = rawSummary.trim().toUpperCase();
    if (!upper || upper === "NONE") return null;
    if (search.Summary && search.Summary[upper]) {
      return search.Summary[upper];
    }
    const aliases = {
      AVERAGE: search.Summary ? search.Summary.AVG : "AVG",
      MINIMUM: search.Summary ? search.Summary.MIN : "MIN",
      MAXIMUM: search.Summary ? search.Summary.MAX : "MAX",
    };
    return aliases[upper] || upper;
  }

  /**
   * Resolves a search sort direction string ("ASC", "DESC", "NONE") to N/search.Sort.
   *
   * @param {string} rawSort
   * @returns {string|null}
   */
  function resolveSearchSort(rawSort) {
    if (!rawSort || typeof rawSort !== "string") return null;
    const upper = rawSort.trim().toUpperCase();
    if (!upper || upper === "NONE") {
      return search.Sort ? search.Sort.NONE : null;
    }
    if (upper === "ASC" || upper === "ASCENDING") {
      return search.Sort ? search.Sort.ASC : "ASC";
    }
    if (upper === "DESC" || upper === "DESCENDING") {
      return search.Sort ? search.Sort.DESC : "DESC";
    }
    return null;
  }

  /**
   * Resolves a search filter operator (e.g. "anyof", "ANYOF", "is", "greaterthan")
   * to the matching N/search.Operator value.
   *
   * @param {string} rawOperator
   * @returns {string}
   */
  function resolveSearchOperator(rawOperator) {
    if (!rawOperator || typeof rawOperator !== "string") return "";
    const trimmed = rawOperator.trim();
    if (!trimmed) return "";
    const upper = trimmed.toUpperCase();
    if (search.Operator && search.Operator[upper]) {
      return search.Operator[upper];
    }
    return trimmed.toLowerCase();
  }

  /**
   * Normalizes a NetSuite N/search filterExpression array recursively:
   * - Normalizes boolean conjunctions ("and", "or", "not") to uppercase ("AND", "OR", "NOT")
   * - Normalizes operator names in leaf filter clauses via resolveSearchOperator
   * - Unwraps a single array value in the 3rd position of a leaf clause (e.g. ['field', 'anyof', ['@NONE@']]
   *   -> ['field', 'anyof', '@NONE@'] or ['field', 'anyof', ['1', '2']] -> ['field', 'anyof', '1', '2'])
   *   so that both createFilter-style array values and canonical filterExpression positional values work seamlessly.
   *
   * @param {*} expr
   * @returns {*}
   */
  function normalizeFilterExpression(expr) {
    if (!Array.isArray(expr)) {
      if (typeof expr === "string") {
        const upper = expr.trim().toUpperCase();
        if (upper === "AND" || upper === "OR" || upper === "NOT") {
          return upper;
        }
      }
      return expr;
    }

    if (expr.length === 0) {
      return [];
    }

    // Check if this is a leaf filter clause: [fieldNameOrFormula, operator, ...values]
    // In a leaf clause, index 0 is a non-logical-operator string and index 1 is an operator string.
    const first = expr[0];
    const second = expr.length > 1 ? expr[1] : null;
    const firstUpper = typeof first === "string" ? first.trim().toUpperCase() : "";
    const secondUpper = typeof second === "string" ? second.trim().toUpperCase() : "";

    const isLeafClause =
      typeof first === "string" &&
      firstUpper !== "NOT" &&
      firstUpper !== "AND" &&
      firstUpper !== "OR" &&
      typeof second === "string" &&
      secondUpper !== "AND" &&
      secondUpper !== "OR" &&
      secondUpper !== "NOT" &&
      !expr.some((item, idx) => idx > 2 && Array.isArray(item));

    if (isLeafClause) {
      const fieldName = first.trim();
      const operator = resolveSearchOperator(second);
      const rest = expr.slice(2);

      // If the caller passed a single array as the 3rd element (e.g., ['field', 'anyof', ['@NONE@']] or ['field', 'between', [1, 10]]),
      // spread its elements into positional filterExpression arguments: ['field', 'anyof', '@NONE@']
      if (rest.length === 1 && Array.isArray(rest[0])) {
        return [fieldName, operator].concat(rest[0]);
      }
      return [fieldName, operator].concat(rest);
    }

    // Otherwise, recursively normalize nested clauses and logical operators
    return expr.map((item) => normalizeFilterExpression(item));
  }

  /**
   * Builds a stable, descriptive key for a search column in preview row output.
   *
   * @param {Object} col
   * @param {number} index
   * @param {Object} usedKeys
   * @returns {string}
   */
  function buildPreviewColumnKey(col, index, usedKeys) {
    const label = col.label != null && String(col.label).trim() !== "" ? String(col.label).trim() : "";
    const joinPrefix = col.join ? `${String(col.join).trim()}.` : "";
    const namePart = col.name ? String(col.name).trim() : `column_${index + 1}`;
    const summarySuffix = col.summary ? ` (${String(col.summary)})` : "";
    const baseKey = label || `${joinPrefix}${namePart}${summarySuffix}`;

    if (!usedKeys[baseKey]) {
      usedKeys[baseKey] = 1;
      return baseKey;
    }
    usedKeys[baseKey] += 1;
    return `${baseKey}_${usedKeys[baseKey]}`;
  }

  /**
   * ACTION: CREATE_SAVED_SEARCH
   * Builds and executes a NetSuite search definition via N/search.
   * When dryRun is true (default), runs the search in-memory without saving and returns the total
   * match count along with the first maxRows preview rows.
   * When dryRun is false, creates a new saved search (or updates an existing one when overwrite is true)
   * and returns the saved search ID, scriptId, preview rows, and execution metrics.
   *
   * @param {Object} request
   * @param {string} [request.type]
   * @param {string} [request.recordType]
   * @param {Array<Object>} request.columns
   * @param {Array<Object>} [request.filters]
   * @param {Array<*>} [request.filterExpression]
   * @param {Array<Object>|Object} [request.settings]
   * @param {boolean} [request.dryRun=true]
   * @param {number} [request.maxRows=25]
   * @param {string} [request.title]
   * @param {string} [request.id]
   * @param {string} [request.scriptId]
   * @param {boolean} [request.isPublic=false]
   * @param {boolean} [request.overwrite=false]
   * @returns {Object}
   */
  function handleCreateSavedSearch(request) {
    const searchType =
      typeof request.type === "string" && request.type.trim()
        ? request.type.trim()
        : typeof request.recordType === "string" && request.recordType.trim()
          ? request.recordType.trim()
          : "";

    const rawIdInput =
      request.scriptId != null && String(request.scriptId).trim() !== ""
        ? String(request.scriptId).trim()
        : request.id != null && String(request.id).trim() !== ""
          ? String(request.id).trim()
          : "";
    const normalizedScriptId = normalizeSearchScriptId(rawIdInput);
    const isDryRun = request.dryRun !== undefined ? Boolean(request.dryRun) : true;
    const overwrite = Boolean(request.overwrite);
    const title = typeof request.title === "string" ? request.title.trim() : "";

    const hasExplicitColumns = request.columns !== undefined && request.columns !== null;
    const hasExplicitFilters = request.filters !== undefined && request.filters !== null;
    const hasExplicitFilterExpression = request.filterExpression !== undefined && request.filterExpression !== null;

    if (!searchType && !(overwrite && normalizedScriptId)) {
      return makeErrorResponse('Missing or invalid search "type" (e.g., "transaction", "salesorder", "customer", "customrecord_...").');
    }

    if (hasExplicitColumns) {
      if (!Array.isArray(request.columns) || request.columns.length === 0) {
        return makeErrorResponse('Invalid "columns": expected a non-empty array of search column definitions.');
      }
    } else if (!(overwrite && normalizedScriptId)) {
      return makeErrorResponse('Missing required "columns": expected a non-empty array of search column definitions.');
    }

    if (hasExplicitFilters && hasExplicitFilterExpression) {
      if (Array.isArray(request.filters) && request.filters.length > 0 && Array.isArray(request.filterExpression) && request.filterExpression.length > 0) {
        return makeErrorResponse('Provide either "filters" (array of filter objects) OR "filterExpression" (nested filter expression array), not both.');
      }
    }

    if (!isDryRun && !title && !overwrite) {
      return makeErrorResponse('Missing required "title" when saving a search (dryRun: false).');
    }

    const rawMaxRows = request.maxRows != null ? Number(request.maxRows) : request.limit != null ? Number(request.limit) : 25;
    const maxRows = !isNaN(rawMaxRows) && rawMaxRows >= 0 ? Math.min(Math.floor(rawMaxRows), 1000) : 25;

    try {
      const script = runtime.getCurrentScript();
      const startGovernance = script.getRemainingUsage();
      const timer = new ExecutionTimer();

      // 1. Construct N/search columns with per-column diagnostics (if provided)
      const createdColumns = [];
      if (hasExplicitColumns) {
        for (let i = 0; i < request.columns.length; i++) {
          const colDef = request.columns[i];
          if (typeof colDef === "string" && colDef.trim()) {
            try {
              createdColumns.push(search.createColumn({ name: colDef.trim() }));
            } catch (colErr) {
              return makeErrorResponse(
                `Invalid search column at index ${i} ("${colDef}"): ${extractFieldsFromErrorMessage(getErrorMessage(colErr))}`,
              );
            }
            continue;
          }

          if (!colDef || typeof colDef !== "object" || typeof colDef.name !== "string" || !colDef.name.trim()) {
            return makeErrorResponse(
              `Invalid search column at index ${i}: each column must be an object with a non-empty string "name".`,
            );
          }

          const colOptions = {
            name: colDef.name.trim(),
          };

          if (typeof colDef.join === "string" && colDef.join.trim()) {
            colOptions.join = colDef.join.trim();
          }
          if (typeof colDef.summary === "string" && colDef.summary.trim()) {
            const resolvedSum = resolveSearchSummary(colDef.summary);
            if (resolvedSum) colOptions.summary = resolvedSum;
          }
          if (typeof colDef.formula === "string" && colDef.formula.trim()) {
            colOptions.formula = colDef.formula;
          }
          if (typeof colDef.label === "string" && colDef.label.trim()) {
            colOptions.label = colDef.label.trim();
          }
          if (typeof colDef.function === "string" && colDef.function.trim()) {
            colOptions.function = colDef.function.trim();
          }
          if (typeof colDef.sort === "string" && colDef.sort.trim()) {
            const resolvedSort = resolveSearchSort(colDef.sort);
            if (resolvedSort) colOptions.sort = resolvedSort;
          }

          try {
            createdColumns.push(search.createColumn(colOptions));
          } catch (colErr) {
            const colDesc = colOptions.join ? `${colOptions.join}.${colOptions.name}` : colOptions.name;
            return makeErrorResponse(
              `Invalid search column at index ${i} ("${colDesc}"): ${extractFieldsFromErrorMessage(getErrorMessage(colErr))}`,
            );
          }
        }
      }

      // 2. Construct N/search filters or filterExpression
      let createdFilters = null;
      let filterExpression = null;
      let shouldClearFilters = false;

      if (hasExplicitFilterExpression) {
        if (!Array.isArray(request.filterExpression)) {
          return makeErrorResponse('Invalid "filterExpression": expected an array.');
        }
        if (request.filterExpression.length === 0) {
          shouldClearFilters = true;
        } else {
          filterExpression = normalizeFilterExpression(request.filterExpression);
        }
      } else if (hasExplicitFilters) {
        if (!Array.isArray(request.filters)) {
          return makeErrorResponse('Invalid "filters": expected an array.');
        }
        if (request.filters.length === 0) {
          shouldClearFilters = true;
        } else if (Array.isArray(request.filters[0]) || typeof request.filters[0] === "string") {
          // Detect if the caller passed a filterExpression array inside `filters`
          filterExpression = normalizeFilterExpression(request.filters);
        } else {
          createdFilters = [];
          for (let i = 0; i < request.filters.length; i++) {
            const fDef = request.filters[i];
            if (!fDef || typeof fDef !== "object") {
              return makeErrorResponse(`Invalid search filter at index ${i}: expected a filter object.`);
            }
            if (typeof fDef.name !== "string" || !fDef.name.trim()) {
              return makeErrorResponse(`Invalid search filter at index ${i}: missing non-empty string "name".`);
            }
            if (typeof fDef.operator !== "string" || !fDef.operator.trim()) {
              return makeErrorResponse(
                `Invalid search filter at index ${i} ("${fDef.name}"): missing non-empty string "operator" (e.g., "anyof", "is", "greaterthan").`,
              );
            }

            const filterOptions = {
              name: fDef.name.trim(),
              operator: resolveSearchOperator(fDef.operator),
            };

            if (typeof fDef.join === "string" && fDef.join.trim()) {
              filterOptions.join = fDef.join.trim();
            }
            if (fDef.values !== undefined && fDef.values !== null) {
              filterOptions.values = fDef.values;
            } else if (fDef.value !== undefined && fDef.value !== null) {
              filterOptions.values = fDef.value;
            }
            if (typeof fDef.formula === "string" && fDef.formula.trim()) {
              filterOptions.formula = fDef.formula;
            }
            if (typeof fDef.summary === "string" && fDef.summary.trim()) {
              const resolvedSum = resolveSearchSummary(fDef.summary);
              if (resolvedSum) filterOptions.summary = resolvedSum;
            }

            try {
              createdFilters.push(search.createFilter(filterOptions));
            } catch (filterErr) {
              const fDesc = filterOptions.join ? `${filterOptions.join}.${filterOptions.name}` : filterOptions.name;
              return makeErrorResponse(
                `Invalid search filter at index ${i} ("${fDesc}" ${filterOptions.operator}): ${extractFieldsFromErrorMessage(getErrorMessage(filterErr))}`,
              );
            }
          }
        }
      }

      // 3. Construct N/search settings if provided
      const createdSettings = [];
      if (Array.isArray(request.settings)) {
        for (let i = 0; i < request.settings.length; i++) {
          const sDef = request.settings[i];
          if (sDef && typeof sDef === "object" && typeof sDef.name === "string" && sDef.name.trim()) {
            try {
              createdSettings.push(
                search.createSetting({
                  name: sDef.name.trim(),
                  value: sDef.value != null ? String(sDef.value) : "",
                }),
              );
            } catch (sErr) {
              return makeErrorResponse(
                `Invalid search setting "${sDef.name}": ${extractFieldsFromErrorMessage(getErrorMessage(sErr))}`,
              );
            }
          }
        }
      } else if (request.settings && typeof request.settings === "object") {
        for (const sKey of Object.keys(request.settings)) {
          try {
            createdSettings.push(
              search.createSetting({
                name: sKey,
                value: String(request.settings[sKey]),
              }),
            );
          } catch (sErr) {
            return makeErrorResponse(
              `Invalid search setting "${sKey}": ${extractFieldsFromErrorMessage(getErrorMessage(sErr))}`,
            );
          }
        }
      }

      // 4. Create or Load (when overwrite: true and existing search is found) the search object
      let searchObj = null;
      let operation = isDryRun ? "dry_run" : "create";
      let existingLoaded = false;

      if (overwrite && normalizedScriptId) {
        try {
          searchObj = search.load({
            id: normalizedScriptId,
            ...(searchType ? { type: searchType } : {}),
          });
          existingLoaded = true;
          if (!isDryRun) {
            operation = "update";
          }
        } catch (loadErr) {
          // If the search does not exist yet and searchType was provided, fall back to creating a new search
          if (!searchType) {
            return makeErrorResponse(
              `Unable to load existing saved search "${normalizedScriptId}" for update: ${extractFieldsFromErrorMessage(getErrorMessage(loadErr))}`,
            );
          }
          searchObj = null;
        }
      }

      if (searchObj) {
        // Updating an existing search: only replace columns/filters/settings that were explicitly provided
        if (hasExplicitColumns) {
          searchObj.columns = createdColumns;
        }
        if (filterExpression) {
          try {
            searchObj.filterExpression = filterExpression;
          } catch (feErr) {
            return makeErrorResponse(
              `Invalid filterExpression: ${extractFieldsFromErrorMessage(getErrorMessage(feErr))}`,
            );
          }
        } else if (createdFilters) {
          searchObj.filters = createdFilters;
        } else if (shouldClearFilters) {
          searchObj.filters = [];
        }
        if (createdSettings.length > 0) {
          searchObj.settings = createdSettings;
        }
      } else {
        if (!hasExplicitColumns || createdColumns.length === 0) {
          return makeErrorResponse('Missing required "columns": expected a non-empty array of search column definitions when creating a new search.');
        }

        // Note: N/search.create accepts either an array of search.Filter objects OR a filterExpression array under the `filters` option
        // (it silently ignores `createOptions.filterExpression`!). We also assign `searchObj.filterExpression` directly to guarantee application.
        const createOptions = {
          type: searchType,
          columns: createdColumns,
        };
        if (filterExpression) {
          createOptions.filters = filterExpression;
        } else if (createdFilters && createdFilters.length > 0) {
          createOptions.filters = createdFilters;
        }
        if (createdSettings.length > 0) {
          createOptions.settings = createdSettings;
        }

        try {
          searchObj = search.create(createOptions);
          if (filterExpression) {
            searchObj.filterExpression = filterExpression;
          }
        } catch (createErr) {
          return makeErrorResponse(
            `Failed to create search definition for type "${searchType}": ${extractFieldsFromErrorMessage(getErrorMessage(createErr))}`,
          );
        }
      }

      // 5. Execute the search to validate and collect preview rows + totalMatchCount
      let totalMatchCount = null;
      const previewRows = [];
      const activeColumns = searchObj.columns || createdColumns;
      const usedKeys = {};
      const columnMeta = activeColumns.map((col, idx) => ({
        key: buildPreviewColumnKey(col, idx, usedKeys),
        name: col.name,
        join: col.join || null,
        summary: col.summary || null,
        label: col.label || null,
        formula: col.formula || null,
        sort: col.sort || null,
        function: col.function || null,
      }));

      try {
        const pagedData = searchObj.runPaged({ pageSize: Math.max(50, Math.min(maxRows || 50, 1000)) });
        totalMatchCount = typeof pagedData.count === "number" ? pagedData.count : null;
      } catch {
        // Fallback if runPaged is unsupported for a specific search type or summary configuration
        totalMatchCount = null;
      }

      if (maxRows > 0) {
        let rawResults = [];
        try {
          rawResults = searchObj.run().getRange({ start: 0, end: maxRows }) || [];
        } catch (runErr) {
          return makeErrorResponse(
            `Search execution failed: ${extractFieldsFromErrorMessage(getErrorMessage(runErr))}`,
          );
        }

        for (let rIdx = 0; rIdx < rawResults.length; rIdx++) {
          const res = rawResults[rIdx];
          const rowValues = {};

          for (let cIdx = 0; cIdx < activeColumns.length; cIdx++) {
            const col = activeColumns[cIdx];
            const colKey = columnMeta[cIdx].key;
            let val = null;
            let txt = null;

            try {
              val = res.getValue(col);
            } catch {
              val = null;
            }
            try {
              txt = res.getText(col);
            } catch {
              txt = null;
            }

            if (txt != null && txt !== "" && String(txt) !== String(val)) {
              rowValues[colKey] = {
                value: val,
                text: txt,
              };
            } else {
              rowValues[colKey] = val;
            }
          }

          previewRows.push({
            ...(res.id != null ? { id: res.id } : {}),
            ...(res.recordType != null ? { recordType: res.recordType } : {}),
            values: rowValues,
          });
        }
      }

      // 6. Save the search when dryRun is false
      let savedSearchId = null;
      let resolvedTitle = title || (searchObj.title ? String(searchObj.title) : null);
      let resolvedScriptId = normalizedScriptId || (searchObj.id ? String(searchObj.id) : null);
      let resolvedIsPublic =
        request.isPublic !== undefined ? Boolean(request.isPublic) : Boolean(searchObj.isPublic);

      if (!isDryRun) {
        if (title) {
          searchObj.title = title;
          resolvedTitle = title;
        }
        if (normalizedScriptId && !/^\d+$/.test(normalizedScriptId)) {
          searchObj.id = normalizedScriptId;
          resolvedScriptId = normalizedScriptId;
        }
        if (request.isPublic !== undefined) {
          searchObj.isPublic = Boolean(request.isPublic);
          resolvedIsPublic = Boolean(request.isPublic);
        }

        try {
          savedSearchId = searchObj.save();
        } catch (saveErr) {
          return makeErrorResponse(
            `Search preview succeeded, but saving the search failed: ${extractFieldsFromErrorMessage(getErrorMessage(saveErr))}`,
          );
        }
      }

      const timeElapsedMS = timer.elapsed;
      const governanceUsed = startGovernance - script.getRemainingUsage();

      return {
        success: true,
        dryRun: isDryRun,
        operation: operation,
        existingSearchLoaded: existingLoaded,
        searchType: searchObj.searchType || searchType || null,
        ...(savedSearchId != null
          ? {
              savedSearchId: savedSearchId,
              searchResultsUrl: `/app/common/search/searchresults.nl?searchid=${savedSearchId}`,
            }
          : {}),
        ...(resolvedScriptId ? { scriptId: resolvedScriptId } : {}),
        ...(resolvedTitle ? { title: resolvedTitle } : {}),
        isPublic: resolvedIsPublic,
        totalMatchCount: totalMatchCount,
        previewRowCount: previewRows.length,
        filters: serializeSearchFilters(searchObj.filters),
        appliedFilterExpression: searchObj.filterExpression || null,
        settings: serializeSearchSettings(searchObj.settings),
        columns: columnMeta,
        previewRows: previewRows,
        timeElapsedMS: timeElapsedMS,
        governanceUsed: governanceUsed,
      };
    } catch (e) {
      return makeErrorResponse(
        `Unable to ${isDryRun ? "run search dry-run" : "save search"}: ${extractFieldsFromErrorMessage(getErrorMessage(e))}`,
      );
    }
  }

  /**
   * Serializes an array of N/search.Filter objects into a clean array of structured filter definitions
   * directly compatible with `netsuite_create_saved_search`.
   *
   * @param {Array<Object>|null} rawFilters
   * @returns {Array<Object>}
   */
  function serializeSearchFilters(rawFilters) {
    if (!Array.isArray(rawFilters) || rawFilters.length === 0) return [];
    const serialized = [];
    for (let i = 0; i < rawFilters.length; i++) {
      const f = rawFilters[i];
      if (!f || typeof f !== "object" || !f.name) continue;
      const item = {
        name: String(f.name),
        operator: f.operator != null ? String(f.operator) : "",
      };
      if (f.join) {
        item.join = String(f.join);
      }
      if (f.values !== undefined && f.values !== null) {
        item.values = f.values;
      }
      if (f.formula) {
        item.formula = String(f.formula);
      }
      if (f.summary) {
        item.summary = String(f.summary);
      }
      serialized.push(item);
    }
    return serialized;
  }

  /**
   * Serializes an array of N/search.Setting objects into `{ name, value }` pairs
   * directly compatible with `netsuite_create_saved_search`.
   *
   * @param {Array<Object>|null} rawSettings
   * @returns {Array<{ name: string, value: string }>}
   */
  function serializeSearchSettings(rawSettings) {
    if (!Array.isArray(rawSettings) || rawSettings.length === 0) return [];
    const serialized = [];
    for (let i = 0; i < rawSettings.length; i++) {
      const s = rawSettings[i];
      if (!s || typeof s !== "object" || !s.name) continue;
      serialized.push({
        name: String(s.name),
        value: s.value != null ? String(s.value) : "",
      });
    }
    return serialized;
  }

  /**
   * ACTION: VIEW_SAVED_SEARCH
   * Two modes:
   * 1. Inspect & Preview Mode (`scriptId` or `id` provided):
   *    Loads an existing NetSuite Saved Search via N/search.load, returns its full definition
   *    (searchType, title, scriptId, savedSearchId, isPublic, columns, filters, filterExpression, settings)
   *    in a format ready to pass to `netsuite_create_saved_search` with `overwrite: true`,
   *    and optionally executes a preview of the first `maxRows` rows (default 25; pass 0 for definition only).
   * 2. Search / List Mode (`scriptId` and `id` omitted):
   *    Searches existing saved searches in NetSuite (optionally filtered by `searchTerm` and/or `recordType`)
   *    so an agent can discover the `scriptId` of a saved search by its title or record type.
   *
   * @param {Object} request
   * @param {string|number} [request.scriptId]
   * @param {string|number} [request.id]
   * @param {string} [request.searchTerm]
   * @param {string} [request.recordType]
   * @param {string} [request.type]
   * @param {number} [request.maxRows=25]
   * @param {number} [request.limit=50]
   * @returns {Object}
   */
  function handleViewSavedSearch(request) {
    const rawIdInput =
      request.scriptId != null && String(request.scriptId).trim() !== ""
        ? String(request.scriptId).trim()
        : request.id != null && String(request.id).trim() !== ""
          ? String(request.id).trim()
          : "";
    const normalizedScriptId = normalizeSearchScriptId(rawIdInput);
    const recordType =
      typeof request.recordType === "string" && request.recordType.trim()
        ? request.recordType.trim()
        : typeof request.type === "string" && request.type.trim()
          ? request.type.trim()
          : "";
    const searchTerm =
      typeof request.searchTerm === "string" && request.searchTerm.trim()
        ? request.searchTerm.trim()
        : "";

    try {
      const script = runtime.getCurrentScript();
      const startGovernance = script.getRemainingUsage();
      const timer = new ExecutionTimer();

      // Mode 2: Search / List saved searches when scriptId is omitted
      if (!normalizedScriptId) {
        const rawLimit = request.limit != null ? Number(request.limit) : 50;
        const limit = !isNaN(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), 500) : 50;

        // Note: NetSuite's `savedsearch` search type does not support `contains` on `title` or `id`
        // (`An nlobjSearchFilter contains an invalid operator, or is not in proper syntax: title`).
        // Therefore, we fetch saved searches and apply `searchTerm` (and `recordType`) filtering in-memory.
        const colInternalId = search.createColumn({ name: "internalid", sort: search.Sort.DESC });
        const colScriptId = search.createColumn({ name: "id" });
        const colTitle = search.createColumn({ name: "title" });
        const colRecordType = search.createColumn({ name: "recordtype" });
        const colOwner = search.createColumn({ name: "owner" });
        const colIsPublic = search.createColumn({ name: "public" });

        let listSearchObj;
        try {
          listSearchObj = search.create({
            type: "savedsearch",
            columns: [colInternalId, colScriptId, colTitle, colRecordType, colOwner, colIsPublic],
          });
        } catch (createListErr) {
          return makeErrorResponse(
            `Unable to search saved searches: ${extractFieldsFromErrorMessage(getErrorMessage(createListErr))}`,
          );
        }

        const lowerTerm = searchTerm ? searchTerm.toLowerCase() : "";
        const lowerRecType = recordType ? recordType.toLowerCase() : "";
        const matchedItems = [];
        let totalMatched = 0;

        try {
          const pagedList = listSearchObj.runPaged({ pageSize: 1000 });
          const maxPagesToScan = lowerTerm || lowerRecType ? Math.min(pagedList.pageRanges.length, 5) : 1;

          for (let pIdx = 0; pIdx < maxPagesToScan; pIdx++) {
            const page = pagedList.fetch({ index: pagedList.pageRanges[pIdx].index });
            const pageData = page && Array.isArray(page.data) ? page.data : [];

            for (let rIdx = 0; rIdx < pageData.length; rIdx++) {
              const r = pageData[rIdx];
              const internalId = r.getValue(colInternalId) || r.id || null;
              const sId = r.getValue(colScriptId) || null;
              const sTitle = r.getValue(colTitle) || null;
              const recTypeVal = r.getValue(colRecordType) || null;
              const recTypeText = r.getText(colRecordType) || null;
              const ownerText = r.getText(colOwner) || r.getValue(colOwner) || null;
              const pubVal = r.getValue(colIsPublic);
              const isPub = pubVal === true || pubVal === "T";

              if (lowerRecType) {
                const rtValLower = String(recTypeVal || "").toLowerCase();
                const rtTxtLower = String(recTypeText || "").toLowerCase();
                if (
                  rtValLower !== lowerRecType &&
                  rtTxtLower !== lowerRecType &&
                  !rtValLower.includes(lowerRecType) &&
                  !rtTxtLower.includes(lowerRecType)
                ) {
                  continue;
                }
              }

              if (lowerTerm) {
                const matchId = sId ? String(sId).toLowerCase().includes(lowerTerm) : false;
                const matchInternal = internalId != null ? String(internalId).toLowerCase().includes(lowerTerm) : false;
                const matchTitle = sTitle ? String(sTitle).toLowerCase().includes(lowerTerm) : false;
                const matchType =
                  (recTypeVal && String(recTypeVal).toLowerCase().includes(lowerTerm)) ||
                  (recTypeText && String(recTypeText).toLowerCase().includes(lowerTerm));
                if (!matchId && !matchInternal && !matchTitle && !matchType) {
                  continue;
                }
              }

              totalMatched++;
              if (matchedItems.length < limit) {
                matchedItems.push({
                  ...(internalId != null ? { savedSearchId: internalId } : {}),
                  scriptId: sId,
                  title: sTitle,
                  recordType: recTypeVal,
                  ...(recTypeText && recTypeText !== recTypeVal ? { recordTypeLabel: recTypeText } : {}),
                  isPublic: isPub,
                  ...(ownerText ? { owner: ownerText } : {}),
                  ...(internalId != null
                    ? { searchResultsUrl: `/app/common/search/searchresults.nl?searchid=${internalId}` }
                    : {}),
                });
              }
            }
          }
        } catch (runListErr) {
          return makeErrorResponse(
            `Unable to list saved searches: ${extractFieldsFromErrorMessage(getErrorMessage(runListErr))}`,
          );
        }

        const timeElapsedMS = timer.elapsed;
        const governanceUsed = startGovernance - script.getRemainingUsage();

        return {
          success: true,
          mode: "list",
          ...(searchTerm ? { searchTerm: searchTerm } : {}),
          ...(recordType ? { recordType: recordType } : {}),
          totalMatchingCount: totalMatched,
          count: matchedItems.length,
          savedSearches: matchedItems,
          timeElapsedMS: timeElapsedMS,
          governanceUsed: governanceUsed,
        };
      }

      // Mode 1: Inspect & Preview a specific saved search by scriptId / internal ID
      const rawMaxRows = request.maxRows != null ? Number(request.maxRows) : 25;
      const maxRows = !isNaN(rawMaxRows) && rawMaxRows >= 0 ? Math.min(Math.floor(rawMaxRows), 1000) : 25;

      let searchObj = null;
      try {
        searchObj = search.load({
          id: normalizedScriptId,
          ...(recordType ? { type: recordType } : {}),
        });
      } catch (loadErr) {
        return makeErrorResponse(
          `Unable to load saved search "${normalizedScriptId}": ${extractFieldsFromErrorMessage(getErrorMessage(loadErr))}`,
        );
      }

      const activeColumns = Array.isArray(searchObj.columns) ? searchObj.columns : [];
      const usedKeys = {};
      const columnMeta = activeColumns.map((col, idx) => {
        const key = buildPreviewColumnKey(col, idx, usedKeys);
        const item = {
          key: key,
          name: col.name,
        };
        if (col.join) item.join = col.join;
        if (col.summary) item.summary = col.summary;
        if (col.formula) item.formula = col.formula;
        if (col.label) item.label = col.label;
        if (col.sort && String(col.sort).toUpperCase() !== "NONE") item.sort = col.sort;
        if (col.function) item.function = col.function;
        return item;
      });

      const structuredFilters = serializeSearchFilters(searchObj.filters);
      const structuredSettings = serializeSearchSettings(searchObj.settings);
      const filterExpr = searchObj.filterExpression || null;

      let totalMatchCount = null;
      const previewRows = [];

      if (maxRows > 0) {
        try {
          const pagedData = searchObj.runPaged({ pageSize: Math.max(50, Math.min(maxRows || 50, 1000)) });
          totalMatchCount = typeof pagedData.count === "number" ? pagedData.count : null;
        } catch {
          totalMatchCount = null;
        }

        let rawResults = [];
        try {
          rawResults = searchObj.run().getRange({ start: 0, end: maxRows }) || [];
        } catch (runErr) {
          return makeErrorResponse(
            `Loaded saved search "${normalizedScriptId}", but preview execution failed: ${extractFieldsFromErrorMessage(getErrorMessage(runErr))}`,
          );
        }

        for (let rIdx = 0; rIdx < rawResults.length; rIdx++) {
          const res = rawResults[rIdx];
          const rowValues = {};

          for (let cIdx = 0; cIdx < activeColumns.length; cIdx++) {
            const col = activeColumns[cIdx];
            const colKey = columnMeta[cIdx].key;
            let val = null;
            let txt = null;

            try {
              val = res.getValue(col);
            } catch {
              val = null;
            }
            try {
              txt = res.getText(col);
            } catch {
              txt = null;
            }

            if (txt != null && txt !== "" && String(txt) !== String(val)) {
              rowValues[colKey] = {
                value: val,
                text: txt,
              };
            } else {
              rowValues[colKey] = val;
            }
          }

          previewRows.push({
            ...(res.id != null ? { id: res.id } : {}),
            ...(res.recordType != null ? { recordType: res.recordType } : {}),
            values: rowValues,
          });
        }
      }

      const resolvedSavedSearchId =
        searchObj.searchId != null
          ? searchObj.searchId
          : /^\d+$/.test(normalizedScriptId)
            ? Number(normalizedScriptId)
            : null;
      const resolvedScriptId =
        searchObj.id != null ? String(searchObj.id) : normalizedScriptId;
      const resolvedTitle = searchObj.title ? String(searchObj.title) : null;
      const resolvedIsPublic = Boolean(searchObj.isPublic);

      const timeElapsedMS = timer.elapsed;
      const governanceUsed = startGovernance - script.getRemainingUsage();

      return {
        success: true,
        mode: "view",
        searchType: searchObj.searchType || recordType || null,
        ...(resolvedSavedSearchId != null
          ? {
              savedSearchId: resolvedSavedSearchId,
              searchResultsUrl: `/app/common/search/searchresults.nl?searchid=${resolvedSavedSearchId}`,
            }
          : {}),
        scriptId: resolvedScriptId,
        title: resolvedTitle,
        isPublic: resolvedIsPublic,
        columns: columnMeta,
        filters: structuredFilters,
        filterExpression: filterExpr,
        settings: structuredSettings,
        ...(maxRows > 0
          ? {
              totalMatchCount: totalMatchCount,
              previewRowCount: previewRows.length,
              previewRows: previewRows,
            }
          : {}),
        timeElapsedMS: timeElapsedMS,
        governanceUsed: governanceUsed,
      };
    } catch (e) {
      return makeErrorResponse(
        `Unable to view saved search: ${extractFieldsFromErrorMessage(getErrorMessage(e))}`,
      );
    }
  }

  /**
   * Normalizes a custom dataset script ID so that non-numeric IDs always start with "custdataset".
   * Preserves both custom underscore-prefixed IDs ("custdataset_foo") and NetSuite auto-generated
   * dataset IDs ("custdataset65").
   *
   * @param {string|number|null} rawId
   * @returns {string|null}
   */
  function normalizeDatasetScriptId(rawId) {
    if (rawId == null) return null;
    const trimmed = String(rawId).trim();
    if (!trimmed) return null;
    if (/^\d+$/.test(trimmed)) {
      return trimmed;
    }
    const lower = trimmed.toLowerCase();
    if (lower.startsWith("custdataset")) {
      return lower;
    }
    if (lower.startsWith("customdataset_")) {
      return `custdataset_${lower.slice("customdataset_".length).replace(/^_+/, "")}`;
    }
    if (lower.startsWith("customdataset")) {
      return `custdataset_${lower.slice("customdataset".length).replace(/^_+/, "")}`;
    }
    return `custdataset_${lower.replace(/^_+/, "")}`;
  }

  /**
   * Resolves a formula return type string (e.g., "STRING", "TEXT", "INTEGER", "FLOAT", "CURRENCY", "DATE")
   * to the matching N/query.ReturnType value.
   *
   * @param {string} rawType
   * @returns {string}
   */
  function resolveDatasetFormulaType(rawType) {
    if (!rawType || typeof rawType !== "string") return "";
    const upper = rawType.trim().toUpperCase();
    if (!upper) return "";

    if (query.ReturnType && query.ReturnType[upper]) {
      return query.ReturnType[upper];
    }

    const aliases = {
      TEXT: query.ReturnType ? query.ReturnType.STRING : "STRING",
      VARCHAR: query.ReturnType ? query.ReturnType.STRING : "STRING",
      CHAR: query.ReturnType ? query.ReturnType.STRING : "STRING",
      INT: query.ReturnType ? query.ReturnType.INTEGER : "INTEGER",
      NUMBER: query.ReturnType ? query.ReturnType.FLOAT : "FLOAT",
      NUMERIC: query.ReturnType ? query.ReturnType.FLOAT : "FLOAT",
      DECIMAL: query.ReturnType ? query.ReturnType.FLOAT : "FLOAT",
      DOUBLE: query.ReturnType ? query.ReturnType.FLOAT : "FLOAT",
      BOOL: query.ReturnType ? query.ReturnType.BOOLEAN : "BOOLEAN",
      CHECKBOX: query.ReturnType ? query.ReturnType.BOOLEAN : "BOOLEAN",
      TIMESTAMP: query.ReturnType ? query.ReturnType.DATETIME : "DATETIME",
      DATETIMETZ: query.ReturnType ? query.ReturnType.DATETIME : "DATETIME",
      CLOB: query.ReturnType ? query.ReturnType.CLOBTEXT : "CLOBTEXT",
      TEXTAREA: query.ReturnType ? query.ReturnType.CLOBTEXT : "CLOBTEXT",
      SELECT: query.ReturnType ? query.ReturnType.KEY : "KEY",
    };

    return aliases[upper] || upper;
  }

  /**
   * Resolves a condition operator string (accepting both N/query.Operator names and N/search-style aliases)
   * to the corresponding N/query.Operator value.
   *
   * @param {string} rawOperator
   * @returns {string}
   */
  function resolveDatasetOperator(rawOperator) {
    if (!rawOperator || typeof rawOperator !== "string") return "";
    const trimmed = rawOperator.trim();
    if (!trimmed) return "";
    const upper = trimmed.toUpperCase();

    if (upper === "AND" || upper === "OR") {
      return upper;
    }

    if (query.Operator && query.Operator[upper]) {
      return query.Operator[upper];
    }

    const op = query.Operator || {};
    const aliases = {
      // Equality / boolean
      EQ: op.EQUAL || "EQUAL",
      "=": op.EQUAL || "EQUAL",
      "==": op.EQUAL || "EQUAL",
      EQUALTO: op.EQUAL || "EQUAL",
      EQUAL_TO: op.EQUAL || "EQUAL",
      NE: op.EQUAL_NOT || "EQUAL_NOT",
      "!=": op.EQUAL_NOT || "EQUAL_NOT",
      "<>": op.EQUAL_NOT || "EQUAL_NOT",
      NOTEQUAL: op.EQUAL_NOT || "EQUAL_NOT",
      NOTEQUALTO: op.EQUAL_NOT || "EQUAL_NOT",
      NOT_EQUAL: op.EQUAL_NOT || "EQUAL_NOT",
      NOT_EQUAL_TO: op.EQUAL_NOT || "EQUAL_NOT",
      ISNOT: op.IS_NOT || "IS_NOT",
      NOT_IS: op.IS_NOT || "IS_NOT",

      // List / multi-select membership
      ANYOF: op.ANY_OF || "ANY_OF",
      IN: op.ANY_OF || "ANY_OF",
      NONEOF: op.ANY_OF_NOT || "ANY_OF_NOT",
      NONE_OF: op.ANY_OF_NOT || "ANY_OF_NOT",
      NOT_ANY_OF: op.ANY_OF_NOT || "ANY_OF_NOT",
      NOTIN: op.ANY_OF_NOT || "ANY_OF_NOT",
      NOT_IN: op.ANY_OF_NOT || "ANY_OF_NOT",
      INCLUDEALL: op.INCLUDE_ALL || "MN_INCLUDE_ALL",
      INCLUDEANY: op.INCLUDE_ANY || "MN_INCLUDE",
      INCLUDEEXACTLY: op.INCLUDE_EXACTLY || "MN_INCLUDE_EXACTLY",
      EXCLUDEALL: op.EXCLUDE_ALL || "MN_EXCLUDE",
      EXCLUDEANY: op.EXCLUDE_ANY || "MN_EXCLUDE_ALL",
      EXCLUDEEXACTLY: op.EXCLUDE_EXACTLY || "MN_EXCLUDE_EXACTLY",

      // Null / empty
      ISEMPTY: op.EMPTY || "EMPTY",
      IS_EMPTY: op.EMPTY || "EMPTY",
      ISNULL: op.EMPTY || "EMPTY",
      IS_NULL: op.EMPTY || "EMPTY",
      NULL: op.EMPTY || "EMPTY",
      ISNOTEMPTY: op.EMPTY_NOT || "EMPTY_NOT",
      IS_NOT_EMPTY: op.EMPTY_NOT || "EMPTY_NOT",
      NOTEMPTY: op.EMPTY_NOT || "EMPTY_NOT",
      NOT_EMPTY: op.EMPTY_NOT || "EMPTY_NOT",
      ISNOTNULL: op.EMPTY_NOT || "EMPTY_NOT",
      IS_NOT_NULL: op.EMPTY_NOT || "EMPTY_NOT",
      NOTNULL: op.EMPTY_NOT || "EMPTY_NOT",
      NOT_NULL: op.EMPTY_NOT || "EMPTY_NOT",

      // String matching
      CONTAINS: op.CONTAIN || "CONTAIN",
      LIKE: op.CONTAIN || "CONTAIN",
      DOESNOTCONTAIN: op.CONTAIN_NOT || "CONTAIN_NOT",
      DOES_NOT_CONTAIN: op.CONTAIN_NOT || "CONTAIN_NOT",
      NOTCONTAIN: op.CONTAIN_NOT || "CONTAIN_NOT",
      NOTCONTAINS: op.CONTAIN_NOT || "CONTAIN_NOT",
      NOT_CONTAIN: op.CONTAIN_NOT || "CONTAIN_NOT",
      NOT_CONTAINS: op.CONTAIN_NOT || "CONTAIN_NOT",
      STARTSWITH: op.START_WITH || "START_WITH",
      STARTS_WITH: op.START_WITH || "START_WITH",
      STARTWITH: op.START_WITH || "START_WITH",
      DOESNOTSTARTWITH: op.START_WITH_NOT || "START_WITH_NOT",
      DOES_NOT_START_WITH: op.START_WITH_NOT || "START_WITH_NOT",
      NOTSTARTWITH: op.START_WITH_NOT || "START_WITH_NOT",
      NOT_START_WITH: op.START_WITH_NOT || "START_WITH_NOT",
      ENDSWITH: op.ENDWITH || "ENDWITH",
      ENDS_WITH: op.ENDWITH || "ENDWITH",
      END_WITH: op.ENDWITH || "ENDWITH",
      DOESNOTENDWITH: op.ENDWITH_NOT || "ENDWITH_NOT",
      DOES_NOT_END_WITH: op.ENDWITH_NOT || "ENDWITH_NOT",
      NOTENDWITH: op.ENDWITH_NOT || "ENDWITH_NOT",
      NOT_END_WITH: op.ENDWITH_NOT || "ENDWITH_NOT",
      END_WITH_NOT: op.ENDWITH_NOT || "ENDWITH_NOT",

      // Numeric comparisons
      ">": op.GREATER || "GREATER",
      GT: op.GREATER || "GREATER",
      GREATERTHAN: op.GREATER || "GREATER",
      GREATER_THAN: op.GREATER || "GREATER",
      NOTGREATER: op.GREATER_NOT || "GREATER_NOT",
      NOT_GREATER: op.GREATER_NOT || "GREATER_NOT",
      ">=": op.GREATER_OR_EQUAL || "GREATER_OR_EQUAL",
      GTE: op.GREATER_OR_EQUAL || "GREATER_OR_EQUAL",
      GREATERTHANOREQUALTO: op.GREATER_OR_EQUAL || "GREATER_OR_EQUAL",
      GREATER_THAN_OR_EQUAL_TO: op.GREATER_OR_EQUAL || "GREATER_OR_EQUAL",
      GREATER_THAN_OR_EQUAL: op.GREATER_OR_EQUAL || "GREATER_OR_EQUAL",
      "<": op.LESS || "LESS",
      LT: op.LESS || "LESS",
      LESSTHAN: op.LESS || "LESS",
      LESS_THAN: op.LESS || "LESS",
      NOTLESS: op.LESS_NOT || "LESS_NOT",
      NOT_LESS: op.LESS_NOT || "LESS_NOT",
      "<=": op.LESS_OR_EQUAL || "LESS_OR_EQUAL",
      LTE: op.LESS_OR_EQUAL || "LESS_OR_EQUAL",
      LESSTHANOREQUALTO: op.LESS_OR_EQUAL || "LESS_OR_EQUAL",
      LESS_THAN_OR_EQUAL_TO: op.LESS_OR_EQUAL || "LESS_OR_EQUAL",
      LESS_THAN_OR_EQUAL: op.LESS_OR_EQUAL || "LESS_OR_EQUAL",
      NOTBETWEEN: op.BETWEEN_NOT || "BETWEEN_NOT",
      NOT_BETWEEN: op.BETWEEN_NOT || "BETWEEN_NOT",

      // Date comparisons
      ONORAFTER: op.ON_OR_AFTER || "ON_OR_AFTER",
      ON_OR_AFTER: op.ON_OR_AFTER || "ON_OR_AFTER",
      NOTONORAFTER: op.ON_OR_AFTER_NOT || "ON_OR_AFTER_NOT",
      ONORBEFORE: op.ON_OR_BEFORE || "ON_OR_BEFORE",
      ON_OR_BEFORE: op.ON_OR_BEFORE || "ON_OR_BEFORE",
      NOTONORBEFORE: op.ON_OR_BEFORE_NOT || "ON_OR_BEFORE_NOT",
      NOTON: op.ON_NOT || "ON_NOT",
      NOT_ON: op.ON_NOT || "ON_NOT",
      NOTAFTER: op.AFTER_NOT || "AFTER_NOT",
      NOT_AFTER: op.AFTER_NOT || "AFTER_NOT",
      NOTBEFORE: op.BEFORE_NOT || "BEFORE_NOT",
      NOT_BEFORE: op.BEFORE_NOT || "BEFORE_NOT",
      NOTWITHIN: op.WITHIN_NOT || "WITHIN_NOT",
      NOT_WITHIN: op.WITHIN_NOT || "WITHIN_NOT",
    };

    return aliases[upper] || upper;
  }

  /**
   * Default polymorphic target candidates in N/dataset and N/query when a caller uses dot-notation
   * or omits `target` on a polymorphic join field (e.g. `join: "transactionlines.item"` or `join: "entity"`).
   */
  const DEFAULT_POLYMORPHIC_JOIN_TARGETS = {
    item: ["item", "generalizeditem"],
    entity: ["entity", "customer", "vendor", "employee", "partner", "contact"],
    createdby: ["entity", "employee"],
    lastmodifiedby: ["entity", "employee"],
  };

  /**
   * Post-processes an array of normalized join hops so that if an outer hop has no explicit `target` or `source`
   * and the immediately following hop is a transaction-specific join field (`transactionlines`, `accountingimpact`),
   * the outer hop's `target` is inferred automatically (e.g., `target: "transaction"`).
   *
   * @param {Array<{ fieldId: string, source: string|null, target: string|null }>} hops
   * @returns {Array<{ fieldId: string, source: string|null, target: string|null }>}
   */
  function inferOuterHopTargetsFromChildHops(hops) {
    if (!Array.isArray(hops) || hops.length < 2) return hops;
    for (let i = 0; i < hops.length - 1; i++) {
      const curr = hops[i];
      const next = hops[i + 1];
      if (!curr.source && !curr.target && next && typeof next.fieldId === "string") {
        const nextFieldLower = next.fieldId.toLowerCase();
        if (nextFieldLower === "transactionlines") {
          curr.target = "transaction";
        } else if (nextFieldLower === "accountingimpact") {
          curr.target = "transactionline";
        }
      }
    }
    return hops;
  }

  /**
   * Normalizes a join specification (string dot-path, single join object, or array of join hops)
   * into an array of canonical join hop descriptors: [{ fieldId, source?, target? }, ...]
   * ordered from outermost (root record) to innermost hop.
   *
   * @param {*} rawJoin
   * @returns {Array<{ fieldId: string, source: string|null, target: string|null }>}
   */
  function normalizeDatasetJoinHops(rawJoin) {
    if (!rawJoin) return [];

    if (typeof rawJoin === "string") {
      const trimmed = rawJoin.trim();
      if (!trimmed) return [];
      const parts = trimmed
        .split(".")
        .map((p) => p.trim())
        .filter(Boolean);
      const stringHops = parts.map((fieldId) => {
        const lower = fieldId.toLowerCase();
        const defaultTargets = DEFAULT_POLYMORPHIC_JOIN_TARGETS[lower];
        return {
          fieldId: fieldId,
          source: null,
          target: defaultTargets && defaultTargets.length > 0 ? defaultTargets[0] : null,
        };
      });
      return inferOuterHopTargetsFromChildHops(stringHops);
    }

    if (Array.isArray(rawJoin)) {
      const hops = [];
      for (let i = 0; i < rawJoin.length; i++) {
        const subHops = normalizeDatasetJoinHops(rawJoin[i]);
        for (let j = 0; j < subHops.length; j++) {
          hops.push(subHops[j]);
        }
      }
      return inferOuterHopTargetsFromChildHops(hops);
    }

    if (typeof rawJoin === "object") {
      const fieldId =
        typeof rawJoin.fieldId === "string" && rawJoin.fieldId.trim()
          ? rawJoin.fieldId.trim()
          : typeof rawJoin.name === "string" && rawJoin.name.trim()
            ? rawJoin.name.trim()
            : "";
      if (!fieldId) {
        throw new Error('Each dataset join object must include a non-empty string "fieldId".');
      }

      const source =
        typeof rawJoin.source === "string" && rawJoin.source.trim()
          ? rawJoin.source.trim()
          : null;
      const target =
        typeof rawJoin.target === "string" && rawJoin.target.trim()
          ? rawJoin.target.trim()
          : null;

      if (source && target) {
        throw new Error(
          `Invalid dataset join on field "${fieldId}": "source" (inverse join) and "target" (polymorphic join) are mutually exclusive.`,
        );
      }

      // Auto-translate common native transaction sublist inverse-join mistakes into their canonical SuiteAnalytics forward join field IDs
      const lowerField = fieldId.toLowerCase();
      const lowerSource = source ? source.toLowerCase() : "";
      let resolvedFieldId = fieldId;
      let resolvedSource = source;

      if (lowerField === "transaction" && (lowerSource === "transactionline" || lowerSource === "transactionlines")) {
        resolvedFieldId = "transactionlines";
        resolvedSource = null;
      } else if (
        (lowerField === "transactionline" || lowerField === "transactionlines") &&
        (lowerSource === "transactionaccountingline" || lowerSource === "accountingimpact")
      ) {
        resolvedFieldId = "accountingimpact";
        resolvedSource = null;
      }

      const defaultTargets =
        !resolvedSource && !target ? DEFAULT_POLYMORPHIC_JOIN_TARGETS[resolvedFieldId.toLowerCase()] : null;
      const resolvedTarget =
        target || (defaultTargets && defaultTargets.length > 0 ? defaultTargets[0] : null);

      const currentHop = {
        fieldId: resolvedFieldId,
        source: resolvedSource,
        target: resolvedTarget,
      };

      if (rawJoin.join) {
        return inferOuterHopTargetsFromChildHops([currentHop].concat(normalizeDatasetJoinHops(rawJoin.join)));
      }
      return [currentHop];
    }

    return [];
  }

  /**
   * Builds a human-readable join path string (e.g. "transactionline.item" or "entity<customer>")
   * from an array of normalized join hops.
   *
   * @param {Array<{ fieldId: string, source: string|null, target: string|null }>} hops
   * @returns {string}
   */
  function formatDatasetJoinPath(hops) {
    if (!Array.isArray(hops) || hops.length === 0) return "";
    return hops
      .map((h) => {
        if (h.source) return `${h.source}(${h.fieldId})`;
        if (h.target) return `${h.fieldId}<${h.target}>`;
        return h.fieldId;
      })
      .join(".");
  }

  /**
   * Builds (and caches by canonical signature) a `dataset.Join` object from an array of normalized join hops.
   * Note: In N/dataset, a multi-level join is nested from outermost to innermost:
   * `dataset.createJoin({ fieldId: 'outer', join: dataset.createJoin({ fieldId: 'inner' }) })`.
   *
   * @param {Array<{ fieldId: string, source: string|null, target: string|null }>} hops
   * @param {Object} joinCache
   * @param {boolean} [stripOuterTargets=false]
   * @returns {Object|null}
   */
  function buildDatasetJoinFromHops(hops, joinCache, stripOuterTargets) {
    if (!Array.isArray(hops) || hops.length === 0) return null;

    const buildRecursive = (index) => {
      const slice = hops.slice(index);
      const cacheKey = `${stripOuterTargets ? "STRIP:" : "FULL:"}${JSON.stringify(slice)}`;
      if (joinCache[cacheKey]) {
        return joinCache[cacheKey];
      }

      const hop = hops[index];
      const childJoin = index + 1 < hops.length ? buildRecursive(index + 1) : null;

      const joinOpts = {
        fieldId: hop.fieldId,
      };
      if (hop.source) {
        joinOpts.source = hop.source;
      }
      if (hop.target && !(stripOuterTargets && childJoin)) {
        joinOpts.target = hop.target;
      }
      if (childJoin) {
        joinOpts.join = childJoin;
      }

      const createdJoin = dataset.createJoin(joinOpts);
      joinCache[cacheKey] = createdJoin;
      return createdJoin;
    };

    return buildRecursive(0);
  }

  /**
   * Rebuilds a `dataset.Dataset` object with `stripOuterTargets: true` on all column and condition joins.
   * Used when `N/dataset.save()` throws `"Invalid identifier 'field^target', only alphanumeric and underscore characters are allowed"`
   * on a multi-hop join whose outer hop included `target`.
   *
   * @param {Object} sourceDatasetObj
   * @param {string} effectiveType
   * @returns {Object}
   */
  function rebuildDatasetWithoutOuterHopTargets(sourceDatasetObj, effectiveType) {
    const strippedJoinCache = {};
    const strippedColMap = {};

    const cloneColWithStrippedJoin = (col) => {
      if (!col) return null;
      const hops = extractHopsFromDatasetJoin(col.join || null);
      const sig = getDatasetColumnSignature(col.fieldId || "", hops, col.formula || "", col.type || "");
      if (strippedColMap[sig]) {
        return strippedColMap[sig];
      }
      const colOpts = {};
      if (col.alias) colOpts.alias = col.alias;
      if (col.label) colOpts.label = col.label;
      if (col.id != null) colOpts.id = col.id;
      if (col.formula) {
        colOpts.formula = col.formula;
        if (col.type) colOpts.type = col.type;
      } else if (col.fieldId) {
        colOpts.fieldId = col.fieldId;
        if (hops.length > 0) {
          colOpts.join = buildDatasetJoinFromHops(hops, strippedJoinCache, true);
        }
      }
      const cloned = dataset.createColumn(colOpts);
      strippedColMap[sig] = cloned;
      return cloned;
    };

    const dsCols = Array.isArray(sourceDatasetObj.columns) ? sourceDatasetObj.columns : [];
    const newCols = dsCols.map((c) => cloneColWithStrippedJoin(c)).filter(Boolean);

    const cloneCondWithStrippedJoin = (cond) => {
      if (!cond) return null;
      if (Array.isArray(cond.children) && cond.children.length > 0) {
        return dataset.createCondition({
          operator: cond.operator || "AND",
          children: cond.children.map((ch) => cloneCondWithStrippedJoin(ch)).filter(Boolean),
        });
      }
      const clonedCol = cloneColWithStrippedJoin(cond.column);
      const condOpts = {
        column: clonedCol,
        operator: cond.operator,
      };
      if (
        cond.values !== undefined &&
        cond.values !== null &&
        !(Array.isArray(cond.values) && cond.values.length === 0)
      ) {
        condOpts.values = cond.values;
      }
      if (typeof cond.caseSensitive === "boolean") {
        condOpts.caseSensitive = cond.caseSensitive;
      }
      return dataset.createCondition(condOpts);
    };

    const newCond = sourceDatasetObj.condition ? cloneCondWithStrippedJoin(sourceDatasetObj.condition) : null;

    return dataset.create({
      type: effectiveType,
      columns: newCols,
      ...(newCond ? { condition: newCond } : {}),
    });
  }

  /**
   * Serializes an existing `dataset.Join` object into an array of `{ fieldId, source, target }` hops.
   * Also automatically infers `target` on outer hops when followed by transaction-specific child hops
   * (`transactionlines`, `accountingimpact`) or known polymorphic field defaults, so datasets loaded via
   * `dataset.load` (where NetSuite may omit `target` on outer hops) still execute cleanly via `N/query`.
   *
   * @param {Object|null} joinObj
   * @returns {Array<{ fieldId: string, source: string|null, target: string|null }>}
   */
  function extractHopsFromDatasetJoin(joinObj) {
    const hops = [];
    let curr = joinObj;
    let guard = 0;
    while (curr && typeof curr === "object" && curr.fieldId && guard < 15) {
      guard++;
      const fieldId = String(curr.fieldId);
      const source = curr.source ? String(curr.source) : null;
      let target = curr.target ? String(curr.target) : null;
      if (!source && !target) {
        const defaultTargets = DEFAULT_POLYMORPHIC_JOIN_TARGETS[fieldId.toLowerCase()];
        if (defaultTargets && defaultTargets.length > 0) {
          target = defaultTargets[0];
        }
      }
      hops.push({
        fieldId: fieldId,
        source: source,
        target: target,
      });
      curr = curr.join || null;
    }
    return inferOuterHopTargetsFromChildHops(hops);
  }

  /**
   * Checks whether a column label string is valid (non-empty and not NetSuite's `"<Missing Translation>"` placeholder).
   *
   * @param {*} labelVal
   * @returns {boolean}
   */
  function isValidDatasetColumnLabel(labelVal) {
    if (typeof labelVal !== "string") return false;
    const trimmed = labelVal.trim();
    if (!trimmed) return false;
    if (/^<missing translation>$/i.test(trimmed)) return false;
    return true;
  }

  /**
   * Reconstructs fresh `dataset.Column` and `dataset.Condition` instances from a loaded `dataset.Dataset` object
   * using fresh `dataset.createJoin`, `dataset.createColumn`, and `dataset.createCondition` calls.
   * Why: Passing `existingDataset.columns` or `existingDataset.condition` (from `dataset.load`) directly into
   * a new `dataset.create(...)` object causes NetSuite's `Dataset.save()` to lose column label references
   * (turning labels into `"<Missing Translation>"`) or fail on multi-hop joins.
   *
   * @param {Object} loadedDataset
   * @param {Object} joinCache
   * @param {Object} columnBySignature
   * @param {Object} columnByAlias
   * @param {Object} usedAliases
   * @returns {{ columns: Array<Object>, condition: Object|null }}
   */
  function cloneLoadedDatasetComponents(
    loadedDataset,
    joinCache,
    columnBySignature,
    columnByAlias,
    usedAliases,
  ) {
    const clonedColumns = [];
    const rawCols = loadedDataset && Array.isArray(loadedDataset.columns) ? loadedDataset.columns : [];

    const cloneSingleColumn = (exCol, idx, isConditionOnly) => {
      if (!exCol || typeof exCol !== "object") return null;
      const fieldId = exCol.fieldId ? String(exCol.fieldId).trim() : "";
      const formula = exCol.formula ? String(exCol.formula).trim() : "";
      const formulaType = exCol.type ? resolveDatasetFormulaType(String(exCol.type)) : "";
      const exHops = exCol.join ? extractHopsFromDatasetJoin(exCol.join) : [];

      const sig = getDatasetColumnSignature(fieldId, exHops, formula, formulaType);
      if (isConditionOnly && columnBySignature[sig]) {
        return columnBySignature[sig];
      }

      const rawAlias = exCol.alias ? String(exCol.alias).trim() : null;
      const alias = allocateDatasetColumnAlias(
        rawAlias,
        isConditionOnly && fieldId ? `cond_${fieldId}` : fieldId || null,
        exHops,
        idx,
        usedAliases,
      );

      const colOpts = {
        alias: alias,
      };
      if (isValidDatasetColumnLabel(exCol.label)) {
        colOpts.label = String(exCol.label).trim();
      }
      if (formula) {
        colOpts.formula = formula;
        if (formulaType) colOpts.type = formulaType;
      } else if (fieldId) {
        colOpts.fieldId = fieldId;
        if (exHops.length > 0) {
          colOpts.join = buildDatasetJoinFromHops(exHops, joinCache, false);
        }
      } else {
        return null;
      }

      const created = dataset.createColumn(colOpts);
      if (!columnBySignature[sig]) {
        columnBySignature[sig] = created;
      }
      columnByAlias[alias] = created;
      return created;
    };

    for (let i = 0; i < rawCols.length; i++) {
      const clonedCol = cloneSingleColumn(rawCols[i], i, false);
      if (clonedCol) {
        clonedColumns.push(clonedCol);
      }
    }

    const cloneConditionTree = (exCond) => {
      if (!exCond || typeof exCond !== "object") return null;
      if (Array.isArray(exCond.children) && exCond.children.length > 0) {
        const childClones = exCond.children.map((ch) => cloneConditionTree(ch)).filter(Boolean);
        if (childClones.length === 0) return null;
        return dataset.createCondition({
          operator: exCond.operator ? String(exCond.operator).toUpperCase() : "AND",
          children: childClones,
        });
      }
      if (!exCond.column) return null;
      const condCol = cloneSingleColumn(exCond.column, Object.keys(usedAliases).length, true);
      if (!condCol) return null;
      const condOpts = {
        column: condCol,
        operator: exCond.operator,
      };
      if (
        exCond.values !== undefined &&
        exCond.values !== null &&
        !(Array.isArray(exCond.values) && exCond.values.length === 0)
      ) {
        condOpts.values = exCond.values;
      }
      if (typeof exCond.caseSensitive === "boolean") {
        condOpts.caseSensitive = exCond.caseSensitive;
      }
      return dataset.createCondition(condOpts);
    };

    const clonedCondition =
      loadedDataset && loadedDataset.condition ? cloneConditionTree(loadedDataset.condition) : null;

    return {
      columns: clonedColumns,
      condition: clonedCondition,
    };
  }

  /**
   * Generates a clean, unique column alias for a dataset column if one was not explicitly provided.
   *
   * @param {string|null} requestedAlias
   * @param {string|null} fieldId
   * @param {Array<{ fieldId: string, source: string|null, target: string|null }>} joinHops
   * @param {number} index
   * @param {Object} usedAliases
   * @returns {string}
   */
  function allocateDatasetColumnAlias(requestedAlias, fieldId, joinHops, index, usedAliases) {
    if (requestedAlias && typeof requestedAlias === "string" && requestedAlias.trim()) {
      const cleanReq = requestedAlias.trim();
      usedAliases[cleanReq] = (usedAliases[cleanReq] || 0) + 1;
      return cleanReq;
    }

    const joinPrefix =
      Array.isArray(joinHops) && joinHops.length > 0
        ? joinHops
            .map((h) => h.source || h.target || h.fieldId)
            .join("_") + "_"
        : "";
    const rawBase = fieldId ? `${joinPrefix}${fieldId}` : `formula_${index + 1}`;
    const sanitizedBase = rawBase.replace(/[^a-zA-Z0-9_]/g, "_").replace(/^_+/, "") || `col_${index + 1}`;

    if (!usedAliases[sanitizedBase]) {
      usedAliases[sanitizedBase] = 1;
      return sanitizedBase;
    }

    let counter = usedAliases[sanitizedBase] + 1;
    while (usedAliases[`${sanitizedBase}_${counter}`]) {
      counter++;
    }
    usedAliases[sanitizedBase] = counter;
    const finalAlias = `${sanitizedBase}_${counter}`;
    usedAliases[finalAlias] = 1;
    return finalAlias;
  }

  /**
   * Canonical signature key for a column definition (used to reuse existing dataset.Column instances in conditions).
   *
   * @param {string|null} fieldId
   * @param {Array} joinHops
   * @param {string|null} formula
   * @param {string|null} formulaType
   * @returns {string}
   */
  function getDatasetColumnSignature(fieldId, joinHops, formula, formulaType) {
    if (formula) {
      return `FORMULA:${formula.trim()}|TYPE:${formulaType || ""}`;
    }
    return `FIELD:${(fieldId || "").trim().toLowerCase()}|JOIN:${JSON.stringify(joinHops || [])}`;
  }

  /**
   * Known SuiteAnalytics DATETIME fields that require a datetime string (e.g. "MM/dd/yyyy h:mm a")
   * rather than a date-only string ("MM/dd/yyyy") in N/dataset conditions.
   */
  const KNOWN_DATASET_DATETIME_FIELDS = {
    createddate: true,
    lastmodifieddate: true,
    created: true,
    lastmodified: true,
    datecreated: true,
    systemnotesdate: true,
    date: true, // on systemnote / scriptnote
  };

  /**
   * Formats a JavaScript Date object into the NetSuite account's preferred DATE or DATETIME string via N/format.
   *
   * @param {Date} dateObj
   * @param {boolean} asDateTime
   * @returns {string}
   */
  function formatDatasetDateValue(dateObj, asDateTime) {
    try {
      if (format && typeof format.format === "function" && format.Type) {
        return String(
          format.format({
            value: dateObj,
            type: asDateTime ? format.Type.DATETIME : format.Type.DATE,
          }),
        );
      }
    } catch {
      // Fallback if N/format throws
    }

    const mm = String(dateObj.getMonth() + 1).padStart(2, "0");
    const dd = String(dateObj.getDate()).padStart(2, "0");
    const yyyy = dateObj.getFullYear();
    if (!asDateTime) {
      return `${mm}/${dd}/${yyyy}`;
    }
    let hours = dateObj.getHours();
    const ampm = hours >= 12 ? "pm" : "am";
    hours = hours % 12;
    if (hours === 0) hours = 12;
    const mins = String(dateObj.getMinutes()).padStart(2, "0");
    return `${mm}/${dd}/${yyyy} ${hours}:${mins} ${ampm}`;
  }

  /**
   * Attempts to parse a date-only or datetime string (either ISO "YYYY-MM-DD[THH:mm:ss]" or US "MM/DD/YYYY")
   * into `{ dateObj: Date, hasExplicitTime: boolean }`, or returns null if not a recognized date string.
   *
   * @param {string} rawStr
   * @returns {{ dateObj: Date, hasExplicitTime: boolean } | null}
   */
  function tryParseConditionDateString(rawStr) {
    if (typeof rawStr !== "string") return null;
    const trimmed = rawStr.trim();
    if (!trimmed) return null;

    // 1. Check ISO YYYY-MM-DD or YYYY-MM-DDTHH:mm...
    const isoDate = parseIsoDateString(trimmed);
    if (isoDate) {
      const hasTime = /^\d{4}-\d{2}-\d{2}[T ]\d{1,2}:\d{2}/.test(trimmed);
      return { dateObj: isoDate, hasExplicitTime: hasTime };
    }

    // 2. Check date-only MM/DD/YYYY or M/D/YYYY (without time component)
    const usDateOnlyMatch = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
    if (usDateOnlyMatch) {
      if (format && typeof format.parse === "function" && format.Type) {
        try {
          const parsedByNs = format.parse({
            value: trimmed,
            type: format.Type.DATE,
          });
          if (parsedByNs instanceof Date && !isNaN(parsedByNs.getTime())) {
            return { dateObj: parsedByNs, hasExplicitTime: false };
          }
        } catch {
          // Fall back to manual MM/DD/YYYY parse
        }
      }
      const monthIndex = Number(usDateOnlyMatch[1]) - 1;
      const day = Number(usDateOnlyMatch[2]);
      const year = Number(usDateOnlyMatch[3]);
      const d = new Date(year, monthIndex, day);
      if (!isNaN(d.getTime()) && d.getFullYear() === year && d.getMonth() === monthIndex && d.getDate() === day) {
        return { dateObj: d, hasExplicitTime: false };
      }
    }

    return null;
  }

  /**
   * Normalizes condition values for N/dataset and N/query:
   * - Supports query.RelativeDateRange enum keys (e.g. "TODAY", "LAST_MONTH", "THIS_FISCAL_YEAR") on date operators
   * - Supports relative date objects `{ dateId: "DAYS_AGO", value: 30 }` via query.createRelativeDate
   * - Converts ISO date strings ("YYYY-MM-DD") and ISO datetime strings ("YYYY-MM-DDTHH:mm:ss") into the NetSuite
   *   account's date/datetime preference format via N/format (and upgrades date-only strings to DATETIME format
   *   when filtering on known datetime fields like `createddate` or `lastmodifieddate`, or when `forceDateTimeFormat` is set).
   *
   * @param {*} rawValues
   * @param {string} resolvedOperator
   * @param {string|null} [fieldId]
   * @param {"DATETIME"|"DATE"|null} [forceDateFormatMode]
   * @returns {Array<*>}
   */
  function normalizeDatasetConditionValues(rawValues, resolvedOperator, fieldId, forceDateFormatMode) {
    if (rawValues === undefined || rawValues === null) {
      return [];
    }

    const rawList = Array.isArray(rawValues) ? rawValues : [rawValues];
    const dateOperators = {
      AFTER: true,
      AFTER_NOT: true,
      BEFORE: true,
      BEFORE_NOT: true,
      ON: true,
      ON_NOT: true,
      ON_OR_AFTER: true,
      ON_OR_AFTER_NOT: true,
      ON_OR_BEFORE: true,
      ON_OR_BEFORE_NOT: true,
      WITHIN: true,
      WITHIN_NOT: true,
    };
    const isDateOp = Boolean(dateOperators[resolvedOperator]);
    const lowerField = typeof fieldId === "string" ? fieldId.trim().toLowerCase() : "";
    const isKnownDateTimeField = Boolean(lowerField && KNOWN_DATASET_DATETIME_FIELDS[lowerField]);

    const normalized = [];
    for (let i = 0; i < rawList.length; i++) {
      const item = rawList[i];

      // 1. Check if item is a relative date object: { dateId: "DAYS_AGO", value: 5 }
      if (
        item &&
        typeof item === "object" &&
        !Array.isArray(item) &&
        !(item instanceof Date) &&
        typeof item.dateId === "string" &&
        item.value !== undefined
      ) {
        const rawDateId = item.dateId.trim().toUpperCase();
        const resolvedDateId =
          query.DateId && query.DateId[rawDateId] ? query.DateId[rawDateId] : item.dateId.trim();
        normalized.push(
          query.createRelativeDate({
            dateId: resolvedDateId,
            value: Number(item.value),
          }),
        );
        continue;
      }

      // 2. Check if item is a string matching query.RelativeDateRange (e.g., "TODAY", "THIS_MONTH" or "RelativeDateRange.TODAY")
      if (typeof item === "string" && query.RelativeDateRange) {
        const trimmed = item.trim();
        const stripped = trimmed.replace(/^(?:query\.)?RelativeDateRange\./i, "").toUpperCase();
        if (
          (isDateOp || /^RelativeDateRange\./i.test(trimmed)) &&
          Object.prototype.hasOwnProperty.call(query.RelativeDateRange, stripped)
        ) {
          normalized.push(query.RelativeDateRange[stripped]);
          continue;
        }
      }

      // 3. Check if item is an ISO date/datetime string (or date-only string on a datetime field / retry)
      if (typeof item === "string") {
        const parsedDateInfo = tryParseConditionDateString(item);
        if (parsedDateInfo) {
          const isIsoInput = /^\d{4}-\d{2}-\d{2}/.test(item.trim());
          const shouldFormatAsDateTime =
            forceDateFormatMode === "DATETIME" ||
            (forceDateFormatMode !== "DATE" && (parsedDateInfo.hasExplicitTime || isKnownDateTimeField));

          if (isIsoInput || shouldFormatAsDateTime || forceDateFormatMode === "DATE") {
            normalized.push(formatDatasetDateValue(parsedDateInfo.dateObj, shouldFormatAsDateTime));
            continue;
          }
        }
      }

      normalized.push(item);
    }

    return normalized;
  }

  /**
   * Builds a `dataset.Condition` recursively from either:
   * - A logical group node: `{ operator: "AND" | "OR", children: [...] }`
   * - A leaf filter object: `{ fieldId (or name), join?, formula?, type?, alias?, operator, values? (or value?), caseSensitive? }`
   *
   * Automatically reuses an existing `dataset.Column` from `columnBySignature` or `columnByAlias` if available,
   * or creates a new `dataset.Column` for the condition.
   *
   * @param {Object} condDef
   * @param {Object} joinCache
   * @param {Object} columnBySignature
   * @param {Object} columnByAlias
   * @param {Object} usedAliases
   * @param {string} pathLabel
   * @param {"DATETIME"|"DATE"|null} [forceDateFormatMode]
   * @returns {Object}
   */
  function buildDatasetConditionNode(
    condDef,
    joinCache,
    columnBySignature,
    columnByAlias,
    usedAliases,
    pathLabel,
    forceDateFormatMode,
  ) {
    if (!condDef || typeof condDef !== "object" || Array.isArray(condDef)) {
      throw new Error(`Invalid condition at ${pathLabel}: expected a condition object.`);
    }

    const rawOp = typeof condDef.operator === "string" ? condDef.operator.trim() : "";
    const hasChildren = Array.isArray(condDef.children);

    // 1. Logical Group Condition (AND / OR with children)
    if (hasChildren || rawOp.toUpperCase() === "AND" || rawOp.toUpperCase() === "OR") {
      const groupOp = rawOp ? rawOp.toUpperCase() : "AND";
      if (groupOp !== "AND" && groupOp !== "OR") {
        throw new Error(
          `Invalid logical group operator "${rawOp}" at ${pathLabel}: top-level/group conditions in N/dataset must use "AND" or "OR".`,
        );
      }
      if (!Array.isArray(condDef.children) || condDef.children.length === 0) {
        throw new Error(
          `Invalid logical condition group at ${pathLabel}: "children" must be a non-empty array of condition objects when operator is "${groupOp}".`,
        );
      }

      const childConditions = [];
      for (let i = 0; i < condDef.children.length; i++) {
        childConditions.push(
          buildDatasetConditionNode(
            condDef.children[i],
            joinCache,
            columnBySignature,
            columnByAlias,
            usedAliases,
            `${pathLabel}.children[${i}]`,
            forceDateFormatMode,
          ),
        );
      }

      return dataset.createCondition({
        operator: groupOp,
        children: childConditions,
      });
    }

    // 2. Leaf Column Condition
    if (!rawOp) {
      throw new Error(
        `Missing required "operator" at ${pathLabel} (e.g., "EQUAL", "ANY_OF", "IS", "CONTAIN", "EMPTY", "GREATER_OR_EQUAL", "WITHIN").`,
      );
    }

    const resolvedOp = resolveDatasetOperator(rawOp);
    const unaryOperators = {
      EMPTY: true,
      EMPTY_NOT: true,
    };

    let targetColumn = null;

    // 2a. Check if the condition references an existing column by alias
    const colAliasRef =
      typeof condDef.columnAlias === "string" && condDef.columnAlias.trim()
        ? condDef.columnAlias.trim()
        : typeof condDef.alias === "string" && condDef.alias.trim() && !condDef.fieldId && !condDef.name && !condDef.formula
          ? condDef.alias.trim()
          : "";

    if (colAliasRef && columnByAlias[colAliasRef]) {
      targetColumn = columnByAlias[colAliasRef];
    }

    // 2b. Otherwise resolve or create the dataset.Column by fieldId/join or formula/type
    if (!targetColumn) {
      const fieldId =
        typeof condDef.fieldId === "string" && condDef.fieldId.trim()
          ? condDef.fieldId.trim()
          : typeof condDef.name === "string" && condDef.name.trim()
            ? condDef.name.trim()
            : "";
      const formula =
        typeof condDef.formula === "string" && condDef.formula.trim()
          ? condDef.formula.trim()
          : "";
      const formulaType =
        typeof condDef.type === "string" && condDef.type.trim()
          ? resolveDatasetFormulaType(condDef.type)
          : "";

      if (!fieldId && !formula) {
        throw new Error(
          `Invalid condition at ${pathLabel}: specify "fieldId" (or "formula" + "type", or "columnAlias" matching a defined column).`,
        );
      }

      if (fieldId && formula) {
        throw new Error(
          `Invalid condition at ${pathLabel}: "fieldId" and "formula" are mutually exclusive in N/dataset.`,
        );
      }

      const joinHops = normalizeDatasetJoinHops(condDef.join);
      if (formula && joinHops.length > 0) {
        throw new Error(
          `Invalid condition at ${pathLabel}: N/dataset does not allow "formula" and "join" on the same column.`,
        );
      }

      const sig = getDatasetColumnSignature(fieldId, joinHops, formula, formulaType);
      if (columnBySignature[sig]) {
        targetColumn = columnBySignature[sig];
      } else {
        const condAlias = allocateDatasetColumnAlias(
          null,
          fieldId ? `cond_${fieldId}` : null,
          joinHops,
          Object.keys(usedAliases || {}).length,
          usedAliases || {},
        );
        const colOptions = {
          alias: condAlias,
        };
        if (formula) {
          if (!formulaType) {
            throw new Error(
              `Invalid formula condition at ${pathLabel}: "type" (e.g., "STRING", "INTEGER", "FLOAT", "CURRENCY", "DATE", "BOOLEAN") is required when "formula" is specified.`,
            );
          }
          colOptions.formula = formula;
          colOptions.type = formulaType;
        } else {
          colOptions.fieldId = fieldId;
          if (joinHops.length > 0) {
            colOptions.join = buildDatasetJoinFromHops(joinHops, joinCache);
          }
        }
        try {
          targetColumn = dataset.createColumn(colOptions);
          columnBySignature[sig] = targetColumn;
        } catch (colErr) {
          const desc = formula ? `formula "${formula}"` : joinHops.length > 0 ? `${formatDatasetJoinPath(joinHops)}.${fieldId}` : fieldId;
          throw new Error(
            `Invalid field/column in condition at ${pathLabel} (${desc}): ${extractFieldsFromErrorMessage(getErrorMessage(colErr))}`,
          );
        }
      }
    }

    const rawVals =
      condDef.values !== undefined
        ? condDef.values
        : condDef.value !== undefined
          ? condDef.value
          : undefined;
    const targetFieldIdForDate =
      (targetColumn && targetColumn.fieldId) ||
      (typeof condDef.fieldId === "string" ? condDef.fieldId : typeof condDef.name === "string" ? condDef.name : null);
    const normalizedValues = normalizeDatasetConditionValues(
      rawVals,
      resolvedOp,
      targetFieldIdForDate,
      forceDateFormatMode || null,
    );

    const conditionOptions = {
      column: targetColumn,
      operator: resolvedOp,
    };

    if (!unaryOperators[resolvedOp]) {
      if (normalizedValues.length === 0) {
        throw new Error(
          `Condition at ${pathLabel} with operator "${resolvedOp}" requires "values" (use "EMPTY" or "EMPTY_NOT" for unary null checks).`,
        );
      }
      conditionOptions.values = normalizedValues;
    }

    if (typeof condDef.caseSensitive === "boolean") {
      conditionOptions.caseSensitive = condDef.caseSensitive;
    }

    try {
      return dataset.createCondition(conditionOptions);
    } catch (condErr) {
      throw new Error(
        `Invalid condition at ${pathLabel} (operator "${resolvedOp}"): ${extractFieldsFromErrorMessage(getErrorMessage(condErr))}`,
      );
    }
  }

  /**
   * Serializes a `dataset.Condition` tree into a clean JSON summary for the tool response.
   *
   * @param {Object|null} condObj
   * @returns {Object|null}
   */
  function serializeDatasetCondition(condObj) {
    if (!condObj || typeof condObj !== "object") return null;

    if (Array.isArray(condObj.children) && condObj.children.length > 0) {
      return {
        operator: condObj.operator || "AND",
        children: condObj.children.map((c) => serializeDatasetCondition(c)).filter(Boolean),
      };
    }

    const col = condObj.column;
    const joinHops = col && col.join ? extractHopsFromDatasetJoin(col.join) : [];
    return {
      ...(col && col.fieldId ? { fieldId: col.fieldId } : {}),
      ...(joinHops.length > 0 ? { join: joinHops, joinPath: formatDatasetJoinPath(joinHops) } : {}),
      ...(col && col.formula ? { formula: col.formula, type: col.type || null } : {}),
      ...(col && col.alias ? { columnAlias: col.alias } : {}),
      operator: condObj.operator || null,
      ...(condObj.values !== undefined ? { values: condObj.values } : {}),
      ...(typeof condObj.caseSensitive === "boolean" ? { caseSensitive: condObj.caseSensitive } : {}),
    };
  }

  /**
   * Checks whether a dataset description value is a valid user-authored string
   * (non-empty and not a Rhino Java Lambda reference like `com.netsuite.analytics...$$Lambda...`).
   *
   * @param {*} val
   * @returns {boolean}
   */
  function isRealDatasetDescription(val) {
    if (typeof val !== "string") return false;
    const trimmed = val.trim();
    if (!trimmed) return false;
    if (trimmed.includes("$$Lambda") || /^com\.netsuite\./i.test(trimmed)) return false;
    return true;
  }

  /**
   * Looks up the saved `name` and `description` of an existing dataset by its scriptId
   * using `dataset.list()`, `query.load({ id })`, and `dataset.describe({ id })`.
   * Note: In NetSuite's `N/dataset` module, `dataset.load({ id }).name` returns the literal placeholder
   * `"SuiteScript dataset"` and `dataset.describe({ id }).description` / `dataset.load({ id }).description`
   * can return a Rhino Java Lambda string (`com.netsuite.analytics...$$Lambda...`), whereas `dataset.list()`
   * returns the true saved `name` and `description` strings.
   *
   * @param {string} scriptId
   * @returns {{ name: string|null, description: string|null }}
   */
  function lookupExistingDatasetMetadata(scriptId) {
    if (!scriptId) return { name: null, description: null };
    const lowerTarget = String(scriptId).trim().toLowerCase();
    let foundName = null;
    let foundDescription = null;

    const isRealDatasetName = (val) =>
      typeof val === "string" &&
      val.trim() !== "" &&
      val.trim() !== "SuiteScript dataset" &&
      !val.includes("$$Lambda") &&
      !/^com\.netsuite\./i.test(val.trim());

    // 1. Check dataset.list() first (most reliable for both name and description)
    try {
      if (typeof dataset.list === "function") {
        const list = dataset.list();
        if (Array.isArray(list)) {
          for (let i = 0; i < list.length; i++) {
            const item = list[i];
            if (!item || typeof item !== "object") continue;
            const itemId = item.id != null ? String(item.id).trim().toLowerCase() : "";
            const itemScriptId = item.scriptId != null ? String(item.scriptId).trim().toLowerCase() : "";
            if (itemId === lowerTarget || itemScriptId === lowerTarget) {
              if (isRealDatasetName(item.name)) {
                foundName = String(item.name).trim();
              }
              if (isRealDatasetDescription(item.description)) {
                foundDescription = String(item.description);
              }
              break;
            }
          }
        }
      }
    } catch {
      // Ignore dataset.list lookup errors
    }

    // 2. Fallback: Check query.load({ id }).name
    if (!foundName) {
      try {
        if (query && typeof query.load === "function") {
          const qLoaded = query.load({ id: scriptId });
          if (qLoaded && isRealDatasetName(qLoaded.name)) {
            foundName = String(qLoaded.name).trim();
          }
        }
      } catch {
        // Ignore query.load lookup errors
      }
    }

    // 3. Fallback: Check dataset.describe({ id })
    if (!foundName || foundDescription === null) {
      try {
        if (typeof dataset.describe === "function") {
          const desc = dataset.describe({ id: scriptId });
          const descObj = Array.isArray(desc) ? desc[0] : desc;
          if (descObj && typeof descObj === "object") {
            if (!foundName && isRealDatasetName(descObj.name)) {
              foundName = String(descObj.name).trim();
            }
            if (foundDescription === null && isRealDatasetDescription(descObj.description)) {
              foundDescription = String(descObj.description);
            }
          }
        }
      } catch {
        // Ignore dataset.describe lookup errors
      }
    }

    return { name: foundName, description: foundDescription };
  }

  /**
   * Builds an in-memory `N/query.Query` mirror from a `dataset.Dataset` object's `type`, `columns`, and `condition`.
   * Used both to generate the equivalent SuiteQL (`qObj.toSuiteQL()`) and as a preview execution fallback
   * (`qObj.runPaged()` / `qObj.run()`) when NetSuite's `datasetObj.run()` fails on multi-hop `dataset.Join` chains.
   *
   * @param {Object} datasetObj
   * @returns {Object} The constructed `query.Query` object.
   */
  function buildMirrorQueryFromDataset(datasetObj) {
    if (!datasetObj || !datasetObj.type) {
      throw new Error("Dataset object is missing a valid record type.");
    }

    const qObj = query.create({ type: datasetObj.type });
    const componentCache = {};

    const resolveQueryComponent = (joinObj) => {
      if (!joinObj) return qObj;
      const hops = extractHopsFromDatasetJoin(joinObj);
      if (hops.length === 0) return qObj;

      let currComp = qObj;
      const pathSoFar = [];

      for (let i = 0; i < hops.length; i++) {
        const hop = hops[i];
        pathSoFar.push(hop);
        const key = JSON.stringify(pathSoFar);

        if (componentCache[key]) {
          currComp = componentCache[key];
          continue;
        }

        let nextComp = null;
        if (hop.source) {
          nextComp = currComp.joinFrom({
            fieldId: hop.fieldId,
            source: hop.source,
          });
        } else if (hop.target) {
          try {
            nextComp = currComp.joinTo({
              fieldId: hop.fieldId,
              target: hop.target,
            });
          } catch {
            // If the field is a single-target join where joinTo is not needed, fall back to autoJoin
            nextComp = currComp.autoJoin({
              fieldId: hop.fieldId,
            });
          }
        } else {
          try {
            nextComp = currComp.autoJoin({
              fieldId: hop.fieldId,
            });
          } catch (autoJoinErr) {
            // If autoJoin fails because `hop.fieldId` is a polymorphic field (e.g. `transactionlines.item` or `entity`)
            // and the caller used dot-notation without specifying `target`, automatically try known polymorphic targets
            const lowerHopField = hop.fieldId.toLowerCase();
            const candidateTargets = (DEFAULT_POLYMORPHIC_JOIN_TARGETS[lowerHopField] || []).concat([
              lowerHopField,
            ]);
            for (let tIdx = 0; tIdx < candidateTargets.length; tIdx++) {
              try {
                nextComp = currComp.joinTo({
                  fieldId: hop.fieldId,
                  target: candidateTargets[tIdx],
                });
                if (nextComp) break;
              } catch {
                // Try next target candidate
              }
            }
            if (!nextComp) {
              throw autoJoinErr;
            }
          }
        }

        componentCache[key] = nextComp;
        currComp = nextComp;
      }

      return currComp;
    };

    const dsColumns = Array.isArray(datasetObj.columns) ? datasetObj.columns : [];
    const qColumns = [];
    for (let i = 0; i < dsColumns.length; i++) {
      const col = dsColumns[i];
      const comp = resolveQueryComponent(col.join || null);
      const colOpts = {};
      if (col.formula) {
        colOpts.formula = col.formula;
        if (col.type) colOpts.type = col.type;
      } else if (col.fieldId) {
        colOpts.fieldId = col.fieldId;
      } else {
        continue;
      }
      if (col.alias) colOpts.alias = col.alias;
      if (col.label) colOpts.label = col.label;
      qColumns.push(comp.createColumn(colOpts));
    }
    qObj.columns = qColumns;

    const buildMirrorQueryCondition = (dsCond) => {
      if (!dsCond) return null;
      if (Array.isArray(dsCond.children) && dsCond.children.length > 0) {
        const childQConds = dsCond.children
          .map((c) => buildMirrorQueryCondition(c))
          .filter(Boolean);
        if (childQConds.length === 0) return null;
        const op = String(dsCond.operator || "AND").toUpperCase();
        if (op === "OR") {
          return qObj.or.apply(qObj, childQConds);
        }
        return qObj.and.apply(qObj, childQConds);
      }

      const col = dsCond.column;
      if (!col) return null;
      const comp = resolveQueryComponent(col.join || null);
      const condOpts = {
        operator: dsCond.operator,
      };
      if (col.formula) {
        condOpts.formula = col.formula;
        if (col.type) condOpts.type = col.type;
      } else if (col.fieldId) {
        condOpts.fieldId = col.fieldId;
      } else {
        return null;
      }

      if (
        dsCond.values !== undefined &&
        dsCond.values !== null &&
        !(Array.isArray(dsCond.values) && dsCond.values.length === 0)
      ) {
        condOpts.values = dsCond.values;
      }

      return comp.createCondition(condOpts);
    };

    if (datasetObj.condition) {
      const mirroredCond = buildMirrorQueryCondition(datasetObj.condition);
      if (mirroredCond) {
        qObj.condition = mirroredCond;
      }
    }

    return qObj;
  }

  /**
   * Attempts to generate the equivalent SuiteQL string for a dataset definition.
   * 1. If a saved/existing dataset ID is available and unmodified (or just saved), tries `query.load({ id }).toSuiteQL()`.
   * 2. For in-memory dry-runs, constructs a parallel `N/query` object from the dataset's type, columns, and condition
   *    and calls `queryObj.toSuiteQL()`.
   * Never throws—returns `{ query: string|null, params: Array|null }`.
   *
   * @param {Object} datasetObj
   * @param {string|null} savedOrExistingId
   * @param {boolean} canLoadByIdDirectly
   * @returns {{ query: string|null, params: Array<*>|null }}
   */
  function tryGenerateDatasetSuiteQL(datasetObj, savedOrExistingId, canLoadByIdDirectly) {
    // 1. If the dataset was just saved or loaded without in-memory modifications, query.load({ id }).toSuiteQL() is authoritative
    if (canLoadByIdDirectly && savedOrExistingId) {
      try {
        const loadedQuery = query.load({ id: savedOrExistingId });
        if (loadedQuery && typeof loadedQuery.toSuiteQL === "function") {
          const suiteQlObj = loadedQuery.toSuiteQL();
          if (suiteQlObj && suiteQlObj.query) {
            return {
              query: String(suiteQlObj.query),
              params: Array.isArray(suiteQlObj.params) && suiteQlObj.params.length > 0 ? suiteQlObj.params : null,
            };
          }
        }
      } catch {
        // Fall through to in-memory N/query mirror
      }
    }

    // 2. Build an in-memory N/query mirror from datasetObj.type, datasetObj.columns, and datasetObj.condition
    try {
      const qObj = buildMirrorQueryFromDataset(datasetObj);
      if (qObj && typeof qObj.toSuiteQL === "function") {
        const suiteQlObj = qObj.toSuiteQL();
        if (suiteQlObj && suiteQlObj.query) {
          return {
            query: String(suiteQlObj.query),
            params: Array.isArray(suiteQlObj.params) && suiteQlObj.params.length > 0 ? suiteQlObj.params : null,
          };
        }
      }
    } catch {
      // Ignore if N/query conversion is not supported for a specific formula/join
    }

    return { query: null, params: null };
  }

  /**
   * Builds a stable, descriptive key for a dataset column in preview row output.
   *
   * @param {Object} colMeta
   * @param {number} index
   * @param {Object} usedKeys
   * @returns {string}
   */
  function buildDatasetPreviewColumnKey(colMeta, index, usedKeys) {
    const label = colMeta.label != null && String(colMeta.label).trim() !== "" ? String(colMeta.label).trim() : "";
    const joinPrefix = colMeta.joinPath ? `${colMeta.joinPath}.` : "";
    const fieldPart = colMeta.fieldId || colMeta.alias || `column_${index + 1}`;
    const baseKey = label || `${joinPrefix}${fieldPart}`;

    if (!usedKeys[baseKey]) {
      usedKeys[baseKey] = 1;
      return baseKey;
    }
    usedKeys[baseKey] += 1;
    return `${baseKey}_${usedKeys[baseKey]}`;
  }

  /**
   * ACTION: CREATE_DATASET
   * Builds, dry-runs (previews), and saves or updates a NetSuite SuiteAnalytics Dataset via N/dataset.
   * When dryRun is true (default), executes the dataset in-memory without saving and returns the total
   * match count, first maxRows preview rows, and generated SuiteQL query.
   * When dryRun is false, creates a new dataset (or updates an existing one when overwrite is true)
   * and returns the saved dataset scriptId, SuiteAnalytics Workbook Dataset URL, preview rows, and metrics.
   *
   * @param {Object} request
   * @param {string} [request.type]
   * @param {string} [request.recordType]
   * @param {Array<Object|string>} [request.columns]
   * @param {Array<Object>} [request.filters]
   * @param {Object} [request.condition]
   * @param {boolean} [request.dryRun=true]
   * @param {number} [request.maxRows=25]
   * @param {string} [request.name]
   * @param {string} [request.title]
   * @param {string} [request.description]
   * @param {string} [request.id]
   * @param {string} [request.scriptId]
   * @param {boolean} [request.overwrite=false]
   * @returns {Object}
   */
  function handleCreateDataset(request) {
    const datasetType =
      typeof request.type === "string" && request.type.trim()
        ? request.type.trim().toLowerCase()
        : typeof request.recordType === "string" && request.recordType.trim()
          ? request.recordType.trim().toLowerCase()
          : "";

    const rawIdInput =
      request.scriptId != null && String(request.scriptId).trim() !== ""
        ? String(request.scriptId).trim()
        : request.id != null && String(request.id).trim() !== ""
          ? String(request.id).trim()
          : "";
    const normalizedScriptId = normalizeDatasetScriptId(rawIdInput);
    const isDryRun = request.dryRun !== undefined ? Boolean(request.dryRun) : true;
    const overwrite = Boolean(request.overwrite);

    const datasetName =
      typeof request.name === "string" && request.name.trim()
        ? request.name.trim()
        : typeof request.title === "string" && request.title.trim()
          ? request.title.trim()
          : "";
    const hasExplicitDescription = request.description !== undefined && request.description !== null;
    const datasetDescription = hasExplicitDescription ? String(request.description) : undefined;

    const hasExplicitColumns = request.columns !== undefined && request.columns !== null;
    const hasExplicitFilters = request.filters !== undefined && request.filters !== null;
    const hasExplicitCondition = request.condition !== undefined && request.condition !== null;

    if (!datasetType && !(overwrite && normalizedScriptId)) {
      return makeErrorResponse(
        'Missing or invalid dataset "type" (e.g., "transaction", "customer", "item", "employee", "customrecord_...").',
      );
    }

    if (hasExplicitColumns) {
      if (!Array.isArray(request.columns) || request.columns.length === 0) {
        return makeErrorResponse('Invalid "columns": expected a non-empty array of dataset column definitions.');
      }
    } else if (!(overwrite && normalizedScriptId)) {
      return makeErrorResponse('Missing required "columns": expected a non-empty array of dataset column definitions.');
    }

    if (hasExplicitFilters && hasExplicitCondition) {
      const nonEmptyFilters = Array.isArray(request.filters) && request.filters.length > 0;
      const nonEmptyCondition =
        typeof request.condition === "object" && Object.keys(request.condition).length > 0;
      if (nonEmptyFilters && nonEmptyCondition) {
        return makeErrorResponse(
          'Provide either "filters" (flat array of AND conditions) OR "condition" (nested AND/OR condition tree), not both.',
        );
      }
    }

    if (!isDryRun && !datasetName && !overwrite) {
      return makeErrorResponse('Missing required "name" (or "title") when saving a dataset (dryRun: false).');
    }

    const rawMaxRows =
      request.maxRows != null ? Number(request.maxRows) : request.limit != null ? Number(request.limit) : 25;
    const maxRows = !isNaN(rawMaxRows) && rawMaxRows >= 0 ? Math.min(Math.floor(rawMaxRows), 1000) : 25;

    try {
      const script = runtime.getCurrentScript();
      const startGovernance = script.getRemainingUsage();
      const timer = new ExecutionTimer();

      const joinCache = {};
      const columnBySignature = {};
      const columnByAlias = {};
      const usedAliases = {};

      // 1. If overwrite: true and scriptId is provided, attempt to load existing dataset first
      let existingDataset = null;
      let existingLoaded = false;
      let existingMeta = { name: null, description: null };
      if (overwrite && normalizedScriptId) {
        try {
          existingDataset = dataset.load({ id: normalizedScriptId });
          existingLoaded = true;
          existingMeta = lookupExistingDatasetMetadata(normalizedScriptId);
        } catch (loadErr) {
          if (!datasetType) {
            return makeErrorResponse(
              `Unable to load existing dataset "${normalizedScriptId}" for update: ${extractFieldsFromErrorMessage(getErrorMessage(loadErr))}`,
            );
          }
          existingDataset = null;
        }
      }

      const effectiveType =
        datasetType || (existingDataset && existingDataset.type ? String(existingDataset.type) : "");
      if (!effectiveType) {
        return makeErrorResponse('Unable to determine dataset base record "type".');
      }

      if (
        existingDataset &&
        datasetType &&
        existingDataset.type &&
        String(existingDataset.type).toLowerCase() !== datasetType.toLowerCase()
      ) {
        return makeErrorResponse(
          `Cannot change base record "type" of existing dataset "${normalizedScriptId}" from "${existingDataset.type}" to "${datasetType}". Create a new dataset with a different scriptId instead.`,
        );
      }

      // 2. Construct N/dataset columns (or clone fresh columns from existingDataset when omitted on overwrite)
      // Note: When `existingDataset` is loaded via `dataset.load({ id })`, its `.columns` and `.condition` objects
      // contain internal label translation handles that become `"<Missing Translation>"` if passed directly into a new
      // `dataset.create(...)` and `.save(...)` call! Therefore, whenever `columns` or `condition` are inherited from
      // `existingDataset`, we clone them into fresh `dataset.createColumn` / `dataset.createCondition` instances.
      let clonedExistingComponents = null;
      const getClonedExistingComponents = () => {
        if (!clonedExistingComponents && existingDataset) {
          clonedExistingComponents = cloneLoadedDatasetComponents(
            existingDataset,
            joinCache,
            columnBySignature,
            columnByAlias,
            usedAliases,
          );
        }
        return clonedExistingComponents;
      };

      const createdColumns = [];
      if (hasExplicitColumns) {
        for (let i = 0; i < request.columns.length; i++) {
          const rawCol = request.columns[i];
          const colDef =
            typeof rawCol === "string" && rawCol.trim()
              ? { fieldId: rawCol.trim() }
              : rawCol;

          if (!colDef || typeof colDef !== "object" || Array.isArray(colDef)) {
            return makeErrorResponse(
              `Invalid dataset column at index ${i}: expected a column object with "fieldId" (or "formula" + "type").`,
            );
          }

          const fieldId =
            typeof colDef.fieldId === "string" && colDef.fieldId.trim()
              ? colDef.fieldId.trim()
              : typeof colDef.name === "string" && colDef.name.trim()
                ? colDef.name.trim()
                : "";
          const formula =
            typeof colDef.formula === "string" && colDef.formula.trim()
              ? colDef.formula.trim()
              : "";
          const rawFormulaType =
            typeof colDef.type === "string" && colDef.type.trim()
              ? colDef.type.trim()
              : typeof colDef.returnType === "string" && colDef.returnType.trim()
                ? colDef.returnType.trim()
                : "";
          const resolvedFormulaType = rawFormulaType ? resolveDatasetFormulaType(rawFormulaType) : "";

          if (!fieldId && !formula) {
            return makeErrorResponse(
              `Invalid dataset column at index ${i}: each column must specify either "fieldId" or "formula" (with "type").`,
            );
          }
          if (fieldId && formula) {
            return makeErrorResponse(
              `Invalid dataset column at index ${i}: "fieldId" and "formula" are mutually exclusive in N/dataset.`,
            );
          }

          let joinHops = [];
          try {
            joinHops = normalizeDatasetJoinHops(colDef.join);
          } catch (joinErr) {
            return makeErrorResponse(`Invalid "join" on column at index ${i}: ${getErrorMessage(joinErr)}`);
          }

          if (formula && joinHops.length > 0) {
            return makeErrorResponse(
              `Invalid dataset column at index ${i}: N/dataset does not allow "formula" and "join" on the same column. Reference joined fields inside the formula or remove "join".`,
            );
          }

          const alias = allocateDatasetColumnAlias(colDef.alias, fieldId, joinHops, i, usedAliases);
          const colOptions = {
            alias: alias,
          };

          if (isValidDatasetColumnLabel(colDef.label)) {
            colOptions.label = colDef.label.trim();
          }
          if (typeof colDef.id === "number" && !isNaN(colDef.id)) {
            colOptions.id = colDef.id;
          }

          if (formula) {
            if (!resolvedFormulaType) {
              return makeErrorResponse(
                `Invalid formula column at index ${i} ("${formula}"): "type" (e.g., "STRING", "INTEGER", "FLOAT", "CURRENCY", "PERCENT", "DATE", "DATETIME", "BOOLEAN") is required for formula columns in N/dataset.`,
              );
            }
            colOptions.formula = formula;
            colOptions.type = resolvedFormulaType;
          } else {
            colOptions.fieldId = fieldId;
            if (joinHops.length > 0) {
              try {
                colOptions.join = buildDatasetJoinFromHops(joinHops, joinCache);
              } catch (joinBuildErr) {
                return makeErrorResponse(
                  `Invalid join "${formatDatasetJoinPath(joinHops)}" on column at index ${i} ("${fieldId}"): ${extractFieldsFromErrorMessage(getErrorMessage(joinBuildErr))}`,
                );
              }
            }
          }

          try {
            const createdCol = dataset.createColumn(colOptions);
            createdColumns.push(createdCol);
            const sig = getDatasetColumnSignature(fieldId, joinHops, formula, resolvedFormulaType);
            if (!columnBySignature[sig]) {
              columnBySignature[sig] = createdCol;
            }
            columnByAlias[alias] = createdCol;
          } catch (colErr) {
            const colDesc = formula
              ? `formula "${formula}"`
              : joinHops.length > 0
                ? `${formatDatasetJoinPath(joinHops)}.${fieldId}`
                : fieldId;
            return makeErrorResponse(
              `Invalid dataset column at index ${i} ("${colDesc}"): ${extractFieldsFromErrorMessage(getErrorMessage(colErr))}`,
            );
          }
        }
      } else if (existingDataset) {
        const cloned = getClonedExistingComponents();
        if (cloned && Array.isArray(cloned.columns)) {
          for (let i = 0; i < cloned.columns.length; i++) {
            createdColumns.push(cloned.columns[i]);
          }
        }
      }

      if (createdColumns.length === 0) {
        return makeErrorResponse('Missing required "columns": dataset must contain at least one column.');
      }

      // 3. Construct N/dataset condition from `condition` or `filters` (or preserve existingDataset.condition)
      let finalCondition = null;
      let shouldClearCondition = false;

      const buildRequestedCondition = (forceDateFormatMode) => {
        if (hasExplicitCondition) {
          if (
            request.condition === null ||
            (typeof request.condition === "object" && Object.keys(request.condition).length === 0)
          ) {
            shouldClearCondition = true;
            return null;
          }
          return buildDatasetConditionNode(
            request.condition,
            joinCache,
            columnBySignature,
            columnByAlias,
            usedAliases,
            "condition",
            forceDateFormatMode,
          );
        } else if (hasExplicitFilters) {
          if (!Array.isArray(request.filters)) {
            throw new Error('Invalid "filters": expected an array of filter condition objects.');
          }
          if (request.filters.length === 0) {
            shouldClearCondition = true;
            return null;
          }
          const leafConditions = [];
          for (let i = 0; i < request.filters.length; i++) {
            leafConditions.push(
              buildDatasetConditionNode(
                request.filters[i],
                joinCache,
                columnBySignature,
                columnByAlias,
                usedAliases,
                `filters[${i}]`,
                forceDateFormatMode,
              ),
            );
          }

          if (leafConditions.length === 1) {
            return leafConditions[0];
          }
          return dataset.createCondition({
            operator: "AND",
            children: leafConditions,
          });
        } else if (existingDataset && existingDataset.condition && !shouldClearCondition) {
          const cloned = getClonedExistingComponents();
          return cloned && cloned.condition ? cloned.condition : null;
        }
        return null;
      };

      try {
        finalCondition = buildRequestedCondition(null);
      } catch (condBuildErr) {
        return makeErrorResponse(extractFieldsFromErrorMessage(getErrorMessage(condBuildErr)));
      }

      // 4. Create or update the dataset object
      // Note: On a dataset loaded via `dataset.load({ id })`, `.name`, `.description`, `.id`, and `.type`
      // are read-only getters in NetSuite's N/dataset runtime (and `existingDataset.name` returns the literal
      // placeholder `"SuiteScript dataset"` unless resolved via `dataset.list()`).
      let datasetObj = null;
      let operation = isDryRun ? "dry_run" : existingLoaded ? "update" : "create";

      const loadedDatasetName =
        existingMeta.name ||
        (existingDataset &&
        existingDataset.name &&
        String(existingDataset.name) !== "SuiteScript dataset"
          ? String(existingDataset.name)
          : null);
      const loadedDatasetDescription =
        existingMeta.description !== null
          ? existingMeta.description
          : existingDataset && isRealDatasetDescription(existingDataset.description)
            ? String(existingDataset.description)
            : null;

      const resolvedScriptId =
        normalizedScriptId || (existingDataset && existingDataset.id ? String(existingDataset.id) : null);
      const resolvedName =
        datasetName ||
        loadedDatasetName ||
        (!isDryRun && resolvedScriptId ? resolvedScriptId : null);
      const resolvedDescription =
        datasetDescription !== undefined ? datasetDescription : loadedDatasetDescription;

      if (!isDryRun && !resolvedName) {
        return makeErrorResponse('Missing required "name" (or "title") when saving a dataset (dryRun: false).');
      }

      const isUnmodifiedExisting =
        existingLoaded && !hasExplicitColumns && !hasExplicitFilters && !hasExplicitCondition;

      // IMPORTANT: Per Oracle's Workbook API documentation (article_163353416302.html), `name`, `description`, and `id`
      // on `dataset.create(options)` are ONLY for Dataset Builder Plug-ins! Passing them to `dataset.create(...)`
      // or calling `.save(...)` on an instance that has already executed `.runPaged()` / `.run()` causes NetSuite
      // to save the dataset with the hardcoded name "SuiteScript dataset". Always pass only `{ type, columns, condition }`
      // to `dataset.create(...)` and pass `{ name, description, id }` exclusively to `.save(...)` on a fresh instance.
      const createFreshDatasetInstance = (conditionToUse) => {
        const createOptions = {
          type: effectiveType,
          columns: createdColumns,
        };
        if (conditionToUse) {
          createOptions.condition = conditionToUse;
        }
        return dataset.create(createOptions);
      };

      const instantiateDatasetObject = (conditionToUse) => {
        if (existingDataset && isUnmodifiedExisting && isDryRun) {
          return existingDataset;
        }
        return createFreshDatasetInstance(conditionToUse);
      };

      try {
        datasetObj = instantiateDatasetObject(finalCondition);
      } catch (createErr) {
        return makeErrorResponse(
          `Failed to create dataset definition for type "${effectiveType}": ${extractFieldsFromErrorMessage(getErrorMessage(createErr))}`,
        );
      }

      // 5. Execute the dataset to validate and collect preview rows + totalMatchCount
      const activeColumns = Array.isArray(datasetObj.columns) ? datasetObj.columns : createdColumns;
      const usedPreviewKeys = {};
      const columnMeta = activeColumns.map((col, idx) => {
        const joinHops = col.join ? extractHopsFromDatasetJoin(col.join) : [];
        const joinPath = formatDatasetJoinPath(joinHops);
        const cleanLabel = isValidDatasetColumnLabel(col.label) ? String(col.label).trim() : null;
        const metaItem = {
          key: "",
          fieldId: col.fieldId || null,
          alias: col.alias || null,
          label: cleanLabel,
          ...(joinHops.length > 0 ? { join: joinHops, joinPath: joinPath } : {}),
          ...(col.formula ? { formula: col.formula, type: col.type || null } : {}),
        };
        metaItem.key = buildDatasetPreviewColumnKey(metaItem, idx, usedPreviewKeys);
        return metaItem;
      });

      let totalMatchCount = null;
      const previewRows = [];

      // Helper to detect if N/dataset or N/query threw an "Invalid date value ... (must match ...)" error
      // because a date-only string was passed to a DATETIME field (or vice versa), and rebuild condition
      const detectDateRetryModeFromError = (errObj) => {
        const msg = extractFieldsFromErrorMessage(getErrorMessage(errObj));
        if (!/Invalid date value/i.test(msg)) return null;
        if (/h:mm|H:mm|mm:ss/i.test(msg)) {
          return "DATETIME";
        }
        if (/must match/i.test(msg)) {
          return "DATE";
        }
        return null;
      };

      // Executes a runnable (either datasetObj or an N/query mirror qObj) to collect totalMatchCount and rawResultItems
      const executeRunnableForPreview = (runnable) => {
        let count = null;
        let items = [];
        let pData = null;
        const pageSize = Math.max(5, Math.min(maxRows > 0 ? maxRows : 50, 1000));

        try {
          pData = runnable.runPaged({ pageSize: pageSize });
          count = typeof pData.count === "number" ? pData.count : null;
        } catch (pErr) {
          if (detectDateRetryModeFromError(pErr)) {
            throw pErr;
          }
          pData = null;
        }

        if (maxRows > 0) {
          if (pData && Array.isArray(pData.pageRanges) && pData.pageRanges.length > 0) {
            for (let pIdx = 0; pIdx < pData.pageRanges.length && items.length < maxRows; pIdx++) {
              const pageRange = pData.pageRanges[pIdx];
              const pageIndex = pageRange && pageRange.index != null ? pageRange.index : pIdx;
              const page = pData.fetch({ index: pageIndex });
              const pageResults = page && page.data && Array.isArray(page.data.results) ? page.data.results : [];
              for (let rIdx = 0; rIdx < pageResults.length && items.length < maxRows; rIdx++) {
                items.push(pageResults[rIdx]);
              }
            }
          } else if (count !== 0) {
            const resultSet = runnable.run();
            const allResults = resultSet && Array.isArray(resultSet.results) ? resultSet.results : [];
            if (count === null) {
              count = allResults.length;
            }
            items = allResults.slice(0, maxRows);
          }
        }

        return { count: count, items: items };
      };

      // 5. Execute the dataset to validate and collect preview rows + totalMatchCount
      // IMPORTANT: When `dryRun: false` (saving), NEVER call `datasetObj.runPaged()` or `datasetObj.run()`
      // before calling `.save()`! Calling `.runPaged()` / `.run()` on an unsaved `dataset.Column[]` / `dataset.Condition`
      // object graph mutates the shared `dataset.Column` and `dataset.Condition` instances in-place inside NetSuite's
      // N/dataset runtime, stamping the internal transient name `"SuiteScript dataset"` onto the saved definition!
      // Instead, when `!isDryRun`, we always execute the preview against the `N/query` mirror (`buildMirrorQueryFromDataset`),
      // which leaves the `N/dataset` objects 100% untouched for `.save()`.
      let rawResultItems = [];
      let previewError = null;

      if (isDryRun) {
        // 5a. Dry-run: try datasetObj.runPaged() / datasetObj.run() first
        try {
          const dsExec = executeRunnableForPreview(datasetObj);
          totalMatchCount = dsExec.count;
          rawResultItems = dsExec.items;
        } catch (dsErr) {
          const retryDateMode = detectDateRetryModeFromError(dsErr);
          if (retryDateMode && (hasExplicitFilters || hasExplicitCondition)) {
            try {
              finalCondition = buildRequestedCondition(retryDateMode);
              datasetObj = instantiateDatasetObject(finalCondition);
              const retryExec = executeRunnableForPreview(datasetObj);
              totalMatchCount = retryExec.count;
              rawResultItems = retryExec.items;
            } catch (retryErr) {
              previewError = retryErr;
            }
          } else {
            previewError = dsErr;
          }
        }
      }

      // 5b. Execute via N/query mirror when saving (`!isDryRun`) or as automatic fallback when `datasetObj.run()` fails
      if (!isDryRun || previewError) {
        try {
          let mirrorQuery = buildMirrorQueryFromDataset(datasetObj);
          try {
            const qExec = executeRunnableForPreview(mirrorQuery);
            totalMatchCount = qExec.count;
            rawResultItems = qExec.items;
            previewError = null;
          } catch (qRunErr) {
            const retryDateMode = detectDateRetryModeFromError(qRunErr);
            if (retryDateMode && (hasExplicitFilters || hasExplicitCondition)) {
              finalCondition = buildRequestedCondition(retryDateMode);
              datasetObj = instantiateDatasetObject(finalCondition);
              mirrorQuery = buildMirrorQueryFromDataset(datasetObj);
              const qRetryExec = executeRunnableForPreview(mirrorQuery);
              totalMatchCount = qRetryExec.count;
              rawResultItems = qRetryExec.items;
              previewError = null;
            } else {
              previewError = qRunErr;
            }
          }
        } catch (qBuildErr) {
          previewError = qBuildErr;
        }
      }

      if (previewError) {
        return makeErrorResponse(
          `Dataset execution failed: ${extractFieldsFromErrorMessage(getErrorMessage(previewError))}`,
        );
      }

      for (let rIdx = 0; rIdx < rawResultItems.length; rIdx++) {
        const res = rawResultItems[rIdx];
        const valsArray = res && Array.isArray(res.values) ? res.values : [];
        let mappedObj = null;
        try {
          if (res && typeof res.asMap === "function") {
            mappedObj = res.asMap();
          }
        } catch {
          mappedObj = null;
        }

        const rowValues = {};
        for (let cIdx = 0; cIdx < columnMeta.length; cIdx++) {
          const cMeta = columnMeta[cIdx];
          const colKey = cMeta.key;
          let cellVal = cIdx < valsArray.length ? valsArray[cIdx] : null;
          if (
            cellVal === undefined &&
            mappedObj &&
            cMeta.alias &&
            Object.prototype.hasOwnProperty.call(mappedObj, cMeta.alias)
          ) {
            cellVal = mappedObj[cMeta.alias];
          }
          rowValues[colKey] = cellVal !== undefined ? cellVal : null;
        }

        previewRows.push(rowValues);
      }

      // 6. Save the dataset when dryRun is false
      let savedDatasetId = null;
      if (!isDryRun) {
        const saveOptionsWithId = {
          name: resolvedName,
        };
        if (resolvedDescription !== null && resolvedDescription !== undefined) {
          saveOptionsWithId.description = resolvedDescription;
        }
        if (resolvedScriptId && !/^\d+$/.test(resolvedScriptId)) {
          saveOptionsWithId.id = resolvedScriptId;
        }

        // Helper that saves a fresh, un-executed dataset instance, and if N/dataset.save() throws
        // `"Invalid identifier 'field^target', only alphanumeric and underscore characters are allowed"`
        // on a multi-hop join whose outer hop included `target`, automatically retries without outer-hop `target`s.
        const saveFreshDatasetWithOuterTargetFallback = (baseDatasetObj, saveOpts) => {
          try {
            return baseDatasetObj.save(saveOpts);
          } catch (firstSaveErr) {
            const errMsg = extractFieldsFromErrorMessage(getErrorMessage(firstSaveErr));
            if (/Invalid identifier\s+'[^']+\^[^']+'/i.test(errMsg)) {
              const strippedDataset = rebuildDatasetWithoutOuterHopTargets(baseDatasetObj, effectiveType);
              try {
                return strippedDataset.save(saveOpts);
              } catch (strippedSaveErr) {
                const strippedMsg = extractFieldsFromErrorMessage(getErrorMessage(strippedSaveErr));
                if (/Record Join\s+'[^']+'\s+for record\s+'[^']+'\s+was not found/i.test(strippedMsg)) {
                  throw new Error(
                    `NetSuite N/dataset platform limitation: NetSuite's Dataset.save() API cannot persist a 2+ hop join that traverses through a polymorphic custom field (${errMsg}; without outer target: ${strippedMsg}). Workaround: use a 1-hop join on the polymorphic field (e.g. join: { fieldId: "...", target: "transaction" }) or save the multi-hop dataset in the SuiteAnalytics Workbook UI.`,
                  );
                }
                throw strippedSaveErr;
              }
            }
            throw firstSaveErr;
          }
        };

        if (existingLoaded && existingDataset) {
          // Updating an existing dataset:
          // In NetSuite's N/dataset module, `Dataset.save()` is insert-only (it throws "Unable to save the dataset"
          // when `id` already exists, or creates a duplicate `custdataset<N>` with name "SuiteScript dataset" if called
          // on an already-loaded/executed instance). To overwrite an existing dataset cleanly and preserve its display `name`,
          // we clone the original components BEFORE deleting via `query.delete({ id })`, and immediately save a fresh,
          // un-executed `dataset.create({ type, columns, condition })` instance with `{ name, description, id }`.
          const backupJoinCache = {};
          const backupColBySig = {};
          const backupColByAlias = {};
          const backupUsedAliases = {};
          const backupComponents = cloneLoadedDatasetComponents(
            existingDataset,
            backupJoinCache,
            backupColBySig,
            backupColByAlias,
            backupUsedAliases,
          );

          try {
            query.delete({ id: resolvedScriptId });
          } catch (delErr) {
            return makeErrorResponse(
              `Dataset preview succeeded, but updating existing dataset "${resolvedScriptId}" failed (query.delete({ id: "${resolvedScriptId}" }) failed: ${extractFieldsFromErrorMessage(getErrorMessage(delErr))}). If this dataset is currently linked to a Workbook, update it in the SuiteAnalytics Workbook UI or save under a new scriptId.`,
            );
          }

          try {
            const freshToSave = createFreshDatasetInstance(finalCondition);
            const saveResult = saveFreshDatasetWithOuterTargetFallback(freshToSave, saveOptionsWithId);
            savedDatasetId =
              saveResult && saveResult.id != null
                ? String(saveResult.id)
                : resolvedScriptId;
          } catch (recreateErr) {
            // Recovery safeguard: restore the original dataset definition using fresh cloned components
            // so original column labels and joins are preserved intact
            try {
              const restoreDataset = dataset.create({
                type: effectiveType,
                columns: backupComponents.columns,
                ...(backupComponents.condition ? { condition: backupComponents.condition } : {}),
              });
              restoreDataset.save({
                name: loadedDatasetName || resolvedName,
                ...(loadedDatasetDescription != null ? { description: loadedDatasetDescription } : {}),
                id: resolvedScriptId,
              });
            } catch {
              // Ignore recovery failure
            }

            return makeErrorResponse(
              `Deleted existing dataset "${resolvedScriptId}" for overwrite, but saving the replacement dataset failed (original dataset was restored): ${extractFieldsFromErrorMessage(getErrorMessage(recreateErr))}`,
            );
          }
        } else {
          // Creating a new dataset: always call `.save()` on a fresh, un-executed `dataset.create({ type, columns, condition })`
          // instance so `.runPaged()` / `.run()` does not stamp "SuiteScript dataset" onto the saved definition.
          try {
            const freshToSave = createFreshDatasetInstance(finalCondition);
            const saveResult = saveFreshDatasetWithOuterTargetFallback(freshToSave, saveOptionsWithId);
            savedDatasetId =
              saveResult && saveResult.id != null
                ? String(saveResult.id)
                : resolvedScriptId || (freshToSave.id ? String(freshToSave.id) : null);
          } catch (saveErr) {
            return makeErrorResponse(
              `Dataset preview succeeded, but saving the dataset failed: ${extractFieldsFromErrorMessage(getErrorMessage(saveErr))}`,
            );
          }
        }
      }

      // 7. Generate the equivalent SuiteQL query string when available
      const canLoadByIdDirectly = !isDryRun || isUnmodifiedExisting;
      const targetIdForSuiteQL = savedDatasetId || (existingLoaded ? resolvedScriptId : null);
      const suiteQlInfo = tryGenerateDatasetSuiteQL(datasetObj, targetIdForSuiteQL, canLoadByIdDirectly);

      const timeElapsedMS = timer.elapsed;
      const governanceUsed = startGovernance - script.getRemainingUsage();

      return {
        success: true,
        dryRun: isDryRun,
        operation: operation,
        existingDatasetLoaded: existingLoaded,
        datasetType: effectiveType,
        ...(savedDatasetId != null
          ? {
              savedDatasetId: savedDatasetId,
              datasetUrl: `/app/Workbook/Dataset.nl?id=${savedDatasetId}`,
            }
          : existingLoaded && resolvedScriptId
            ? {
                datasetUrl: `/app/Workbook/Dataset.nl?id=${resolvedScriptId}`,
              }
            : {}),
        ...(savedDatasetId || resolvedScriptId ? { scriptId: savedDatasetId || resolvedScriptId } : {}),
        ...(resolvedName ? { name: resolvedName } : {}),
        ...(resolvedDescription !== null && resolvedDescription !== undefined
          ? { description: resolvedDescription }
          : {}),
        totalMatchCount: totalMatchCount,
        previewRowCount: previewRows.length,
        appliedCondition: serializeDatasetCondition(datasetObj.condition || null),
        ...(suiteQlInfo.query ? { generatedSuiteQL: suiteQlInfo.query } : {}),
        ...(suiteQlInfo.params ? { generatedSuiteQLParams: suiteQlInfo.params } : {}),
        columns: columnMeta,
        previewRows: previewRows,
        timeElapsedMS: timeElapsedMS,
        governanceUsed: governanceUsed,
      };
    } catch (e) {
      return makeErrorResponse(
        `Unable to ${isDryRun ? "run dataset dry-run" : "save dataset"}: ${extractFieldsFromErrorMessage(getErrorMessage(e))}`,
      );
    }
  }

  /**
   * ACTION: VIEW_DATASET
   * Two modes:
   * 1. Inspect & Preview Mode (`scriptId` or `id` provided):
   *    Loads an existing NetSuite SuiteAnalytics Dataset via N/dataset.load, returns its full definition
   *    (datasetType, name, description, scriptId, datasetUrl, columns, condition, generatedSuiteQL)
   *    in a format ready to pass to `netsuite_create_dataset` with `overwrite: true`,
   *    and optionally executes a preview of the first `maxRows` rows (default 25; pass 0 for definition only).
   * 2. Search / List Mode (`scriptId` and `id` omitted):
   *    Lists existing SuiteAnalytics Datasets via `dataset.list()` (optionally filtered by `searchTerm`
   *    against `name`, `scriptId`, or `description`) so an agent can discover the `scriptId` of a dataset by name.
   *
   * @param {Object} request
   * @param {string|number} [request.scriptId]
   * @param {string|number} [request.id]
   * @param {string} [request.searchTerm]
   * @param {number} [request.maxRows=25]
   * @param {number} [request.limit=50]
   * @returns {Object}
   */
  function handleViewDataset(request) {
    const rawIdInput =
      request.scriptId != null && String(request.scriptId).trim() !== ""
        ? String(request.scriptId).trim()
        : request.id != null && String(request.id).trim() !== ""
          ? String(request.id).trim()
          : "";
    const normalizedScriptId = normalizeDatasetScriptId(rawIdInput);
    const searchTerm =
      typeof request.searchTerm === "string" && request.searchTerm.trim()
        ? request.searchTerm.trim()
        : "";

    try {
      const script = runtime.getCurrentScript();
      const startGovernance = script.getRemainingUsage();
      const timer = new ExecutionTimer();

      // Mode 2: Search / List datasets when scriptId is omitted
      if (!normalizedScriptId) {
        const rawLimit = request.limit != null ? Number(request.limit) : 50;
        const limit = !isNaN(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), 500) : 50;

        let rawList = [];
        try {
          if (typeof dataset.list === "function") {
            rawList = dataset.list() || [];
          }
        } catch (listErr) {
          return makeErrorResponse(
            `Unable to list datasets: ${extractFieldsFromErrorMessage(getErrorMessage(listErr))}`,
          );
        }

        const lowerTerm = searchTerm.toLowerCase();
        const allItems = [];
        for (let i = 0; i < rawList.length; i++) {
          const item = rawList[i];
          if (!item || typeof item !== "object") continue;
          const sId =
            item.scriptId != null
              ? String(item.scriptId).trim()
              : item.id != null
                ? String(item.id).trim()
                : "";
          const name = item.name != null ? String(item.name).trim() : null;
          const description =
            item.description != null && String(item.description) !== ""
              ? String(item.description)
              : null;

          if (lowerTerm) {
            const matchId = sId.toLowerCase().includes(lowerTerm);
            const matchName = name ? name.toLowerCase().includes(lowerTerm) : false;
            const matchDesc = description ? description.toLowerCase().includes(lowerTerm) : false;
            if (!matchId && !matchName && !matchDesc) {
              continue;
            }
          }

          allItems.push({
            scriptId: sId || null,
            name: name,
            ...(description !== null ? { description: description } : {}),
            ...(sId ? { datasetUrl: `/app/Workbook/Dataset.nl?id=${sId}` } : {}),
          });
        }

        const pagedDatasets = allItems.slice(0, limit);
        const timeElapsedMS = timer.elapsed;
        const governanceUsed = startGovernance - script.getRemainingUsage();

        return {
          success: true,
          mode: "list",
          ...(searchTerm ? { searchTerm: searchTerm } : {}),
          totalMatchingCount: allItems.length,
          count: pagedDatasets.length,
          datasets: pagedDatasets,
          timeElapsedMS: timeElapsedMS,
          governanceUsed: governanceUsed,
        };
      }

      // Mode 1: Inspect & Preview a specific dataset by scriptId
      const rawMaxRows = request.maxRows != null ? Number(request.maxRows) : 25;
      const maxRows = !isNaN(rawMaxRows) && rawMaxRows >= 0 ? Math.min(Math.floor(rawMaxRows), 1000) : 25;

      let datasetObj = null;
      try {
        datasetObj = dataset.load({ id: normalizedScriptId });
      } catch (loadErr) {
        return makeErrorResponse(
          `Unable to load dataset "${normalizedScriptId}": ${extractFieldsFromErrorMessage(getErrorMessage(loadErr))}`,
        );
      }

      const existingMeta = lookupExistingDatasetMetadata(normalizedScriptId);
      const resolvedName =
        existingMeta.name ||
        (datasetObj.name && String(datasetObj.name) !== "SuiteScript dataset"
          ? String(datasetObj.name)
          : datasetObj.name
            ? String(datasetObj.name)
            : null);
      const resolvedDescription =
        existingMeta.description !== null
          ? existingMeta.description
          : isRealDatasetDescription(datasetObj.description)
            ? String(datasetObj.description)
            : null;
      const resolvedScriptId =
        datasetObj.id != null ? String(datasetObj.id) : normalizedScriptId;
      const effectiveType = datasetObj.type ? String(datasetObj.type) : null;

      const activeColumns = Array.isArray(datasetObj.columns) ? datasetObj.columns : [];
      const usedPreviewKeys = {};
      const columnMeta = activeColumns.map((col, idx) => {
        const joinHops = col.join ? extractHopsFromDatasetJoin(col.join) : [];
        const joinPath = formatDatasetJoinPath(joinHops);
        const cleanLabel = isValidDatasetColumnLabel(col.label) ? String(col.label).trim() : null;
        const metaItem = {
          key: "",
          fieldId: col.fieldId || null,
          alias: col.alias || null,
          label: cleanLabel,
          ...(joinHops.length > 0 ? { join: joinHops, joinPath: joinPath } : {}),
          ...(col.formula ? { formula: col.formula, type: col.type || null } : {}),
        };
        metaItem.key = buildDatasetPreviewColumnKey(metaItem, idx, usedPreviewKeys);
        return metaItem;
      });

      const serializedCond = serializeDatasetCondition(datasetObj.condition || null);
      const suiteQlInfo = tryGenerateDatasetSuiteQL(datasetObj, resolvedScriptId, true);

      let totalMatchCount = null;
      const previewRows = [];

      if (maxRows > 0) {
        const executeRunnableForPreview = (runnable) => {
          let count = null;
          let items = [];
          let pData = null;
          const pageSize = Math.max(5, Math.min(maxRows > 0 ? maxRows : 50, 1000));

          try {
            pData = runnable.runPaged({ pageSize: pageSize });
            count = typeof pData.count === "number" ? pData.count : null;
          } catch {
            pData = null;
          }

          if (pData && Array.isArray(pData.pageRanges) && pData.pageRanges.length > 0) {
            for (let pIdx = 0; pIdx < pData.pageRanges.length && items.length < maxRows; pIdx++) {
              const pageRange = pData.pageRanges[pIdx];
              const pageIndex = pageRange && pageRange.index != null ? pageRange.index : pIdx;
              const page = pData.fetch({ index: pageIndex });
              const pageResults = page && page.data && Array.isArray(page.data.results) ? page.data.results : [];
              for (let rIdx = 0; rIdx < pageResults.length && items.length < maxRows; rIdx++) {
                items.push(pageResults[rIdx]);
              }
            }
          } else if (count !== 0) {
            const resultSet = runnable.run();
            const allResults = resultSet && Array.isArray(resultSet.results) ? resultSet.results : [];
            if (count === null) {
              count = allResults.length;
            }
            items = allResults.slice(0, maxRows);
          }

          return { count: count, items: items };
        };

        let rawResultItems = [];
        let previewError = null;

        try {
          const dsExec = executeRunnableForPreview(datasetObj);
          totalMatchCount = dsExec.count;
          rawResultItems = dsExec.items;
        } catch (dsErr) {
          previewError = dsErr;
        }

        // Automatic N/query fallback for multi-hop joins
        if (previewError) {
          try {
            const mirrorQuery = buildMirrorQueryFromDataset(datasetObj);
            const qExec = executeRunnableForPreview(mirrorQuery);
            totalMatchCount = qExec.count;
            rawResultItems = qExec.items;
            previewError = null;
          } catch (qErr) {
            previewError = qErr;
          }
        }

        if (previewError) {
          return makeErrorResponse(
            `Loaded dataset "${resolvedScriptId}", but preview execution failed: ${extractFieldsFromErrorMessage(getErrorMessage(previewError))}`,
          );
        }

        for (let rIdx = 0; rIdx < rawResultItems.length; rIdx++) {
          const res = rawResultItems[rIdx];
          const valsArray = res && Array.isArray(res.values) ? res.values : [];
          let mappedObj = null;
          try {
            if (res && typeof res.asMap === "function") {
              mappedObj = res.asMap();
            }
          } catch {
            mappedObj = null;
          }

          const rowValues = {};
          for (let cIdx = 0; cIdx < columnMeta.length; cIdx++) {
            const cMeta = columnMeta[cIdx];
            const colKey = cMeta.key;
            let cellVal = cIdx < valsArray.length ? valsArray[cIdx] : null;
            if (
              cellVal === undefined &&
              mappedObj &&
              cMeta.alias &&
              Object.prototype.hasOwnProperty.call(mappedObj, cMeta.alias)
            ) {
              cellVal = mappedObj[cMeta.alias];
            }
            rowValues[colKey] = cellVal !== undefined ? cellVal : null;
          }

          previewRows.push(rowValues);
        }
      }

      const timeElapsedMS = timer.elapsed;
      const governanceUsed = startGovernance - script.getRemainingUsage();

      return {
        success: true,
        mode: "view",
        datasetType: effectiveType,
        scriptId: resolvedScriptId,
        datasetUrl: `/app/Workbook/Dataset.nl?id=${resolvedScriptId}`,
        ...(resolvedName ? { name: resolvedName } : {}),
        ...(resolvedDescription !== null && resolvedDescription !== undefined
          ? { description: resolvedDescription }
          : {}),
        columns: columnMeta,
        condition: serializedCond,
        ...(suiteQlInfo.query ? { generatedSuiteQL: suiteQlInfo.query } : {}),
        ...(suiteQlInfo.params ? { generatedSuiteQLParams: suiteQlInfo.params } : {}),
        ...(maxRows > 0
          ? {
              totalMatchCount: totalMatchCount,
              previewRowCount: previewRows.length,
              previewRows: previewRows,
            }
          : {}),
        timeElapsedMS: timeElapsedMS,
        governanceUsed: governanceUsed,
      };
    } catch (e) {
      return makeErrorResponse(
        `Unable to view dataset: ${extractFieldsFromErrorMessage(getErrorMessage(e))}`,
      );
    }
  }

  // =========================================================================
  // ACTION DISPATCHER
  // =========================================================================
  const ACTIONS = {
    [MCP_ACTION.SCRIPT_LOGS]: handleScriptLogs,
    [MCP_ACTION.SCRIPT_LOGS_BY_ID]: handleScriptLogsById,
    [MCP_ACTION.RUN_SUITE_QL]: handleRunSuiteQL,
    [MCP_ACTION.RUN_FUNCTION]: handleRunFunction,
    [MCP_ACTION.RECORD_SAMPLE]: handleRecordSample,
    [MCP_ACTION.UPSERT_RECORD]: handleUpsertRecord,
    [MCP_ACTION.GET_SUPPORTED_LOCALES]: handleGetSupportedLocales,
    [MCP_ACTION.GET_TRANSLATIONS]: handleGetTranslations,
    [MCP_ACTION.RENDER_PDF_TEMPLATE]: handleRenderPdfTemplate,
    [MCP_ACTION.RENDER_EMAIL_TEMPLATE]: handleRenderEmailTemplate,
    [MCP_ACTION.GET_FILE]: handleGetFile,
    [MCP_ACTION.VIEW_SAVED_SEARCH]: handleViewSavedSearch,
    [MCP_ACTION.CREATE_SAVED_SEARCH]: handleCreateSavedSearch,
    [MCP_ACTION.VIEW_DATASET]: handleViewDataset,
    [MCP_ACTION.CREATE_DATASET]: handleCreateDataset,
  };

  /**
   * RESTlet POST Entry Point.
   *
   * @param {Object|string} requestBody
   * @returns {Object}
   */
  function post(requestBody) {
    let request = requestBody;

    if (typeof request === "string") {
      try {
        request = JSON.parse(requestBody);
      } catch (e) {
        return makeErrorResponse(
          `Invalid JSON request body: ${getErrorMessage(e)}`,
        );
      }
    }

    log.debug({
      title: "MCP Request",
      details: request,
    });

    if (!request || typeof request !== "object") {
      return makeErrorResponse("Invalid request body: expected a JSON object.");
    }

    const action = request.action;
    if (!action) {
      return makeErrorResponse('Missing required property: "action"');
    }

    const actionHandler = ACTIONS[action];
    if (!actionHandler) {
      return makeErrorResponse(`Invalid action ${action}`);
    }

    return actionHandler(request);
  }

  return {
    post: post,
  };
});
