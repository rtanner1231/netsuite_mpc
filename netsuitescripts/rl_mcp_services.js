/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 * @NModuleScope SameAccount
 *
 * Consolidated MCP Services RESTlet.
 * Provides endpoints for executing SuiteQL queries, retrieving script execution logs,
 * dynamically running SuiteScript functions, and inspecting record samples.
 */
define(["N/config", "N/file", "N/log", "N/query", "N/record", "N/render", "N/runtime", "N/search", "N/translation"], (
  config,
  file,
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
