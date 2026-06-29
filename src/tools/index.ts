import { getNetsuiteFieldsTool } from "./getFields.js";
import { runSuiteQlTool } from "./runSuiteQl.js";
import { getScriptLogsTool } from "./getScriptLogs.js";
import { uploadFileTool } from "./uploadFile.js";
import { runFunctionTool } from "./runFunction.js";
import { loadRecordSampleTool } from "./loadRecordSample.js";
import { createCustomRecordTool } from "./createCustomRecord.js";
import { createCustomListTool } from "./createCustomList.js";

export const toolsRegistry = [
    getNetsuiteFieldsTool,
    runSuiteQlTool,
    getScriptLogsTool,
    uploadFileTool,
    runFunctionTool,
    loadRecordSampleTool,
    createCustomRecordTool,
    createCustomListTool
];
