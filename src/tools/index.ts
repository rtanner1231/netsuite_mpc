import { getNetsuiteFieldsTool } from "./getFields.js";
import { runSuiteQlTool } from "./runSuiteQl.js";
import { getScriptLogsTool } from "./getScriptLogs.js";
import { uploadFileTool } from "./uploadFile.js";
import { compareFilesTool } from "./compareFiles.js";
import { viewFileTool } from "./viewFile.js";
import { runFunctionTool } from "./runFunction.js";
import { loadRecordSampleTool } from "./loadRecordSample.js";
import { upsertRecordTool } from "./upsertRecord.js";
import { viewSavedSearchTool } from "./viewSavedSearch.js";
import { createSavedSearchTool } from "./createSavedSearch.js";
import { viewDatasetTool } from "./viewDataset.js";
import { createDatasetTool } from "./createDataset.js";
import { upsertCustomRecordTool } from "./upsertCustomRecord.js";
import { upsertCustomFieldTool } from "./upsertCustomField.js";
import { upsertCustomListTool } from "./upsertCustomList.js";
import { rebuildVectorDatabaseTool } from "./rebuildVectorDatabase.js";
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
import { createManageToolsetsTool } from "./manageToolsets.js";
import { ToolDefinition } from "../types/index.js";

export const toolsRegistry: ToolDefinition[] = [
    listEnvironmentsTool,
    switchEnvironmentTool,
    openSettingsTool,
    createManageToolsetsTool(() => toolsRegistry),
    getNetsuiteFieldsTool,
    runSuiteQlTool,
    getScriptLogsTool,
    uploadFileTool,
    compareFilesTool,
    viewFileTool,
    deployScriptTool,
    getScriptTool,
    searchScriptsTool,
    runFunctionTool,
    loadRecordSampleTool,
    upsertRecordTool,
    viewSavedSearchTool,
    createSavedSearchTool,
    viewDatasetTool,
    createDatasetTool,
    upsertCustomRecordTool,
    upsertCustomFieldTool,
    upsertCustomListTool,
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
    searchTablesTool,
    getRelatedTablesTool
];
