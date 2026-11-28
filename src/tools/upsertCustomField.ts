import fs from "fs/promises";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { ToolDefinition } from "../types/index.js";
import {
    BatchDeploySdfObjectItem,
    deployObjectsFromTempProject,
    downloadSdfObjectInTempProject,
    getSaveToProjectSchemaProperty
} from "../utils/objects.js";
import { getProjectRoot } from "../utils/mcp.js";
import { getProjectConfig } from "../utils/project.js";
import { withTempSdfProject } from "../utils/tempSdfProject.js";
import { CUSTOM_FIELD_TYPES } from "../utils/customRecords.js";
import {
    CUSTOM_FIELD_CATEGORIES,
    UpsertCustomFieldInput,
    buildOrMergeCustomFieldXml,
    normalizeCustomFieldCategory,
    normalizeCustomFieldScriptId
} from "../utils/customFields.js";

type UpsertCustomFieldsArgs = {
    fields?: UpsertCustomFieldInput[];
    saveToProject?: boolean;
} & Partial<UpsertCustomFieldInput>;

const fileExists = async (targetPath: string): Promise<boolean> => {
    try {
        await fs.access(targetPath);
        return true;
    } catch {
        return false;
    }
};

export const upsertCustomFieldTool: ToolDefinition = {
    name: "netsuite_upsert_custom_field",
    description:
        "Creates or updates one or more standalone Custom Fields on native NetSuite records in a single SDF deployment pass via an isolated temporary SDF project. Supports all 8 standalone NetSuite SDF custom field categories: 'transaction_body' (custbody_*), 'transaction_line' (custcol_*), 'crm' (custevent_*), 'item' (custitem_*), 'entity' (custentity_*), 'other_record' (custrecord_*), 'item_option' (custcol_*), and 'item_number' (custitemnumber_*). Tip: Before updating an existing standalone custom field in a new session, call 'netsuite_view_custom_object' to inspect its current category, 'appliesTo' targets, 'displayType', and other SDF properties. For each field in 'fields': if it already exists in NetSuite, its current XML is downloaded and updated (merging new 'appliesTo' targets and updated properties while preserving existing subtabs, permissions, and filters); if it does not exist, a new custom field is created with configured field defaults applied. Automatically resolves manifest.xml object and feature dependencies (such as ITEMOPTIONS for item_option fields) and optionally saves deployed XML files to the local project.",
    meta: {
        isDestructive: true,
        requiresSdf: true
    },
    inputSchema: {
        type: "object",
        properties: {
            fields: {
                type: "array",
                description:
                    "An array of one or more standalone custom field definitions to create or update in NetSuite in a single SDF deployment.",
                items: {
                    type: "object",
                    properties: {
                        fieldCategory: {
                            type: "string",
                            enum: CUSTOM_FIELD_CATEGORIES,
                            description:
                                "The standalone custom field category:\n" +
                                "- 'transaction_body': Transaction Body Field (<transactionbodycustomfield>, prefix 'custbody_')\n" +
                                "- 'transaction_line': Transaction Line/Column Field (<transactioncolumncustomfield>, prefix 'custcol_')\n" +
                                "- 'crm': CRM Field (<crmcustomfield>, prefix 'custevent_')\n" +
                                "- 'item': Item Field (<itemcustomfield>, prefix 'custitem_')\n" +
                                "- 'entity': Entity Field (<entitycustomfield>, prefix 'custentity_')\n" +
                                "- 'other_record': Other Record Field (<othercustomfield>, prefix 'custrecord_', requires 'recordType')\n" +
                                "- 'item_option': Transaction Item Option Field (<itemoptioncustomfield>, prefix 'custcol_')\n" +
                                "- 'item_number': Item Number (Serial/Lot) Field (<itemnumbercustomfield>, prefix 'custitemnumber_')"
                        },
                        scriptId: {
                            type: "string",
                            description:
                                "The internal scriptId of the custom field (e.g., 'custbody_delivery_notes' or 'delivery_notes'). The category's required prefix (custbody_, custcol_, custevent_, custitem_, custentity_, custrecord_, custitemnumber_) is automatically prepended if omitted. Max length is 38 characters (40 for item_option)."
                        },
                        label: {
                            type: "string",
                            description:
                                "The UI label for the custom field (max 40 characters). Required when creating a new field; optional when updating an existing field."
                        },
                        type: {
                            type: "string",
                            enum: CUSTOM_FIELD_TYPES,
                            description:
                                "Field data type (e.g., 'TEXT', 'SELECT', 'MULTISELECT', 'INTEGER', 'FLOAT', 'CURRENCY', 'PERCENT', 'DATE', 'DATETIMETZ', 'CHECKBOX', 'TEXTAREA', 'EMAIL', 'PHONE', 'URL'). Defaults to 'TEXT' when creating a new field."
                        },
                        selectRecordType: {
                            type: "string",
                            description:
                                "Required when 'type' is 'SELECT' or 'MULTISELECT'. The scriptId of the custom record or custom list (e.g., 'customrecord_my_rec' or 'customlist_my_list'), or a standard NetSuite record name (e.g., 'customer', 'vendor', 'employee', 'item', 'transaction', 'account', 'department', 'location', 'subsidiary', 'class')."
                        },
                        appliesTo: {
                            type: "array",
                            items: { type: "string" },
                            description:
                                "Record or transaction types this field applies to (sets the corresponding SDF boolean flags to 'T'). Supported targets by category:\n" +
                                "- transaction_body: 'SALE', 'PURCHASE', 'ITEM_RECEIPT', 'ITEM_FULFILLMENT', 'JOURNAL', 'EXPENSE_REPORT', 'OPPORTUNITY', 'CUSTOMER_PAYMENT', 'VENDOR_PAYMENT', 'DEPOSIT', 'TRANSFER_ORDER', 'INVENTORY_ADJUSTMENT', 'ASSEMBLY_BUILD', 'WORK_ORDER', 'WEB_STORE', 'PRINT', 'PICKING_TICKET', 'BILL_OF_LADING', 'INBOUND_SHIPMENT', 'PAYCHECK'\n" +
                                "- transaction_line: 'SALE', 'PURCHASE', 'ITEM_RECEIPT', 'ITEM_FULFILLMENT', 'JOURNAL', 'EXPENSE', 'EXPENSE_REPORT', 'OPPORTUNITY', 'TIME', 'TRANSFER_ORDER', 'ASSEMBLY_BUILD', 'WORK_ORDER', 'WEB_STORE', 'PICKING_TICKET', 'PRINT'\n" +
                                "- crm: 'CASE', 'TASK', 'PHONE_CALL', 'EVENT', 'CAMPAIGN', 'ISSUE', 'SOLUTION'\n" +
                                "- item: 'INVENTORY', 'NON_INVENTORY', 'SERVICE', 'OTHER_CHARGE', 'KIT', 'ASSEMBLY', 'ITEM_GROUP', 'DISCOUNT', 'MARKUP', 'SUBTOTAL', 'PAYMENT', 'GIFT_CERTIFICATE', 'DOWNLOAD', 'EXPENSE'\n" +
                                "- entity: 'CUSTOMER', 'VENDOR', 'EMPLOYEE', 'CONTACT', 'PARTNER', 'PROJECT', 'GROUP', 'GENERIC_RESOURCE', 'OTHER_NAME'\n" +
                                "- item_option: 'ALL_ITEMS', 'PURCHASE', 'SALE', 'OPPORTUNITY', 'WEB_STORE', 'TRANSFER_ORDER', 'KIT'\n" +
                                "- item_number: 'ALL_ITEMS', 'SERIAL', 'LOT', 'GIFT_CERTIFICATE'\n" +
                                "(Raw SDF XML tag names such as 'bodysale', 'colsale', 'appliestoitemassembly', 'appliestoserialized', 'appliestolots', 'appliestogiftcerts', or 'appliestocustomer' are also accepted.)"
                        },
                        recordType: {
                            type: "string",
                            description:
                                "Required when 'fieldCategory' is 'other_record'. The standard NetSuite record type that this field applies to (e.g., 'account', 'department', 'location', 'subsidiary', 'class', 'bin', 'campaigncategory', 'promotioncode', 'term', 'note', or a numeric internal ID like '-112')."
                        },
                        description: {
                            type: "string",
                            description: "(Optional) Internal description of the custom field."
                        },
                        helpText: {
                            type: "string",
                            description: "(Optional) Help text displayed when clicking the field label in the NetSuite UI."
                        },
                        isMandatory: {
                            type: "boolean",
                            description: "(Optional) Whether the field is mandatory (ismandatory)."
                        },
                        storeValue: {
                            type: "boolean",
                            description: "(Optional) Whether the field value is stored in the database (storevalue). Defaults to true."
                        },
                        showInList: {
                            type: "boolean",
                            description: "(Optional) Whether the field is shown in list views (showinlist)."
                        },
                        globalSearch: {
                            type: "boolean",
                            description: "(Optional) Whether the field is indexed for global search (globalsearch)."
                        },
                        displayType: {
                            type: "string",
                            enum: ["NORMAL", "LOCKED", "STATICTEXT", "HIDDEN", "DISABLED", "INLINE"],
                            description:
                                "(Optional) UI display type (<displaytype>). Valid SDF values are 'NORMAL', 'LOCKED' (UI Disabled), 'STATICTEXT' (UI Inline Text), and 'HIDDEN'. Aliases 'DISABLED' (-> 'LOCKED') and 'INLINE' (-> 'STATICTEXT') are also accepted and automatically mapped. Defaults to 'NORMAL'."
                        },
                        defaultValue: {
                            type: "string",
                            description: "(Optional) Default text/numeric/formula value (defaultvalue)."
                        },
                        defaultChecked: {
                            type: "boolean",
                            description: "(Optional) For CHECKBOX fields, whether the box is checked by default (defaultchecked)."
                        },
                        dynamicDefault: {
                            type: "string",
                            description: "(Optional) Dynamic default constant (e.g., 'NOW', 'ME', 'CURRENTUSERSUBSIDIARY', 'CURRENTUSERDEPARTMENT', 'CURRENTUSERLOCATION')."
                        },
                        isFormula: {
                            type: "boolean",
                            description: "(Optional) Whether defaultValue is evaluated as a formula (isformula)."
                        },
                        subtab: {
                            type: "string",
                            description:
                                "(Optional) Target subtab where the field is placed (e.g., 'ENTITYMAIN', 'TRANSACTIONMAIN', 'ITEMMAIN', 'CRMMAIN', or a custom subtab scriptId like 'custtab_custom')."
                        },
                        isParent: {
                            type: "boolean",
                            description: "(Optional) For SELECT fields (where supported), whether the referenced record is the parent record (isparent)."
                        },
                        parentSubtab: {
                            type: "string",
                            description: "(Optional) Subtab on the parent record where child records appear (parentsubtab)."
                        },
                        itemSubType: {
                            type: "string",
                            enum: ["BOTH", "PURCHASE", "SALE"],
                            description: "(Optional) For 'item' fields, restricts item applicability to 'BOTH', 'PURCHASE', or 'SALE' subtype (itemsubtype)."
                        }
                    },
                    required: ["fieldCategory", "scriptId"]
                }
            },
            saveToProject: getSaveToProjectSchemaProperty()
        },
        required: ["fields"]
    },
    execute: async (args: UpsertCustomFieldsArgs, server: Server) => {
        try {
            // Support both `fields: [...]` and a fallback if a single field object was passed at top level
            let rawFields: UpsertCustomFieldInput[] = [];
            if (Array.isArray(args?.fields)) {
                rawFields = args.fields;
            } else if (args && typeof args === "object" && args.scriptId && args.fieldCategory) {
                rawFields = [args as UpsertCustomFieldInput];
            }

            if (rawFields.length === 0) {
                throw new Error(
                    "'fields' must be a non-empty array of custom field definitions to create or update."
                );
            }

            // Pre-validate categories and normalized scriptIds before spinning up the temp SDF project,
            // and deduplicate if the same scriptId was passed multiple times in the batch (last wins).
            const deduplicatedInputs = new Map<string, UpsertCustomFieldInput>();
            for (const item of rawFields) {
                if (!item || typeof item !== "object") {
                    continue;
                }
                const category = normalizeCustomFieldCategory(item.fieldCategory);
                const normalizedId = normalizeCustomFieldScriptId(item.scriptId, category);
                deduplicatedInputs.set(normalizedId, {
                    ...item,
                    fieldCategory: category,
                    scriptId: normalizedId
                });
            }

            const fieldsToProcess = Array.from(deduplicatedInputs.values());
            if (fieldsToProcess.length === 0) {
                throw new Error("No valid custom field definitions were provided in 'fields'.");
            }

            const projectRoot = await getProjectRoot(server);
            const projectConfig = await getProjectConfig(projectRoot);

            return await withTempSdfProject(
                {
                    projectRoot,
                    projectConfig,
                    tempDirPrefix: "netsuite-mcp-field-upsert-"
                },
                async (tempProject) => {
                    const batchObjects: BatchDeploySdfObjectItem[] = [];
                    const allObjectDeps = new Set<string>();
                    const allFeatureDeps = new Set<string>();
                    const createdSummaries: string[] = [];
                    const updatedSummaries: string[] = [];

                    for (const fieldInput of fieldsToProcess) {
                        const { scriptId } = fieldInput;

                        // 1. Check if this custom field already exists in NetSuite
                        let existingXmlContent: string | null = null;
                        try {
                            const downloadedPath = await downloadSdfObjectInTempProject(
                                tempProject,
                                scriptId,
                                "ALL"
                            );
                            if (await fileExists(downloadedPath)) {
                                existingXmlContent = await fs.readFile(downloadedPath, "utf-8");
                            }
                        } catch {
                            existingXmlContent = null;
                        }

                        // 2. Build new XML or merge into existing XML
                        const built = await buildOrMergeCustomFieldXml({
                            input: fieldInput,
                            existingXmlContent
                        });

                        batchObjects.push({
                            scriptId: built.scriptId,
                            xmlContent: built.xmlContent,
                            rootElement: built.rootElement
                        });

                        for (const dep of built.dependencies) {
                            allObjectDeps.add(dep);
                        }
                        for (const feat of built.features) {
                            allFeatureDeps.add(feat);
                        }

                        const targetsNote =
                            built.appliedTargets.length > 0
                                ? ` [${built.appliedTargets.join(", ")}]`
                                : "";
                        if (built.isUpdate) {
                            updatedSummaries.push(`${built.scriptId} (<${built.rootElement}>)${targetsNote}`);
                        } else {
                            createdSummaries.push(`${built.scriptId} (<${built.rootElement}>)${targetsNote}`);
                        }
                    }

                    // Don't list any object in manifest.xml dependencies if it's already part of the deployed batch
                    for (const deployedObj of batchObjects) {
                        allObjectDeps.delete(deployedObj.scriptId.toLowerCase());
                    }

                    const hasObjectDeps = allObjectDeps.size > 0;
                    const hasFeatureDeps = allFeatureDeps.size > 0;
                    const manifestDependencies =
                        hasObjectDeps || hasFeatureDeps
                            ? {
                                  ...(hasObjectDeps ? { objects: Array.from(allObjectDeps) } : {}),
                                  ...(hasFeatureDeps ? { features: Array.from(allFeatureDeps) } : {})
                              }
                            : undefined;

                    // 3. Deploy all custom fields in a single SDF deployment pass
                    const output = await deployObjectsFromTempProject({
                        tempProject,
                        projectRoot,
                        objects: batchObjects,
                        manifestDependencies,
                        options: {
                            saveToProject: args.saveToProject,
                            projectConfig
                        }
                    });

                    const summaryParts: string[] = [];
                    if (createdSummaries.length > 0) {
                        summaryParts.push(
                            `Created ${createdSummaries.length} field(s): ${createdSummaries.join(", ")}`
                        );
                    }
                    if (updatedSummaries.length > 0) {
                        summaryParts.push(
                            `Updated ${updatedSummaries.length} field(s): ${updatedSummaries.join(", ")}`
                        );
                    }

                    const summaryNote =
                        summaryParts.length > 0
                            ? `\n[Upsert Summary: ${summaryParts.join(" | ")}]`
                            : "";

                    return {
                        content: [
                            {
                                type: "text",
                                text: `${output}${summaryNote}`
                            }
                        ]
                    };
                }
            );
        } catch (error: any) {
            return {
                content: [
                    {
                        type: "text",
                        text: `Unexpected Tool Error: ${error.message}`
                    }
                ]
            };
        }
    }
};
