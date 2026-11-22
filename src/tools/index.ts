import { getNetsuiteFieldsTool } from "./getFields.js";
import { runSuiteQlTool } from "./runSuiteQl.js";
import { getScriptLogsTool } from "./getScriptLogs.js";
import { getRunFunctionLogsTool } from "./getRunFunctionLogs.js";
import { uploadFileTool } from "./uploadFile.js";
import { compareFilesTool } from "./compareFiles.js";
import { runFunctionTool } from "./runFunction.js";
import { loadRecordSampleTool } from "./loadRecordSample.js";
import { createRecordTool } from "./createRecord.js";
import { createCustomRecordTool } from "./createCustomRecord.js";
import { createCustomListTool } from "./createCustomList.js";
import { updateCustomRecordTool } from "./updateCustomRecord.js";
import {
    rebuildVectorDatabaseTool,
    rebuildVectorDatabaseStatusTool
} from "./rebuildVectorDatabase.js";
import { searchTablesTool } from "./searchTables.js";
import { getRelatedTablesTool } from "./getRelatedTables.js";
import { listEnvironmentsTool } from "./listEnvironments.js";
import { switchEnvironmentTool } from "./switchEnvironment.js";
import { openSettingsTool } from "./openSettings.js";
import { listSupportedLocalesTool } from "./listSupportedLocales.js";
import { listTranslationCollectionsTool } from "./listTranslationCollections.js";
import { viewTranslationCollectionTool } from "./viewTranslationCollection.js";
import { createTranslationCollectionTool } from "./createTranslationCollection.js";
import { updateTranslationCollectionTool } from "./updateTranslationCollection.js";

export const toolsRegistry = [
    listEnvironmentsTool,
    switchEnvironmentTool,
    openSettingsTool,
    getNetsuiteFieldsTool,
    runSuiteQlTool,
    getScriptLogsTool,
    getRunFunctionLogsTool,
    uploadFileTool,
    compareFilesTool,
    runFunctionTool,
    loadRecordSampleTool,
    createRecordTool,
    createCustomRecordTool,
    createCustomListTool,
    updateCustomRecordTool,
    listSupportedLocalesTool,
    listTranslationCollectionsTool,
    viewTranslationCollectionTool,
    createTranslationCollectionTool,
    updateTranslationCollectionTool,
    rebuildVectorDatabaseTool,
    rebuildVectorDatabaseStatusTool,
    searchTablesTool,
    getRelatedTablesTool
];
