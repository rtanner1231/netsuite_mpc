import fs from "fs/promises";
import { ToolDefinition } from "../types/index.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
    deployObjectFromTempProject,
    downloadSdfObjectInTempProject,
    getSaveToProjectSchemaProperty
} from "../utils/objects.js";
import { getProjectRoot } from "../utils/mcp.js";
import { getProjectConfig } from "../utils/project.js";
import { withTempSdfProject } from "../utils/tempSdfProject.js";
import { applyDefaults } from "../defaults/index.js";
import { ObjectDefaultType } from "../defaults/types.js";
import { create } from "xmlbuilder2";

type ListUpsertValue = {
    scriptId: string;
    value: string;
};

type ListUpsertCustomList = {
    scriptId: string;
    name?: string;
    description?: string;
    values: ListUpsertValue[];
    saveToProject?: boolean;
};

const fileExists = async (targetPath: string): Promise<boolean> => {
    try {
        await fs.access(targetPath);
        return true;
    } catch {
        return false;
    }
};

const normalizeCustomListScriptId = (rawScriptId: string): string => {
    let id = (rawScriptId || "").trim();
    if (!id) {
        throw new Error("'scriptId' is required.");
    }

    if (id.toLowerCase().endsWith(".xml")) {
        id = id.slice(0, -".xml".length);
    }

    id = id.trim().toLowerCase();
    if (!id) {
        throw new Error("'scriptId' cannot be empty.");
    }

    if (!id.startsWith("customlist_")) {
        id = `customlist_${id.replace(/^_+/, "")}`;
    }

    if (id.length > 38) {
        throw new Error(
            `Custom List scriptId '${id}' is ${id.length} characters long, exceeding the NetSuite SDF limit of 38 characters.`
        );
    }

    return id;
};

const extractNodeText = (node: any): string => {
    if (node === undefined || node === null) return "";
    if (typeof node === "string" || typeof node === "number" || typeof node === "boolean") {
        return String(node);
    }
    if (typeof node === "object" && node["#"] !== undefined && node["#"] !== null) {
        return String(node["#"]);
    }
    return "";
};

const setNodeTextPreservingAttrs = (existingNode: any, newText: string): any => {
    if (existingNode && typeof existingNode === "object" && !Array.isArray(existingNode)) {
        return {
            ...existingNode,
            "#": newText
        };
    }
    return newText;
};

export const upsertCustomListTool: ToolDefinition = {
    name: "netsuite_upsert_custom_list",
    description:
        "Creates or updates a Custom List (customlist_*) and its list values in NetSuite via an isolated temporary SDF project. Tip: Before updating an existing custom list in a new session, call 'netsuite_view_custom_object' to inspect its current list value 'scriptId's and labels. If the custom list already exists in NetSuite, its current definition is downloaded and merged: incoming values with a matching value scriptId update the existing item's label, incoming values whose label already exists under a different scriptId are deduplicated (skipped), and new values are appended. If the custom list does not exist, a new Custom List is created ('name' is required on creation) with configured list defaults applied. Optionally copies the deployed XML into the local project.",
    meta: {
        isDestructive: true,
        requiresSdf: true
    },
    inputSchema: {
        type: "object",
        properties: {
            scriptId: {
                type: "string",
                description:
                    "The internal ID of the custom list to create or update. Must start with 'customlist_' (auto-prepended if omitted). Maximum length is 38 characters."
            },
            name: {
                type: "string",
                description:
                    "The name/label of the custom list (maximum length is 30 characters). Required when creating a new custom list; optional when updating an existing custom list."
            },
            description: {
                type: "string",
                description:
                    "(Optional) Description of the custom list."
            },
            values: {
                type: "array",
                description:
                    "An array of custom values to add or update on the list. When updating an existing list: if an item's 'scriptId' matches an existing list value, its label ('value') is updated; if its label ('value') already exists on the list under another 'scriptId' (case-insensitive), it is skipped to prevent duplicate labels; otherwise it is appended as a new list value.",
                items: {
                    type: "object",
                    properties: {
                        scriptId: {
                            type: "string",
                            description: "Internal ID of the custom value. Maximum length is 40 characters."
                        },
                        value: {
                            type: "string",
                            description: "The text label/value for the list item."
                        }
                    },
                    required: ["scriptId", "value"]
                }
            },
            saveToProject: getSaveToProjectSchemaProperty()
        },
        required: ["scriptId", "values"]
    },
    execute: async (args: ListUpsertCustomList, server: Server) => {
        try {
            const scriptId = normalizeCustomListScriptId(args.scriptId);
            const { name, description, values = [], saveToProject } = args;

            if (name !== undefined && name.trim().length > 30) {
                throw new Error(
                    `'name' is ${name.trim().length} characters long, exceeding the NetSuite SDF limit of 30 characters.`
                );
            }

            // Normalize and deduplicate incoming values within the batch itself
            const normalizedIncoming: ListUpsertValue[] = [];
            const seenBatchScriptIds = new Map<string, number>();
            const seenBatchLabels = new Set<string>();

            for (const item of values) {
                const valScriptId = (item?.scriptId || "").trim();
                const valText = (item?.value || "").trim();
                if (!valScriptId || !valText) {
                    continue;
                }
                if (valScriptId.length > 40) {
                    throw new Error(
                        `Custom value scriptId '${valScriptId}' is ${valScriptId.length} characters long, exceeding the NetSuite SDF limit of 40 characters.`
                    );
                }

                const lowerId = valScriptId.toLowerCase();
                const lowerLabel = valText.toLowerCase();

                if (seenBatchScriptIds.has(lowerId)) {
                    // Update label for the same scriptId within the incoming batch
                    const existingIdx = seenBatchScriptIds.get(lowerId)!;
                    const prevLabel = normalizedIncoming[existingIdx].value.toLowerCase();
                    seenBatchLabels.delete(prevLabel);
                    normalizedIncoming[existingIdx].value = valText;
                    seenBatchLabels.add(lowerLabel);
                } else if (seenBatchLabels.has(lowerLabel)) {
                    // Duplicate label with a different scriptId in the same batch — skip
                    continue;
                } else {
                    seenBatchScriptIds.set(lowerId, normalizedIncoming.length);
                    seenBatchLabels.add(lowerLabel);
                    normalizedIncoming.push({
                        scriptId: valScriptId,
                        value: valText
                    });
                }
            }

            const projectRoot = await getProjectRoot(server);
            const projectConfig = await getProjectConfig(projectRoot);

            return await withTempSdfProject(
                {
                    projectRoot,
                    projectConfig,
                    tempDirPrefix: "netsuite-mcp-list-upsert-"
                },
                async (tempProject) => {
                    // 1. Attempt to download the existing custom list from NetSuite
                    let existingFilePath: string | null = null;
                    try {
                        const downloadedPath = await downloadSdfObjectInTempProject(tempProject, scriptId, "ALL");
                        if (await fileExists(downloadedPath)) {
                            existingFilePath = downloadedPath;
                        }
                    } catch {
                        existingFilePath = null;
                    }

                    // 2. UPDATE FLOW: list already exists in NetSuite
                    if (existingFilePath) {
                        const xmlContent = await fs.readFile(existingFilePath, "utf-8");
                        const obj = create(xmlContent).toObject() as any;

                        if (!obj.customlist || typeof obj.customlist !== "object") {
                            return {
                                content: [
                                    {
                                        type: "text",
                                        text: `Error: Could not parse <customlist> from the downloaded object '${scriptId}'.`
                                    }
                                ]
                            };
                        }

                        if (name !== undefined && name.trim() !== "") {
                            obj.customlist.name = setNodeTextPreservingAttrs(obj.customlist.name, name.trim());
                        }
                        if (description !== undefined) {
                            obj.customlist.description = setNodeTextPreservingAttrs(
                                obj.customlist.description,
                                description
                            );
                        }

                        if (!obj.customlist.customvalues || typeof obj.customlist.customvalues !== "object") {
                            obj.customlist.customvalues = {};
                        }

                        let existingValues: any[] = [];
                        if (obj.customlist.customvalues.customvalue) {
                            existingValues = Array.isArray(obj.customlist.customvalues.customvalue)
                                ? obj.customlist.customvalues.customvalue
                                : [obj.customlist.customvalues.customvalue];
                        }

                        const addedValues: string[] = [];
                        const updatedValues: string[] = [];
                        const skippedDuplicateLabels: string[] = [];

                        for (const incoming of normalizedIncoming) {
                            const incomingIdLower = incoming.scriptId.toLowerCase();
                            const incomingLabelLower = incoming.value.toLowerCase();

                            // Check for matching scriptId first (updates label on matching scriptId)
                            const matchById = existingValues.find(
                                (ev) =>
                                    ev &&
                                    typeof ev === "object" &&
                                    String(ev["@scriptid"] || "").trim().toLowerCase() === incomingIdLower
                            );

                            if (matchById) {
                                const currentLabel = extractNodeText(matchById.value).trim();
                                if (currentLabel !== incoming.value) {
                                    matchById.value = setNodeTextPreservingAttrs(matchById.value, incoming.value);
                                    updatedValues.push(`${incoming.scriptId} -> "${incoming.value}"`);
                                }
                                continue;
                            }

                            // Check for matching label (case-insensitive) under a different scriptId
                            const matchByLabel = existingValues.find(
                                (ev) =>
                                    ev &&
                                    typeof ev === "object" &&
                                    extractNodeText(ev.value).trim().toLowerCase() === incomingLabelLower
                            );

                            if (matchByLabel) {
                                skippedDuplicateLabels.push(
                                    `"${incoming.value}" (already exists as '${matchByLabel["@scriptid"]}')`
                                );
                                continue;
                            }

                            // Otherwise append as a new customvalue
                            existingValues.push({
                                "@scriptid": incoming.scriptId,
                                value: incoming.value
                            });
                            addedValues.push(`${incoming.scriptId} ("${incoming.value}")`);
                        }

                        if (existingValues.length > 0) {
                            obj.customlist.customvalues.customvalue = existingValues;
                        }

                        const updatedXml = create({ version: "1.0", encoding: "UTF-8" }, obj).end({
                            prettyPrint: true
                        });

                        const output = await deployObjectFromTempProject({
                            tempProject,
                            projectRoot,
                            scriptId,
                            xmlContent: updatedXml,
                            options: {
                                saveToProject,
                                rootElement: "customlist",
                                projectConfig
                            }
                        });

                        const summaryParts: string[] = [];
                        if (addedValues.length > 0) {
                            summaryParts.push(`Added ${addedValues.length} value(s): ${addedValues.join(", ")}`);
                        }
                        if (updatedValues.length > 0) {
                            summaryParts.push(`Updated ${updatedValues.length} value(s): ${updatedValues.join(", ")}`);
                        }
                        if (skippedDuplicateLabels.length > 0) {
                            summaryParts.push(
                                `Skipped ${skippedDuplicateLabels.length} duplicate label(s): ${skippedDuplicateLabels.join(", ")}`
                            );
                        }
                        const summaryNote =
                            summaryParts.length > 0
                                ? `\n[Upsert Summary (updated '${scriptId}'): ${summaryParts.join(" | ")}]`
                                : `\n[Upsert Summary (updated '${scriptId}'): No new or changed list values]`;

                        return { content: [{ type: "text", text: `${output}${summaryNote}` }] };
                    }

                    // 3. CREATE FLOW: list does not exist yet in NetSuite
                    if (!name || !name.trim()) {
                        throw new Error(
                            `'name' is required when creating a new Custom List ('${scriptId}' does not exist in NetSuite yet).`
                        );
                    }

                    const mappedValues = normalizedIncoming.map((val) => ({
                        "@scriptid": val.scriptId,
                        value: val.value
                    }));

                    const baseListData: Record<string, any> = {
                        name: name.trim(),
                        ...(description !== undefined ? { description } : {}),
                        ...(mappedValues.length > 0 && {
                            customvalues: {
                                customvalue: mappedValues
                            }
                        })
                    };

                    const sdfData = await applyDefaults(baseListData, ObjectDefaultType.LIST);
                    const xmlObject = {
                        customlist: {
                            "@scriptid": scriptId,
                            ...sdfData
                        }
                    };
                    const createdXml = create({ version: "1.0", encoding: "UTF-8" }, xmlObject).end({
                        prettyPrint: true
                    });

                    const output = await deployObjectFromTempProject({
                        tempProject,
                        projectRoot,
                        scriptId,
                        xmlContent: createdXml,
                        options: {
                            saveToProject,
                            rootElement: "customlist",
                            projectConfig
                        }
                    });

                    return { content: [{ type: "text", text: output }] };
                }
            );
        } catch (error: any) {
            return { content: [{ type: "text", text: `Unexpected Tool Error: ${error.message}` }] };
        }
    }
};
