import http from "http";
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { exec } from "child_process";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { ToolDefinition } from "../types/index.js";
import {
    MCP_DIR,
    EnvironmentConfig,
    getActiveEnvironmentOrNull,
    getAllEnvironmentsOrEmpty,
    getAppConfigOrEmpty,
    saveAllEnvironments,
    saveAppConfig,
    setOrClearActiveEnvironment
} from "./config.js";
import { ENVIRONMENT_CREDENTIAL_FIELDS, getGlobalSectionsSchema } from "./settingsSchema.js";
import { renderSettingsHtml } from "./settingsHtml.js";
import { callNetsuiteRestletWithCredentials } from "./api.js";
import { getLanceDbPath, getSqliteDbPath } from "./vectorDb.js";
import { getRebuildState, startBackgroundRebuild } from "../tools/rebuildVectorDatabase.js";

interface SettingsServerInstance {
    server: http.Server;
    port: number;
    token: string;
    url: string;
    inactivityTimer: NodeJS.Timeout;
}

let activeInstance: SettingsServerInstance | null = null;
const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const MAX_JSON_BODY_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_SQLITE_BODY_BYTES = 250 * 1024 * 1024; // 250 MB

const resetInactivityTimer = (instance: SettingsServerInstance) => {
    clearTimeout(instance.inactivityTimer);
    instance.inactivityTimer = setTimeout(() => {
        try {
            instance.server.close();
        } catch {
            // ignore
        }
        if (activeInstance === instance) {
            activeInstance = null;
        }
    }, INACTIVITY_TIMEOUT_MS);
    instance.inactivityTimer.unref?.();
};

export const openUrlInBrowser = (url: string): Promise<boolean> => {
    return new Promise((resolve) => {
        let cmd: string;
        if (process.platform === "win32") {
            cmd = `cmd /c start "" "${url}"`;
        } else if (process.platform === "darwin") {
            cmd = `open "${url}"`;
        } else {
            cmd = `xdg-open "${url}"`;
        }

        exec(cmd, (error) => {
            if (error) {
                resolve(false);
            } else {
                resolve(true);
            }
        });
    });
};

const readRequestBody = (req: http.IncomingMessage): Promise<string> => {
    return new Promise((resolve, reject) => {
        let body = "";
        req.on("data", (chunk) => {
            body += chunk.toString();
            if (body.length > MAX_JSON_BODY_BYTES) {
                reject(new Error("Payload too large"));
            }
        });
        req.on("end", () => resolve(body));
        req.on("error", reject);
    });
};

const readRequestBuffer = (req: http.IncomingMessage, maxBytes = MAX_SQLITE_BODY_BYTES): Promise<Buffer> => {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        let total = 0;
        req.on("data", (chunk: Buffer) => {
            const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            total += buf.length;
            if (total > maxBytes) {
                reject(new Error(`File exceeds maximum allowed size (${Math.round(maxBytes / (1024 * 1024))} MB).`));
                return;
            }
            chunks.push(buf);
        });
        req.on("end", () => resolve(Buffer.concat(chunks)));
        req.on("error", reject);
    });
};

const sendJson = (res: http.ServerResponse, statusCode: number, data: any) => {
    res.writeHead(statusCode, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
    });
    res.end(JSON.stringify(data));
};

const validateEnvNameForFilename = (envName: string): string => {
    const trimmed = envName.trim();
    if (!trimmed) {
        throw new Error("Environment name cannot be empty.");
    }
    if (/[\/\\]/.test(trimmed) || trimmed === "." || trimmed === "..") {
        throw new Error("Environment name cannot contain path separators.");
    }
    return trimmed;
};

const inspectSqliteTableCount = async (sqlitePath: string): Promise<number | null> => {
    let db;
    try {
        db = await open({
            filename: sqlitePath,
            driver: sqlite3.Database,
            mode: sqlite3.OPEN_READONLY
        });
        const row = await db.get<{ cnt: number }>("SELECT COUNT(*) as cnt FROM tables");
        return typeof row?.cnt === "number" ? row.cnt : null;
    } catch {
        return null;
    } finally {
        if (db) {
            try {
                await db.close();
            } catch {
                // ignore
            }
        }
    }
};

const validateUploadedSqliteSchema = async (sqlitePath: string): Promise<{ tableCount: number; fieldCount: number }> => {
    let db;
    try {
        db = await open({
            filename: sqlitePath,
            driver: sqlite3.Database,
            mode: sqlite3.OPEN_READONLY
        });
        const tablesRow = await db.get<{ cnt: number }>("SELECT COUNT(*) as cnt FROM tables");
        const fieldsRow = await db.get<{ cnt: number }>("SELECT COUNT(*) as cnt FROM tablefields");
        return {
            tableCount: tablesRow?.cnt ?? 0,
            fieldCount: fieldsRow?.cnt ?? 0
        };
    } catch (err: any) {
        throw new Error(
            `The selected file is not a valid NetSuite MCP schema database (expected 'tables' and 'tablefields' tables): ${err?.message || err}`
        );
    } finally {
        if (db) {
            try {
                await db.close();
            } catch {
                // ignore
            }
        }
    }
};

const getEnvironmentDatabaseStatus = async (envNameRaw: string) => {
    const envName = validateEnvNameForFilename(envNameRaw);
    const sqlitePath = getSqliteDbPath(envName);
    const lancePath = getLanceDbPath(envName);

    let sqliteExists = false;
    let sqliteSize = 0;
    let sqliteModifiedAt: number | null = null;
    let sqliteTableCount: number | null = null;

    try {
        const st = await fs.stat(sqlitePath);
        if (st.isFile()) {
            sqliteExists = true;
            sqliteSize = st.size;
            sqliteModifiedAt = st.mtimeMs;
            sqliteTableCount = await inspectSqliteTableCount(sqlitePath);
        }
    } catch {
        sqliteExists = false;
    }

    let lanceExists = false;
    let lanceModifiedAt: number | null = null;
    try {
        const st = await fs.stat(lancePath);
        if (st.isDirectory()) {
            lanceExists = true;
            lanceModifiedAt = st.mtimeMs;
        }
    } catch {
        lanceExists = false;
    }

    const rebuildState = getRebuildState(envName) || null;

    return {
        environment: envName,
        sqlitePath,
        lancePath,
        sqliteExists,
        sqliteSize,
        sqliteModifiedAt,
        sqliteTableCount,
        lanceExists,
        lanceModifiedAt,
        rebuildState
    };
};

export const startOrGetSettingsServer = async (
    mcpServer: Server,
    getToolsRegistry: () => ToolDefinition[]
): Promise<{ url: string; browserOpened: boolean }> => {
    if (activeInstance) {
        resetInactivityTimer(activeInstance);
        const browserOpened = await openUrlInBrowser(activeInstance.url);
        return { url: activeInstance.url, browserOpened };
    }

    const token = crypto.randomBytes(24).toString("hex");

    const httpServer = http.createServer(async (req, res) => {
        if (activeInstance) {
            resetInactivityTimer(activeInstance);
        }

        try {
            const parsedUrl = new URL(req.url || "/", "http://127.0.0.1");
            const reqToken = parsedUrl.searchParams.get("token");

            if (reqToken !== token) {
                sendJson(res, 403, { success: false, error: "Forbidden: Invalid or missing session token." });
                return;
            }

            if (req.method === "GET" && parsedUrl.pathname === "/") {
                const html = renderSettingsHtml(token);
                res.writeHead(200, {
                    "Content-Type": "text/html; charset=utf-8",
                    "Cache-Control": "no-store"
                });
                res.end(html);
                return;
            }

            if (req.method === "GET" && parsedUrl.pathname === "/api/settings") {
                const [activeEnvironment, environments, appConfig] = await Promise.all([
                    getActiveEnvironmentOrNull().catch(() => null),
                    getAllEnvironmentsOrEmpty().catch(() => ({})),
                    getAppConfigOrEmpty().catch(() => ({}))
                ]);

                const tools = getToolsRegistry()
                    .filter(t => !t.meta.alwaysAvailable)
                    .map(t => ({
                        name: t.name,
                        description: t.description,
                        isDestructive: Boolean(t.meta.isDestructive),
                        requiresSdf: Boolean(t.meta.requiresSdf)
                    }));

                sendJson(res, 200, {
                    configDir: MCP_DIR,
                    activeEnvironment,
                    environments,
                    appConfig,
                    schema: {
                        environmentCredentialFields: ENVIRONMENT_CREDENTIAL_FIELDS,
                        globalSections: getGlobalSectionsSchema(),
                        tools
                    }
                });
                return;
            }

            if (req.method === "GET" && parsedUrl.pathname === "/api/db-status") {
                const envParam = parsedUrl.searchParams.get("env") || "";
                try {
                    const status = await getEnvironmentDatabaseStatus(envParam);
                    sendJson(res, 200, { success: true, ...status });
                } catch (err: any) {
                    sendJson(res, 400, { success: false, error: err?.message || "Invalid environment name" });
                }
                return;
            }

            if (req.method === "POST" && parsedUrl.pathname === "/api/upload-sqlite") {
                const envParam = parsedUrl.searchParams.get("env") || "";
                let envName: string;
                try {
                    envName = validateEnvNameForFilename(envParam);
                } catch (err: any) {
                    sendJson(res, 400, { success: false, error: err?.message || "Invalid environment name" });
                    return;
                }

                const existingJob = getRebuildState(envName);
                if (existingJob && existingJob.status === "in_progress") {
                    sendJson(res, 409, {
                        success: false,
                        error: `Cannot replace '${envName}.db' while a vector database rebuild is in progress.`
                    });
                    return;
                }

                const buffer = await readRequestBuffer(req);
                if (buffer.length < 100) {
                    sendJson(res, 400, { success: false, error: "Uploaded file is empty or too small to be a SQLite database." });
                    return;
                }

                const headerStr = buffer.subarray(0, 16).toString("utf-8");
                if (!headerStr.startsWith("SQLite format 3")) {
                    sendJson(res, 400, {
                        success: false,
                        error: "The selected file does not appear to be a valid SQLite 3 database."
                    });
                    return;
                }

                await fs.mkdir(MCP_DIR, { recursive: true });
                const tempPath = path.join(MCP_DIR, `.upload_${envName}_${Date.now()}.db.tmp`);
                const targetPath = getSqliteDbPath(envName);

                try {
                    await fs.writeFile(tempPath, buffer);
                    const { tableCount, fieldCount } = await validateUploadedSqliteSchema(tempPath);
                    await fs.rename(tempPath, targetPath);

                    const status = await getEnvironmentDatabaseStatus(envName);
                    sendJson(res, 200, {
                        success: true,
                        message: `Saved schema database to ${targetPath} (${tableCount} tables, ${fieldCount} fields).`,
                        tableCount,
                        fieldCount,
                        ...status
                    });
                } catch (err: any) {
                    try {
                        await fs.unlink(tempPath);
                    } catch {
                        // ignore
                    }
                    sendJson(res, 400, {
                        success: false,
                        error: err?.message || "Failed to validate or save SQLite database."
                    });
                }
                return;
            }

            if (req.method === "POST" && parsedUrl.pathname === "/api/rebuild-vector-db") {
                const envParam = parsedUrl.searchParams.get("env") || "";
                let envName: string;
                try {
                    envName = validateEnvNameForFilename(envParam);
                } catch (err: any) {
                    sendJson(res, 400, { success: false, error: err?.message || "Invalid environment name" });
                    return;
                }

                const existingJob = getRebuildState(envName);
                if (existingJob && existingJob.status === "in_progress") {
                    sendJson(res, 200, {
                        success: true,
                        alreadyRunning: true,
                        rebuildState: existingJob
                    });
                    return;
                }

                const sqlitePath = getSqliteDbPath(envName);
                const lancePath = getLanceDbPath(envName);

                try {
                    await fs.access(sqlitePath);
                } catch {
                    sendJson(res, 400, {
                        success: false,
                        error: `Schema database '${envName}.db' not found. Please upload the SQLite database first.`
                    });
                    return;
                }

                const jobState = startBackgroundRebuild(envName, sqlitePath, lancePath);
                sendJson(res, 200, {
                    success: true,
                    rebuildState: jobState
                });
                return;
            }

            if (req.method === "POST" && parsedUrl.pathname === "/api/settings") {
                const rawBody = await readRequestBody(req);
                const payload = JSON.parse(rawBody);

                if (!payload || typeof payload !== "object") {
                    sendJson(res, 400, { success: false, error: "Invalid JSON payload." });
                    return;
                }

                const rawEnvs = payload.environments;
                if (!rawEnvs || typeof rawEnvs !== "object" || Array.isArray(rawEnvs)) {
                    sendJson(res, 400, { success: false, error: "'environments' must be a JSON object." });
                    return;
                }

                const cleanedEnvironments: Record<string, EnvironmentConfig> = {};
                for (const [envNameRaw, envVal] of Object.entries(rawEnvs)) {
                    let envName: string;
                    try {
                        envName = validateEnvNameForFilename(envNameRaw);
                    } catch (err: any) {
                        sendJson(res, 400, { success: false, error: err?.message || "Invalid environment name." });
                        return;
                    }

                    if (!envVal || typeof envVal !== "object" || Array.isArray(envVal)) {
                        sendJson(res, 400, { success: false, error: `Invalid configuration for environment '${envName}'.` });
                        return;
                    }
                    const cfg = { ...(envVal as Record<string, any>) };

                    // Trim string credential fields
                    for (const field of ENVIRONMENT_CREDENTIAL_FIELDS) {
                        if (typeof cfg[field.key] === "string") {
                            cfg[field.key] = cfg[field.key].trim();
                        }
                    }

                    if (cfg.tools && typeof cfg.tools === "object") {
                        const toolsCfg: Record<string, any> = { ...cfg.tools };
                        toolsCfg.disableDestructive = Boolean(toolsCfg.disableDestructive);
                        toolsCfg.disableSdf = Boolean(toolsCfg.disableSdf);
                        toolsCfg.disabledTools = Array.isArray(toolsCfg.disabledTools)
                            ? toolsCfg.disabledTools.filter((t: unknown): t is string => typeof t === "string" && t.trim() !== "")
                            : [];
                        cfg.tools = toolsCfg;
                    }

                    cleanedEnvironments[envName] = cfg as EnvironmentConfig;
                }

                // Handle environment renames for existing .db and .lance files if provided
                if (Array.isArray(payload.renamedEnvironments)) {
                    for (const renameEntry of payload.renamedEnvironments) {
                        const fromName = typeof renameEntry?.from === "string" ? renameEntry.from.trim() : "";
                        const toName = typeof renameEntry?.to === "string" ? renameEntry.to.trim() : "";
                        if (!fromName || !toName || fromName === toName) continue;
                        try {
                            validateEnvNameForFilename(fromName);
                            validateEnvNameForFilename(toName);
                            const oldDb = getSqliteDbPath(fromName);
                            const newDb = getSqliteDbPath(toName);
                            try {
                                await fs.access(oldDb);
                                try {
                                    await fs.access(newDb);
                                    // Do not overwrite if newDb already exists
                                } catch {
                                    await fs.rename(oldDb, newDb);
                                }
                            } catch {
                                // oldDb doesn't exist
                            }

                            const oldLance = getLanceDbPath(fromName);
                            const newLance = getLanceDbPath(toName);
                            try {
                                await fs.access(oldLance);
                                try {
                                    await fs.access(newLance);
                                } catch {
                                    await fs.rename(oldLance, newLance);
                                }
                            } catch {
                                // oldLance doesn't exist
                            }
                        } catch {
                            // Ignore rename errors for invalid names
                        }
                    }
                }

                let targetActive: string | null =
                    typeof payload.activeEnvironment === "string" && payload.activeEnvironment.trim() !== ""
                        ? payload.activeEnvironment.trim()
                        : null;

                if (targetActive && !cleanedEnvironments[targetActive]) {
                    targetActive = null;
                }

                const appConfig =
                    payload.appConfig && typeof payload.appConfig === "object" && !Array.isArray(payload.appConfig)
                        ? payload.appConfig
                        : {};

                await saveAllEnvironments(cleanedEnvironments);
                await setOrClearActiveEnvironment(targetActive);
                await saveAppConfig(appConfig);

                try {
                    await mcpServer.sendToolListChanged();
                } catch (notifyErr: any) {
                    console.error(`Warning: Failed to send tool list changed notification: ${notifyErr?.message || notifyErr}`);
                }

                sendJson(res, 200, {
                    success: true,
                    activeEnvironment: targetActive
                });
                return;
            }

            if (req.method === "POST" && parsedUrl.pathname === "/api/test-connection") {
                const rawBody = await readRequestBody(req);
                const payload = JSON.parse(rawBody);
                const cfg = payload?.config;

                if (!cfg || typeof cfg !== "object") {
                    sendJson(res, 400, { success: false, error: "Missing environment configuration object." });
                    return;
                }

                const requiredKeys = [
                    "accountId",
                    "scriptId",
                    "deploymentId",
                    "consumerKey",
                    "consumerSecret",
                    "token",
                    "tokenSecret"
                ];
                const missing = requiredKeys.filter(k => typeof cfg[k] !== "string" || cfg[k].trim() === "");
                if (missing.length > 0) {
                    sendJson(res, 400, {
                        success: false,
                        error: `Missing required credential fields: ${missing.join(", ")}`
                    });
                    return;
                }

                try {
                    const start = Date.now();
                    const response = await callNetsuiteRestletWithCredentials(cfg, {
                        action: "RUN_SUITE_QL",
                        query: "SELECT 1 AS ping"
                    });
                    const elapsed = Date.now() - start;

                    if (response && response.success === false) {
                        sendJson(res, 200, {
                            success: false,
                            error: `RESTlet responded with an error: ${response.errorMessage || JSON.stringify(response)}`
                        });
                        return;
                    }

                    sendJson(res, 200, {
                        success: true,
                        message: `Successfully connected to NetSuite account '${cfg.accountId}' and verified MCP RESTlet (${elapsed}ms).`
                    });
                } catch (connErr: any) {
                    sendJson(res, 200, {
                        success: false,
                        error: connErr?.message || String(connErr)
                    });
                }
                return;
            }

            sendJson(res, 404, { success: false, error: "Not found" });
        } catch (err: any) {
            sendJson(res, 500, { success: false, error: err?.message || "Internal server error" });
        }
    });

    const port = await new Promise<number>((resolve, reject) => {
        httpServer.once("error", reject);
        httpServer.listen(0, "127.0.0.1", () => {
            const addr = httpServer.address();
            if (addr && typeof addr === "object") {
                resolve(addr.port);
            } else {
                reject(new Error("Failed to bind local settings server port"));
            }
        });
    });

    const url = `http://127.0.0.1:${port}/?token=${token}`;
    const placeholderTimeout = setTimeout(() => {}, INACTIVITY_TIMEOUT_MS);

    const instance: SettingsServerInstance = {
        server: httpServer,
        port,
        token,
        url,
        inactivityTimer: placeholderTimeout
    };
    activeInstance = instance;
    resetInactivityTimer(instance);

    const browserOpened = await openUrlInBrowser(url);
    return { url, browserOpened };
};
