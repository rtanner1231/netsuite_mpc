import fs from "fs/promises";
import { ToolDefinition } from "../types/index.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { deploySdfObject, downloadSdfObject } from "../utils/objects.js";
import { getProjectRoot } from "../utils/mcp.js";
import { CustomRecordField, mapCustomRecordFields } from "../utils/customRecords.js";
import { create } from "xmlbuilder2";

type RecordUpdateCustomRecord = {
    scriptId: string;
    name?: string;
    includeNameField?: boolean;
    fields?: CustomRecordField[];
}

export const updateCustomRecordTool: ToolDefinition = {
    name: "netsuite_update_custom_record",
    description: "Updates and deploys an existing Custom Record Type in NetSuite via SDF. Allows modifying header values and adding new fields.",
    inputSchema: {
        type: "object",
        properties: {
            scriptId: {
                type: "string",
                description: "The internal ID of the custom record. Must start with 'customrecord_'."
            },
            name: {
                type: "string",
                description: "(Optional) The updated name/label of the custom record."
            },
            includeNameField: {
                type: "boolean",
                description: "(Optional) Indicate if the native name field should be included."
            },
            fields: {
                type: "array",
                description: "(Optional) An array of NEW custom fields to add to the record. Existing fields cannot be updated.",
                items: {
                    type: "object",
                    properties: {
                        scriptId: { type: "string", description: "Internal ID of the field. Must start with 'custrecord_'." },
                        label: { type: "string", description: "The label displayed in the UI for this field." },
                        type: { type: "string", description: "Field type (e.g., 'TEXT', 'INTEGER', 'SELECT', 'DATE', 'CHECKBOX', 'CURRENCY')", enum: ["CHECKBOX", "CLOBTEXT", "CURRENCY", "DATE", "DATETIMETZ", "DOCUMENT", "EMAIL", "FLOAT", "HELP", "IMAGE", "INLINEHTML", "INTEGER", "MULTISELECT", "PASSWORD", "PERCENT", "PHONE", "RICHTEXT", "SELECT", "TEXT", "TEXTAREA", "TIMEOFDAY", "URL"] },
                        selectRecordType: { type: "string", description: "Required ONLY if type is SELECT or MULTISELECT. The scriptId of the record or list it references." },
                        helpText: { type: "string", description: "Optional help text for the field." }
                    },
                    required: ["scriptId", "label", "type"]
                }
            }
        },
        required: ["scriptId"]
    },
    execute: async (args: RecordUpdateCustomRecord, server: Server) => {
        try {
            const { scriptId, name, fields, includeNameField } = args;
            const projectRoot = await getProjectRoot(server);

            // 1. Download the most up-to-date XML from the NetSuite account
            const filePath = await downloadSdfObject(projectRoot, scriptId, "ALL"); // Use "ALL" or "customrecordtype"? CLI docs say type is ALL or specific. customrecordtype is typical. 

            // 2. Parse the downloaded file
            const xmlContent = await fs.readFile(filePath, "utf-8");
            const obj = create(xmlContent).toObject() as any;

            if (!obj.customrecordtype) {
                return { content: [{ type: "text", text: `Error: Could not parse customrecordtype from the downloaded object.` }] };
            }

            // 3. Modify properties
            if (name !== undefined) {
                obj.customrecordtype.recordname = name;
            }
            if (includeNameField !== undefined) {
                obj.customrecordtype.includename = includeNameField ? 'T' : 'F';
            }

            if (fields && fields.length > 0) {
                const mappedFields = await mapCustomRecordFields(fields);
                
                if (!obj.customrecordtype.customrecordcustomfields) {
                    obj.customrecordtype.customrecordcustomfields = {};
                }
                if (!obj.customrecordtype.customrecordcustomfields.customrecordcustomfield) {
                    obj.customrecordtype.customrecordcustomfields.customrecordcustomfield = [];
                }

                let existingFields = obj.customrecordtype.customrecordcustomfields.customrecordcustomfield;
                if (!Array.isArray(existingFields)) {
                    existingFields = [existingFields];
                }
                
                existingFields.push(...mappedFields);
                obj.customrecordtype.customrecordcustomfields.customrecordcustomfield = existingFields;
            }

            // 4. Calculate manifest dependencies
            const manifestDependencies: { objects: string[] } = { objects: [] };
            if (obj.customrecordtype.customrecordcustomfields?.customrecordcustomfield) {
                let allFields = obj.customrecordtype.customrecordcustomfields.customrecordcustomfield;
                if (!Array.isArray(allFields)) {
                    allFields = [allFields];
                }
                
                const deps = new Set<string>();
                for (const f of allFields) {
                    const selType = f.selectrecordtype;
                    if (typeof selType === 'string') {
                        if (selType.startsWith('[scriptid=customrecord')) {
                            const match = selType.match(/\[scriptid=(.*?)\]/);
                            if (match) deps.add(match[1]);
                        } else if (selType.startsWith('customrecord')) {
                            deps.add(selType);
                        }
                    }
                }
                if (deps.size > 0) {
                    manifestDependencies.objects = Array.from(deps);
                }
            }

            // 5. Convert back to XML and deploy
            const updatedXml = create({ version: "1.0", encoding: "UTF-8" }, obj).end({ prettyPrint: true });
            const output = await deploySdfObject(projectRoot, scriptId, updatedXml, manifestDependencies.objects.length > 0 ? manifestDependencies : undefined);

            return { content: [{ type: "text", text: output }] };
        } catch (error: any) {
            return { content: [{ type: "text", text: `Unexpected Tool Error: ${error.message}` }] };
        }
    }
};