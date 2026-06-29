import { ToolDefinition } from "../types/index.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { generateAndDeploySdf } from "../utils/objects.js";
import { applyDefaults } from "../defaults/index.js";
import { ObjectDefaultType } from "../defaults/types.js";

type ListCreateValue = {
    scriptId: string;
    value: string;
};

type ListCreateCustomList = {
    scriptId: string;
    name: string;
    values: ListCreateValue[];
};

export const createCustomListTool: ToolDefinition = {
    name: "netsuite_create_custom_list",
    description: "Creates and deploys a new Custom List in NetSuite via SDF.",
    inputSchema: {
        type: "object",
        properties: {
            scriptId: {
                type: "string",
                description: "The internal ID of the custom list. Must start with 'customlist_'. Maximum length is 38 characters."
            },
            name: {
                type: "string",
                description: "The name/label of the custom list. Maximum length is 30 characters."
            },
            values: {
                type: "array",
                description: "An array of custom values to add to the list.",
                items: {
                    type: "object",
                    properties: {
                        scriptId: {
                            type: "string",
                            description: "Internal ID of the custom value. Maximum length is 40 characters."
                        },
                        value: {
                            type: "string",
                            description: "The text value for the list item."
                        }
                    },
                    required: ["scriptId", "value"]
                }
            }
        },
        required: ["scriptId", "name", "values"]
    },
    execute: async (args: ListCreateCustomList, server: Server) => {
        const { scriptId, name, values } = args;

        const mappedValues = values ? values.map((val) => {
            return {
                "@scriptid": val.scriptId,
                value: val.value,
            };
        }) : [];

        const baseListData = {
            name: name,
            ...(mappedValues && mappedValues.length > 0 && {
                customvalues: {
                    customvalue: mappedValues
                }
            })
        };

        const sdfData = await applyDefaults(baseListData, ObjectDefaultType.LIST);

        return await generateAndDeploySdf({
            rootElement: "customlist",
            scriptId,
            data: sdfData,
            server
        });
    }
};
