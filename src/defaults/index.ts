// This module handles loading application defaults and user defaults
// These defaults are merged with the LLM output to create the final object

import { ObjectDefaultType } from "./types.js";
import { recordDefaults } from "./objectDefaults/recordDefaults.js";
import { fieldDefaults } from "./objectDefaults/fieldDefaults.js";
import { getUserDefaults } from "../utils/config.js";
import { listDefaults } from "./objectDefaults/listDefaults.js";

const projectDefaultsMap: Record<ObjectDefaultType, Record<string, any>> = {
    [ObjectDefaultType.RECORD]: recordDefaults,
    [ObjectDefaultType.FIELD]: fieldDefaults,
    [ObjectDefaultType.LIST]: listDefaults
};

export const applyDefaults = async (
    llmObject: Record<string, any>,
    type: ObjectDefaultType
): Promise<Record<string, any>> => {
    const projectDefaults = projectDefaultsMap[type];
    const userDefaults = await getUserDefaults(type);

    let filteredUserDefaults: Record<string, any> = {};

    if (userDefaults) {
        for (const key of Object.keys(userDefaults)) {
            if (key in projectDefaults) {
                filteredUserDefaults[key] = userDefaults[key];
            }
        }
    }

    return {
        ...projectDefaults,
        ...filteredUserDefaults,
        ...llmObject
    };
};
