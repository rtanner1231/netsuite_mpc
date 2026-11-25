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
import { listTemplatesTool } from "./listTemplates.js";
import { readAdvancedPdfTemplateTool } from "./readAdvancedPdfTemplate.js";
import { upsertAdvancedPdfTemplateTool } from "./upsertAdvancedPdfTemplate.js";
import { readEmailTemplateTool } from "./readEmailTemplate.js";
import { upsertEmailTemplateTool } from "./upsertEmailTemplate.js";
import { renderAdvancedPdfTemplateTool } from "./renderAdvancedPdfTemplate.js";
import { renderEmailTemplateTool } from "./renderEmailTemplate.js";
import { deployScriptTool } from "./deployScript.js";
import { getScriptTool } from "./getScript.js";
import { searchScriptsTool } from "./searchScripts.js";

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
    deployScriptTool,
    getScriptTool,
    searchScriptsTool,
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
    listTemplatesTool,
    readAdvancedPdfTemplateTool,
    upsertAdvancedPdfTemplateTool,
    readEmailTemplateTool,
    upsertEmailTemplateTool,
    renderAdvancedPdfTemplateTool,
    renderEmailTemplateTool,
    rebuildVectorDatabaseTool,
    rebuildVectorDatabaseStatusTool,
    searchTablesTool,
    getRelatedTablesTool
];
