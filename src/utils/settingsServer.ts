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
    APP_CONFIG_PATH,
    CONFIG_PATH,
    ENV_PATH,
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
}

interface PersistedSettingsSession {
    port: number;
    token: string;
    updatedAt: number;
}

let activeInstance: SettingsServerInstance | null = null;
const sseClients = new Set<http.ServerResponse>();
const DEFAULT_SETTINGS_PORT = 45821;
const SESSION_FILE_PATH = path.join(MCP_DIR, ".settings-session.json");
const MAX_JSON_BODY_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_SQLITE_BODY_BYTES = 250 * 1024 * 1024; // 250 MB

export const computeConfigVersionHash = async (): Promise<string> => {
    const readSafe = async (filePath: string): Promise<string> => {
        try {
            return await fs.readFile(filePath, "utf-8");
        } catch {
            return "";
        }
    };
    const [stateContent, envContent, appConfigContent] = await Promise.all([
        readSafe(CONFIG_PATH),
        readSafe(ENV_PATH),
        readSafe(APP_CONFIG_PATH)
    ]);
    return crypto
        .createHash("sha1")
        .update(`${stateContent}\n---ENV---\n${envContent}\n---CFG---\n${appConfigContent}`)
        .digest("hex");
};

export const notifySettingsClientsOfConfigChange = async (): Promise<void> => {
    if (sseClients.size === 0) return;
    try {
        const [configVersion, activeEnvironment] = await Promise.all([
            computeConfigVersionHash(),
            getActiveEnvironmentOrNull().catch(() => null)
        ]);
        const payload = JSON.stringify({
            type: "config-changed",
            configVersion,
            activeEnvironment,
            timestamp: Date.now()
        });
        for (const client of Array.from(sseClients)) {
            try {
                client.write(`data: ${payload}\n\n`);
            } catch {
                sseClients.delete(client);
            }
        }
    } catch {
        // Ignore broadcast errors
    }
};

const readPersistedSession = async (): Promise<PersistedSettingsSession | null> => {
    try {
        const raw = await fs.readFile(SESSION_FILE_PATH, "utf-8");
        const parsed = JSON.parse(raw);
        if (
            parsed &&
            typeof parsed.port === "number" &&
            parsed.port > 0 &&
            parsed.port < 65536 &&
            typeof parsed.token === "string" &&
            parsed.token.length >= 16
        ) {
            return {
                port: parsed.port,
                token: parsed.token,
                updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : Date.now()
            };
        }
        return null;
    } catch {
        return null;
    }
};

const writePersistedSession = async (port: number, token: string): Promise<void> => {
    try {
        await fs.mkdir(MCP_DIR, { recursive: true });
        const payload: PersistedSettingsSession = {
            port,
            token,
            updatedAt: Date.now()
        };
        await fs.writeFile(SESSION_FILE_PATH, JSON.stringify(payload, null, 2) + "\n", "utf-8");
    } catch {
        // Non-fatal if config dir cannot be written before first save
    }
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

const tryListenOnPort = (httpServer: http.Server, port: number): Promise<number> => {
    return new Promise((resolve, reject) => {
        const onError = (err: any) => {
            httpServer.removeListener("listening", onListening);
            reject(err);
        };
        const onListening = () => {
            httpServer.removeListener("error", onError);
            const addr = httpServer.address();
            if (addr && typeof addr === "object") {
                resolve(addr.port);
            } else {
                reject(new Error("Failed to bind local settings server port"));
            }
        };
        httpServer.once("error", onError);
        httpServer.once("listening", onListening);
        httpServer.listen(port, "127.0.0.1");
    });
};

const bindSettingsHttpServer = async (httpServer: http.Server, preferredPort: number): Promise<number> => {
    const candidatePorts = Array.from(new Set([preferredPort, DEFAULT_SETTINGS_PORT, 0]));
    let lastError: any = null;
    for (const candidate of candidatePorts) {
        try {
            return await tryListenOnPort(httpServer, candidate);
        } catch (err: any) {
            lastError = err;
        }
    }
    throw lastError || new Error("Failed to bind local settings server port");
};

const ensureSettingsServerRunning = async (
    mcpServer: Server,
    getToolsRegistry: () => ToolDefinition[]
): Promise<SettingsServerInstance> => {
    if (activeInstance) {
        return activeInstance;
    }

    const persisted = await readPersistedSession();
    const token = persisted?.token || crypto.randomBytes(24).toString("hex");
    const preferredPort = persisted?.port || DEFAULT_SETTINGS_PORT;

    const httpServer = http.createServer(async (req, res) => {
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

            if (req.method === "GET" && parsedUrl.pathname === "/api/ping") {
                const [configVersion, activeEnvironment] = await Promise.all([
                    computeConfigVersionHash(),
                    getActiveEnvironmentOrNull().catch(() => null)
                ]);
                sendJson(res, 200, {
                    success: true,
                    pid: process.pid,
                    configVersion,
                    activeEnvironment,
                    timestamp: Date.now()
                });
                return;
            }

            if (req.method === "GET" && parsedUrl.pathname === "/api/events") {
                res.writeHead(200, {
                    "Content-Type": "text/event-stream; charset=utf-8",
                    "Cache-Control": "no-cache, no-transform",
                    "Connection": "keep-alive"
                });
                const [configVersion, activeEnvironment] = await Promise.all([
                    computeConfigVersionHash(),
                    getActiveEnvironmentOrNull().catch(() => null)
                ]);
                res.write(
                    `data: ${JSON.stringify({
                        type: "connected",
                        pid: process.pid,
                        configVersion,
                        activeEnvironment,
                        timestamp: Date.now()
                    })}\n\n`
                );
                sseClients.add(res);
                req.on("close", () => {
                    sseClients.delete(res);
                });
                return;
            }

            if (req.method === "GET" && parsedUrl.pathname === "/api/settings") {
                const [activeEnvironment, environments, appConfig, configVersion] = await Promise.all([
                    getActiveEnvironmentOrNull().catch(() => null),
                    getAllEnvironmentsOrEmpty().catch(() => ({})),
                    getAppConfigOrEmpty().catch(() => ({})),
                    computeConfigVersionHash()
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
                    configVersion,
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

            if (req.method === "POST" && parsedUrl.pathname === "/api/active-environment") {
                const rawBody = await readRequestBody(req);
                const payload = JSON.parse(rawBody);
                const targetActive =
                    typeof payload?.activeEnvironment === "string" && payload.activeEnvironment.trim() !== ""
                        ? payload.activeEnvironment.trim()
                        : null;

                await setOrClearActiveEnvironment(targetActive);
                const configVersion = await computeConfigVersionHash();

                try {
                    await mcpServer.sendToolListChanged();
                } catch (notifyErr: any) {
                    console.error(`Warning: Failed to send tool list changed notification: ${notifyErr?.message || notifyErr}`);
                }
                void notifySettingsClientsOfConfigChange();

                sendJson(res, 200, {
                    success: true,
                    activeEnvironment: targetActive,
                    configVersion
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
                if (activeInstance) {
                    await writePersistedSession(activeInstance.port, activeInstance.token);
                }
                const configVersion = await computeConfigVersionHash();

                try {
                    await mcpServer.sendToolListChanged();
                } catch (notifyErr: any) {
                    console.error(`Warning: Failed to send tool list changed notification: ${notifyErr?.message || notifyErr}`);
                }
                void notifySettingsClientsOfConfigChange();

                sendJson(res, 200, {
                    success: true,
                    activeEnvironment: targetActive,
                    configVersion
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

    const port = await bindSettingsHttpServer(httpServer, preferredPort);
    // Unref so the HTTP server never prevents the MCP process from exiting cleanly when stdio closes
    httpServer.unref();

    const url = `http://127.0.0.1:${port}/?token=${token}`;
    const instance: SettingsServerInstance = {
        server: httpServer,
        port,
        token,
        url
    };
    activeInstance = instance;
    await writePersistedSession(port, token);

    return instance;
};

/**
 * Automatically resumes the settings HTTP server on MCP startup if a previous settings session file exists.
 * This ensures that an already-open browser tab continues working seamlessly across MCP restarts.
 */
export const resumeSettingsServerIfPersisted = async (
    mcpServer: Server,
    getToolsRegistry: () => ToolDefinition[]
): Promise<void> => {
    const persisted = await readPersistedSession();
    if (!persisted) {
        return;
    }
    try {
        await ensureSettingsServerRunning(mcpServer, getToolsRegistry);
    } catch (err: any) {
        console.error(`Warning: Could not auto-resume settings server: ${err?.message || err}`);
    }
};

export const startOrGetSettingsServer = async (
    mcpServer: Server,
    getToolsRegistry: () => ToolDefinition[]
): Promise<{ url: string; browserOpened: boolean }> => {
    const instance = await ensureSettingsServerRunning(mcpServer, getToolsRegistry);
    const browserOpened = await openUrlInBrowser(instance.url);
    return { url: instance.url, browserOpened };
};
