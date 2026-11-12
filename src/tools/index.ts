import { getNetsuiteFieldsTool } from "./getFields.js";
import { runSuiteQlTool } from "./runSuiteQl.js";
import { getScriptLogsTool } from "./getScriptLogs.js";
import { getRunFunctionLogsTool } from "./getRunFunctionLogs.js";
import { uploadFileTool } from "./uploadFile.js";
import { runFunctionTool } from "./runFunction.js";
import { loadRecordSampleTool } from "./loadRecordSample.js";
import { createCustomRecordTool } from "./createCustomRecord.js";
import { createCustomListTool } from "./createCustomList.js";
import { updateCustomRecordTool } from "./updateCustomRecord.js";
import {
    rebuildVectorDatabaseTool,
    rebuildVectorDatabaseStatusTool
} from "./rebuildVectorDatabase.js";
import { searchTablesTool } from "./searchTables.js";
import { getRelatedTablesTool } from "./getRelatedTables.js";

export const toolsRegistry = [
    getNetsuiteFieldsTool,
    runSuiteQlTool,
    getScriptLogsTool,
    getRunFunctionLogsTool,
    uploadFileTool,
    runFunctionTool,
    loadRecordSampleTool,
    createCustomRecordTool,
    createCustomListTool,
    updateCustomRecordTool,
    rebuildVectorDatabaseTool,
    rebuildVectorDatabaseStatusTool,
    searchTablesTool,
    getRelatedTablesTool
];
