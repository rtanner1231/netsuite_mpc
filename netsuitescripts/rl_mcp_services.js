/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 * @NModuleScope SameAccount
 *
 * Consolidated MCP Services RESTlet.
 * Provides endpoints for executing SuiteQL queries, retrieving script execution logs,
 * dynamically running SuiteScript functions, and inspecting record samples.
 */
define(["N/log", "N/query", "N/record", "N/search"], (
  log,
  query,
  record,
  search,
) => {
  // =========================================================================
  // CONSTANTS & ACTION ENUM
  // =========================================================================
  const MCP_ACTION = {
    SCRIPT_LOGS: "SCRIPT_LOGS",
    RUN_SUITE_QL: "RUN_SUITE_QL",
    RUN_FUNCTION: "RUN_FUNCTION",
    RECORD_SAMPLE: "RECORD_SAMPLE",
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

    const fileName = toJsExtension(request.scriptFileName);

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

    let queryResults;
    try {
      queryResults = query.runSuiteQL({ query: sql }).asMappedResults();
    } catch (e) {
      const errMsg = getErrorMessage(e);
      return makeErrorResponse(`Unable to retrieve logs: ${errMsg}`);
    }

    if (!queryResults || queryResults.length === 0) {
      return makeErrorResponse("No script found for file");
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

    if (typeof mod[request.functionName] !== "function") {
      return makeErrorResponse(
        `Function ${request.functionName} not found in module ${targetPath}`,
      );
    }

    try {
      const timer = new ExecutionTimer();
      const result = mod[request.functionName](...args);
      const timeElapsedMS = timer.elapsed;

      return {
        success: true,
        result: result,
        timeElapsedMS: timeElapsedMS,
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

  // =========================================================================
  // ACTION DISPATCHER
  // =========================================================================
  const ACTIONS = {
    [MCP_ACTION.SCRIPT_LOGS]: handleScriptLogs,
    [MCP_ACTION.RUN_SUITE_QL]: handleRunSuiteQL,
    [MCP_ACTION.RUN_FUNCTION]: handleRunFunction,
    [MCP_ACTION.RECORD_SAMPLE]: handleRecordSample,
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
