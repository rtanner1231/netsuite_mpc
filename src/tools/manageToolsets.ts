import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { ToolDefinition } from "../types/index.js";
import { TOOL_CATEGORIES } from "../utils/settingsSchema.js";
import {
    EnvironmentConfig,
    activateSessionCategories,
    activateSessionTools,
    clearSessionCategories,
    deactivateSessionCategories,
    deactivateSessionTools,
    getEffectiveEnabledCategories,
    getEnvironmentConfig,
    getSessionActivatedCategories,
    getSessionActivatedTools,
    getSessionDeactivatedCategories,
    getSessionDeactivatedTools,
    getToolCategory,
    getToolDisableReason,
    getToolHardGuardrailReason,
    resolveEnvironmentProfile
} from "../utils/config.js";

const VALID_CATEGORY_IDS = TOOL_CATEGORIES.map(c => c.id);

export const buildManageToolsetsDescription = (
    allTools: ToolDefinition[],
    environment?: string | null,
    config?: EnvironmentConfig | null,
    profileName?: string | null
): string => {
    const baseIntro =
        "Temporarily activates, deactivates, resets, or lists NetSuite tool categories (toolsets) or specific individual tools for the current MCP session without modifying env.json. " +
        "Use this tool whenever the user asks to perform a NetSuite task (such as viewing/creating saved searches or datasets, viewing a file, managing scripts, custom records/lists, translations, or PDF/email templates) whose tools are not currently loaded in your tool list. " +
        "Tip: Pass specific 'tools' (e.g., tools: ['netsuite_view_file']) when you only need 1-2 tools to keep context lean, or 'categories' when you need an entire category workflow.";

    if (!config || !environment) {
        return `${baseIntro}\n\nAvailable tool categories: ${TOOL_CATEGORIES.map(c => `'${c.id}' (${c.title})`).join(", ")}.`;
    }

    const { profileName: resolvedProfileName, profile } = resolveEnvironmentProfile(config, profileName);
    const blockedCategories = new Set(Array.isArray(profile.blockedCategories) ? profile.blockedCategories : []);
    const effectiveCategories = new Set(getEffectiveEnabledCategories(profile));
    const sessionActivated = new Set(getSessionActivatedCategories());
    const selectableTools = allTools.filter(t => !t.meta.alwaysAvailable && t.name !== "netsuite_manage_toolsets");

    const activeLines: string[] = [];
    const inactiveLines: string[] = [];

    for (const cat of TOOL_CATEGORIES) {
        if (blockedCategories.has(cat.id)) {
            continue;
        }
        const catTools = selectableTools.filter(t => getToolCategory(t) === cat.id);
        const currentlyEnabledTools = catTools.filter(t => getToolDisableReason(t, config, resolvedProfileName) === null);
        const eligibleTools = catTools.filter(t => getToolHardGuardrailReason(t, config, resolvedProfileName) === null);
        const isActive = effectiveCategories.has(cat.id) || currentlyEnabledTools.length > 0;

        if (isActive) {
            const tag = sessionActivated.has(cat.id) ? " [session-activated]" : "";
            const dormantTools = eligibleTools.filter(t => !currentlyEnabledTools.some(e => e.name === t.name));
            const dormantNote =
                dormantTools.length > 0
                    ? ` (Inactive eligible tools: ${dormantTools.map(t => t.name).join(", ")})`
                    : "";
            activeLines.push(`- ${cat.id}${tag}: ${cat.title} (${currentlyEnabledTools.length}/${catTools.length} tools active)${dormantNote}`);
        } else {
            const toolNames = eligibleTools.map(t => t.name).join(", ");
            const toolsSummary = eligibleTools.length > 0
                ? `Eligible tools: ${toolNames}`
                : "All tools in this category are currently restricted by profile guardrails (disableDestructive / disableSdf / blockedTools)";
            inactiveLines.push(`- ${cat.id} (${cat.title}): ${cat.description} [${toolsSummary}]`);
        }
    }

    const sections: string[] = [
        baseIntro,
        `Active Environment: '${environment}' (Profile: '${resolvedProfileName}')`
    ];

    if (activeLines.length > 0) {
        sections.push(`Currently Active Categories:\n${activeLines.join("\n")}`);
    }

    if (inactiveLines.length > 0) {
        sections.push(`Inactive Categories Available to Activate:\n${inactiveLines.join("\n")}`);
    } else {
        sections.push("All non-blocked tool categories are currently active in this session.");
    }

    return sections.join("\n\n");
};

export const createManageToolsetsTool = (getAllTools: () => ToolDefinition[]): ToolDefinition => ({
    name: "netsuite_manage_toolsets",
    description: buildManageToolsetsDescription([]),
    meta: {
        isDestructive: false,
        requiresSdf: false
    },
    inputSchema: {
        type: "object",
        properties: {
            action: {
                type: "string",
                enum: ["activate", "deactivate", "reset", "list"],
                description:
                    "Action to perform: 'activate' enables one or more tool categories and/or individual tools for the current session; 'deactivate' disables one or more categories and/or individual tools for the current session; 'reset' clears all temporary session overrides back to the active profile's baseline; 'list' shows all categories and their current tool status."
            },
            categories: {
                type: "array",
                items: {
                    type: "string",
                    enum: VALID_CATEGORY_IDS
                },
                description:
                    `Optional array of tool category IDs to activate or deactivate for the current session. Valid IDs: ${VALID_CATEGORY_IDS.join(", ")}.`
            },
            tools: {
                type: "array",
                items: {
                    type: "string"
                },
                description:
                    "Optional array of specific tool names (e.g., ['netsuite_view_file', 'netsuite_get_script_logs']) to activate or deactivate for the current session when you only need specific tools rather than an entire category."
            }
        },
        required: ["action"]
    },
    execute: async (
        args: { action: "activate" | "deactivate" | "reset" | "list"; categories?: string[]; tools?: string[] },
        server: Server
    ) => {
        try {
            const { environment, config, profileName, profile } = await getEnvironmentConfig();

            if (profile.allowDynamicActivation === false) {
                return {
                    content: [{
                        type: "text",
                        text: `Dynamic toolset activation is disabled for profile '${profileName}' in environment '${environment}'.`
                    }],
                    isError: true
                };
            }

            const allTools = getAllTools().filter(
                t => !t.meta.alwaysAvailable && t.name !== "netsuite_manage_toolsets"
            );
            const toolByName = new Map<string, ToolDefinition>(allTools.map(t => [t.name, t]));

            const action = args?.action;
            const rawCategories = Array.isArray(args?.categories) ? args.categories : [];
            const rawTools = Array.isArray(args?.tools) ? args.tools : [];

            const validRequestedCategories: string[] = [];
            const invalidRequestedCategories: string[] = [];

            for (const c of rawCategories) {
                const trimmed = typeof c === "string" ? c.trim() : "";
                if (!trimmed) continue;
                if (VALID_CATEGORY_IDS.includes(trimmed)) {
                    validRequestedCategories.push(trimmed);
                } else {
                    invalidRequestedCategories.push(trimmed);
                }
            }

            if (invalidRequestedCategories.length > 0) {
                return {
                    content: [{
                        type: "text",
                        text: `Invalid category ID(s): ${invalidRequestedCategories.join(", ")}. Valid categories are: ${VALID_CATEGORY_IDS.join(", ")}.`
                    }],
                    isError: true
                };
            }

            const validRequestedTools: string[] = [];
            const invalidRequestedTools: string[] = [];

            for (const t of rawTools) {
                const trimmed = typeof t === "string" ? t.trim() : "";
                if (!trimmed) continue;
                if (toolByName.has(trimmed)) {
                    validRequestedTools.push(trimmed);
                } else {
                    invalidRequestedTools.push(trimmed);
                }
            }

            if (invalidRequestedTools.length > 0) {
                return {
                    content: [{
                        type: "text",
                        text: `Unknown tool name(s): ${invalidRequestedTools.join(", ")}. Valid selectable tools are: ${allTools.map(t => t.name).join(", ")}.`
                    }],
                    isError: true
                };
            }

            if (
                (action === "activate" || action === "deactivate") &&
                validRequestedCategories.length === 0 &&
                validRequestedTools.length === 0
            ) {
                return {
                    content: [{
                        type: "text",
                        text: `Error: Provide at least one category in 'categories' or tool name in 'tools' when action is '${action}'.`
                    }],
                    isError: true
                };
            }

            const blockedCategories = new Set(Array.isArray(profile.blockedCategories) ? profile.blockedCategories : []);

            let actionSummary = "";
            if (action === "activate") {
                const blockedReqCats = validRequestedCategories.filter(c => blockedCategories.has(c));
                const allowedReqCats = validRequestedCategories.filter(c => !blockedCategories.has(c));

                const blockedReqTools: { name: string; reason: string }[] = [];
                const allowedReqTools: string[] = [];

                for (const tName of validRequestedTools) {
                    const toolDef = toolByName.get(tName)!;
                    const guardrailReason = getToolHardGuardrailReason(toolDef, config, profileName);
                    if (guardrailReason) {
                        blockedReqTools.push({ name: tName, reason: guardrailReason });
                    } else {
                        allowedReqTools.push(tName);
                    }
                }

                if (allowedReqCats.length > 0) {
                    activateSessionCategories(allowedReqCats);
                }
                if (allowedReqTools.length > 0) {
                    activateSessionTools(allowedReqTools);
                }

                if (allowedReqCats.length > 0 || allowedReqTools.length > 0) {
                    try {
                        await server.sendToolListChanged();
                    } catch (err: any) {
                        console.error(`Warning: Failed to send tool list changed notification: ${err?.message || err}`);
                    }
                }

                const parts: string[] = [];
                if (allowedReqCats.length > 0) {
                    parts.push(`Activated category(s) for current session: ${allowedReqCats.join(", ")}.`);
                }
                if (allowedReqTools.length > 0) {
                    parts.push(`Activated tool(s) for current session: ${allowedReqTools.join(", ")}.`);
                }
                if (blockedReqCats.length > 0) {
                    parts.push(`Could not activate blocked category(s) [${blockedReqCats.join(", ")}] (hard-blocked in profile '${profileName}').`);
                }
                if (blockedReqTools.length > 0) {
                    parts.push(
                        `Could not activate restricted tool(s): ${blockedReqTools.map(b => `${b.name} (${b.reason})`).join(", ")}.`
                    );
                }
                actionSummary = parts.join(" ");
            } else if (action === "deactivate") {
                if (validRequestedCategories.length > 0) {
                    deactivateSessionCategories(validRequestedCategories);
                }
                if (validRequestedTools.length > 0) {
                    deactivateSessionTools(validRequestedTools);
                }
                try {
                    await server.sendToolListChanged();
                } catch (err: any) {
                    console.error(`Warning: Failed to send tool list changed notification: ${err?.message || err}`);
                }
                const parts: string[] = [];
                if (validRequestedCategories.length > 0) {
                    parts.push(`Deactivated category(s) for current session: ${validRequestedCategories.join(", ")}.`);
                }
                if (validRequestedTools.length > 0) {
                    parts.push(`Deactivated tool(s) for current session: ${validRequestedTools.join(", ")}.`);
                }
                actionSummary = parts.join(" ");
            } else if (action === "reset") {
                clearSessionCategories();
                try {
                    await server.sendToolListChanged();
                } catch (err: any) {
                    console.error(`Warning: Failed to send tool list changed notification: ${err?.message || err}`);
                }
                actionSummary = `Reset all session toolset and individual tool overrides back to baseline profile '${profileName}'.`;
            } else if (action !== "list") {
                return {
                    content: [{
                        type: "text",
                        text: `Invalid action '${String(action)}'. Expected 'activate', 'deactivate', 'reset', or 'list'.`
                    }],
                    isError: true
                };
            }

            const effectiveCategories = new Set(getEffectiveEnabledCategories(profile));
            const baselineCategories = new Set(profile.enabledCategories || []);
            const sessionAddedCats = new Set(getSessionActivatedCategories());
            const sessionRemovedCats = new Set(getSessionDeactivatedCategories());
            const sessionAddedTools = getSessionActivatedTools();
            const sessionRemovedTools = getSessionDeactivatedTools();

            const lines: string[] = [];
            if (actionSummary) {
                lines.push(actionSummary);
                lines.push("");
            }

            lines.push(`Environment: ${environment} (Profile: ${profileName})`);
            lines.push(
                `Profile Guardrails: disableDestructive=${Boolean(profile.disableDestructive)}, disableSdf=${Boolean(profile.disableSdf)}, sdfIdConfigured=${Boolean(config.sdfId && config.sdfId.trim())}`
            );
            if (sessionAddedTools.length > 0) {
                lines.push(`Session-Activated Individual Tools: ${sessionAddedTools.join(", ")}`);
            }
            if (sessionRemovedTools.length > 0) {
                lines.push(`Session-Deactivated Individual Tools: ${sessionRemovedTools.join(", ")}`);
            }
            lines.push("");
            lines.push("Tool Categories Status:");

            for (const cat of TOOL_CATEGORIES) {
                const isCatBlocked = blockedCategories.has(cat.id);
                const catTools = allTools.filter(t => getToolCategory(t) === cat.id);
                const enabledCatTools = catTools.filter(t => getToolDisableReason(t, config, profileName) === null);
                const isActive = !isCatBlocked && (effectiveCategories.has(cat.id) || enabledCatTools.length > 0);
                const isBaseline = baselineCategories.has(cat.id);

                let stateLabel = isCatBlocked
                    ? "BLOCKED (profile.blockedCategories)"
                    : effectiveCategories.has(cat.id)
                        ? "ACTIVE"
                        : enabledCatTools.length > 0
                            ? "PARTIALLY ACTIVE (individual tools)"
                            : "INACTIVE";

                if (!isCatBlocked && effectiveCategories.has(cat.id) && !isBaseline && sessionAddedCats.has(cat.id)) {
                    stateLabel = "ACTIVE (session override)";
                } else if (!isCatBlocked && !effectiveCategories.has(cat.id) && isBaseline && sessionRemovedCats.has(cat.id)) {
                    stateLabel = "INACTIVE (session override)";
                }

                const guardrailBlockedTools = catTools
                    .map(t => ({ name: t.name, reason: getToolHardGuardrailReason(t, config, profileName) }))
                    .filter((item): item is { name: string; reason: string } => item.reason !== null);

                lines.push(`- ${cat.id} (${cat.title}): ${stateLabel}`);
                if (isCatBlocked) {
                    lines.push(`    Blocked by profile.blockedCategories (${catTools.length} tools locked)`);
                } else if (isActive) {
                    if (enabledCatTools.length > 0) {
                        lines.push(`    Enabled tools (${enabledCatTools.length}): ${enabledCatTools.map(t => t.name).join(", ")}`);
                    } else {
                        lines.push("    Enabled tools: none");
                    }
                    const inactiveEligible = catTools.filter(
                        t =>
                            getToolDisableReason(t, config, profileName) !== null &&
                            getToolHardGuardrailReason(t, config, profileName) === null
                    );
                    if (inactiveEligible.length > 0) {
                        lines.push(`    Inactive eligible tools (${inactiveEligible.length}): ${inactiveEligible.map(t => t.name).join(", ")}`);
                    }
                    if (guardrailBlockedTools.length > 0) {
                        lines.push(
                            `    Blocked by profile guardrails (${guardrailBlockedTools.length}): ${guardrailBlockedTools.map(b => `${b.name} [${b.reason}]`).join(", ")}`
                        );
                    }
                } else {
                    const eligibleIfActivated = catTools.filter(
                        t => getToolHardGuardrailReason(t, config, profileName) === null
                    );
                    lines.push(
                        `    Eligible tools if activated (${eligibleIfActivated.length}/${catTools.length}): ${eligibleIfActivated.map(t => t.name).join(", ") || "none (restricted by profile guardrails)"}`
                    );
                }
            }

            return {
                content: [{
                    type: "text",
                    text: lines.join("\n")
                }]
            };
        } catch (error: any) {
            return {
                content: [{
                    type: "text",
                    text: `Error managing toolsets: ${error.message}`
                }],
                isError: true
            };
        }
    }
});
