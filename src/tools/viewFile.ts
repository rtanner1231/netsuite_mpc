import path from "path";
import { pathToFileURL } from "url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { ToolContentItem, ToolDefinition } from "../types/index.js";
import { callNetsuiteRestlet } from "../utils/api.js";
import { getProjectRoot } from "../utils/mcp.js";
import { getProjectConfig, resolveProjectFile } from "../utils/project.js";
import { writeManagedTemplatePreviewFile } from "../utils/templates.js";

type ViewFileArgs = {
    fileId?: number | string;
    filePath?: string;
    startLine?: number;
    endLine?: number;
    maxChars?: number;
    savePreviewFile?: boolean;
};

const DEFAULT_MAX_CHARS = 100_000;

const RASTER_IMAGE_MIME_BY_EXT: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".ico": "image/x-icon",
    ".tif": "image/tiff",
    ".tiff": "image/tiff"
};

const RASTER_IMAGE_MIME_BY_NS_TYPE: Record<string, string> = {
    PNGIMAGE: "image/png",
    JPGIMAGE: "image/jpeg",
    PJPGIMAGE: "image/jpeg",
    GIFIMAGE: "image/gif",
    WEBPIMAGE: "image/webp",
    BMPIMAGE: "image/bmp",
    ICON: "image/x-icon",
    TIFFIMAGE: "image/tiff"
};

const TEXT_MIME_BY_EXT: Record<string, string> = {
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".cjs": "text/javascript",
    ".ts": "text/typescript",
    ".jsx": "text/jsx",
    ".tsx": "text/tsx",
    ".json": "application/json",
    ".map": "application/json",
    ".xml": "application/xml",
    ".xsd": "application/xml",
    ".xsl": "application/xml",
    ".xlf": "application/xliff+xml",
    ".xliff": "application/xliff+xml",
    ".svg": "image/svg+xml",
    ".html": "text/html",
    ".htm": "text/html",
    ".ftl": "text/x-freemarker",
    ".css": "text/css",
    ".scss": "text/x-scss",
    ".sass": "text/x-sass",
    ".less": "text/x-less",
    ".csv": "text/csv",
    ".tsv": "text/tab-separated-values",
    ".txt": "text/plain",
    ".log": "text/plain",
    ".md": "text/markdown",
    ".sql": "application/sql",
    ".yaml": "application/yaml",
    ".yml": "application/yaml",
    ".ini": "text/plain",
    ".cfg": "text/plain",
    ".conf": "text/plain",
    ".rtf": "application/rtf",
    ".eml": "message/rfc822",
    ".sh": "text/x-shellscript",
    ".bat": "text/plain"
};

const TEXT_MIME_BY_NS_TYPE: Record<string, string> = {
    JAVASCRIPT: "text/javascript",
    JSON: "application/json",
    XMLDOC: "application/xml",
    HTMLDOC: "text/html",
    FREEMARKER: "text/x-freemarker",
    STYLESHEET: "text/css",
    SCSS: "text/x-scss",
    CSV: "text/csv",
    PLAINTEXT: "text/plain",
    MESSAGERFC: "message/rfc822",
    RTF: "application/rtf",
    SMS: "text/plain",
    SVG: "image/svg+xml"
};

const BINARY_MIME_BY_EXT: Record<string, string> = {
    ".pdf": "application/pdf",
    ".zip": "application/zip",
    ".gz": "application/gzip",
    ".tar": "application/x-tar",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".ppt": "application/vnd.ms-powerpoint",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".mp3": "audio/mpeg",
    ".mp4": "video/mp4",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".otf": "font/otf"
};

const BINARY_MIME_BY_NS_TYPE: Record<string, string> = {
    PDF: "application/pdf",
    ZIP: "application/zip",
    GZIP: "application/gzip",
    EXCEL: "application/vnd.ms-excel",
    WORD: "application/msword",
    POWERPOINT: "application/vnd.ms-powerpoint",
    MP3: "audio/mpeg",
    MPEGMOVIE: "video/mpeg"
};

type FileClassification = {
    category: "text" | "image" | "pdf" | "binary";
    mimeType: string;
};

/**
 * Classifies a NetSuite File Cabinet file into `"text"`, `"image"`, `"pdf"`, or `"binary"`
 * and determines its MIME type using the file extension, NetSuite `fileType`, and `rawIsText` flag.
 */
const classifyFile = (
    fileName: string,
    nsFileType: string | null,
    rawIsText: boolean
): FileClassification => {
    const ext = path.posix.extname((fileName || "").trim()).toLowerCase();
    const upperNsType = (nsFileType || "").trim().toUpperCase();

    // 1. Check PDF first
    if (ext === ".pdf" || upperNsType === "PDF") {
        return { category: "pdf", mimeType: "application/pdf" };
    }

    // 2. Check Raster Images
    if (ext && RASTER_IMAGE_MIME_BY_EXT[ext]) {
        return { category: "image", mimeType: RASTER_IMAGE_MIME_BY_EXT[ext] };
    }
    if (upperNsType && RASTER_IMAGE_MIME_BY_NS_TYPE[upperNsType]) {
        return { category: "image", mimeType: RASTER_IMAGE_MIME_BY_NS_TYPE[upperNsType] };
    }

    // 3. Check known Text formats by extension or NetSuite fileType
    if (ext && TEXT_MIME_BY_EXT[ext]) {
        return { category: "text", mimeType: TEXT_MIME_BY_EXT[ext] };
    }
    if (upperNsType && TEXT_MIME_BY_NS_TYPE[upperNsType]) {
        return { category: "text", mimeType: TEXT_MIME_BY_NS_TYPE[upperNsType] };
    }

    // 4. Check known Binary formats
    if (ext && BINARY_MIME_BY_EXT[ext]) {
        return { category: "binary", mimeType: BINARY_MIME_BY_EXT[ext] };
    }
    if (upperNsType && BINARY_MIME_BY_NS_TYPE[upperNsType]) {
        return { category: "binary", mimeType: BINARY_MIME_BY_NS_TYPE[upperNsType] };
    }

    // 5. Fallback to NetSuite's rawIsText flag
    if (rawIsText) {
        return { category: "text", mimeType: "text/plain" };
    }

    return { category: "binary", mimeType: "application/octet-stream" };
};

/**
 * Normalizes an input `filePath` argument. If it looks like a local workspace path
 * (e.g., `TypeScripts/foo.ts` or `src/FileCabinet/SuiteScripts/foo.js`), maps it to the
 * corresponding NetSuite File Cabinet path (`/SuiteScripts/foo.js`).
 */
const normalizeRequestedFilePath = async (
    rawFilePath: string,
    server: Server
): Promise<string> => {
    let cleaned = rawFilePath.trim();
    if (cleaned.startsWith("[") && cleaned.endsWith("]")) {
        cleaned = cleaned.slice(1, -1).trim();
    }
    cleaned = cleaned.replace(/\\/g, "/");

    const looksLikeLocalProjectPath =
        /\.ts$/i.test(cleaned) ||
        /(?:^|\/)TypeScripts\//i.test(cleaned) ||
        /(?:^|\/)FileCabinet\//i.test(cleaned);

    if (looksLikeLocalProjectPath) {
        try {
            const projectRoot = await getProjectRoot(server);
            const projectConfig = await getProjectConfig(projectRoot);
            const resolved = await resolveProjectFile(projectRoot, cleaned, projectConfig);
            if (resolved?.fileCabinetPath) {
                return resolved.fileCabinetPath;
            }
        } catch {
            // Fallback to simple TypeScripts -> SuiteScripts string mapping
        }

        return cleaned
            .replace(/^\/?TypeScripts\//i, "/SuiteScripts/")
            .replace(/^(?:.*\/)?FileCabinet\//i, "/")
            .replace(/\.ts$/i, ".js");
    }

    return cleaned;
};

export const viewFileTool: ToolDefinition = {
    name: "netsuite_view_file",
    description:
        "Views a file from the NetSuite File Cabinet by internal ID ('fileId') or File Cabinet path / file name ('filePath') via the MCP RESTlet (N/file). " +
        "For text files (scripts, JSON, XML, HTML, FreeMarker, CSV, CSS, etc.), returns the file metadata and text content directly (with optional 'startLine', 'endLine', and 'maxChars' pagination). " +
        "For visual and binary files such as PDFs and images (PNG, JPEG, GIF, WebP, etc.), saves a local copy to an auto-cleaned preview directory ('previewFilePath') and returns an embedded MCP image or PDF resource so you can directly view and inspect the file.",
    meta: {
        isDestructive: false,
        requiresSdf: false
    },
    inputSchema: {
        type: "object",
        properties: {
            fileId: {
                anyOf: [{ type: "number" }, { type: "string" }],
                description:
                    "Optional numeric internal ID of the file in the NetSuite File Cabinet (e.g., 12345). Either 'fileId' or 'filePath' must be provided."
            },
            filePath: {
                type: "string",
                description:
                    "Optional File Cabinet path (e.g., '/SuiteScripts/my_script.js', '/Images/logo.png', '/Templates/E-mail Templates/welcome.html'), bare file name (e.g., 'logo.png'), or local workspace script path (e.g., 'TypeScripts/my_script.ts'). Either 'fileId' or 'filePath' must be provided."
            },
            startLine: {
                type: "number",
                description:
                    "Optional 1-based starting line number when viewing text files. Omit to start from line 1."
            },
            endLine: {
                type: "number",
                description:
                    "Optional 1-based ending line number (inclusive) when viewing text files. Omit to read through the end of the file."
            },
            maxChars: {
                type: "number",
                description:
                    "Optional maximum number of characters to return inline for text files (defaults to 100000). If a text file exceeds this limit, it is truncated and the full file is automatically saved to 'previewFilePath'."
            },
            savePreviewFile: {
                type: "boolean",
                description:
                    "Optional flag to force saving a local copy of the file in the auto-cleaned preview directory ('previewFilePath'). Binary files (PDFs, images, etc.) and truncated text files are always saved to 'previewFilePath'."
            }
        }
    },
    execute: async (args: ViewFileArgs, server: Server) => {
        try {
            const hasFileId =
                args?.fileId !== undefined &&
                args?.fileId !== null &&
                String(args.fileId).trim() !== "";
            const hasFilePath =
                typeof args?.filePath === "string" && args.filePath.trim() !== "";

            if (!hasFileId && !hasFilePath) {
                return {
                    content: [
                        {
                            type: "text",
                            text: "Error: Either 'fileId' (numeric internal ID) or 'filePath' (File Cabinet path or file name) must be provided."
                        }
                    ],
                    isError: true
                };
            }

            const normalizedPath = hasFilePath
                ? await normalizeRequestedFilePath(args.filePath!, server)
                : undefined;

            const response = await callNetsuiteRestlet({
                action: "GET_FILE",
                ...(hasFileId ? { fileId: String(args.fileId).trim() } : {}),
                ...(normalizedPath ? { filePath: normalizedPath } : {})
            });

            if (!response || !response.success) {
                const errorPayload: Record<string, any> = {
                    success: false,
                    errorMessage:
                        response?.errorMessage || "NetSuite RESTlet GET_FILE failed."
                };
                if (Array.isArray(response?.candidates) && response.candidates.length > 0) {
                    errorPayload.candidates = response.candidates;
                }
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify(errorPayload, null, 2)
                        }
                    ],
                    isError: true
                };
            }

            const fileId = Number(response.fileId);
            const fileName = String(response.name || `file_${fileId}`);
            const fileCabinetPath = String(response.fileCabinetPath || `/${fileName}`);
            const nsFileType = response.fileType != null ? String(response.fileType) : null;
            const rawIsText = Boolean(response.rawIsText);
            const rawContents = String(response.contents ?? "");

            const classification = classifyFile(fileName, nsFileType, rawIsText);
            const previewBaseName = `${fileId}_${fileName}`;

            // =================================================================
            // CASE 1: TEXT FILES
            // =================================================================
            if (classification.category === "text") {
                const fullText = rawIsText
                    ? rawContents
                    : Buffer.from(rawContents, "base64").toString("utf-8");

                const allLines = fullText.split(/\r?\n/);
                const totalLines = allLines.length;

                const hasLineSlice =
                    (typeof args?.startLine === "number" && Number.isFinite(args.startLine)) ||
                    (typeof args?.endLine === "number" && Number.isFinite(args.endLine));

                const effectiveStartLine =
                    typeof args?.startLine === "number" && Number.isFinite(args.startLine)
                        ? Math.max(1, Math.floor(args.startLine))
                        : 1;
                const effectiveEndLine =
                    typeof args?.endLine === "number" && Number.isFinite(args.endLine)
                        ? Math.min(totalLines, Math.max(effectiveStartLine, Math.floor(args.endLine)))
                        : totalLines;

                const slicedText = hasLineSlice
                    ? allLines.slice(effectiveStartLine - 1, effectiveEndLine).join("\n")
                    : fullText;

                const maxChars =
                    typeof args?.maxChars === "number" && args.maxChars > 0
                        ? Math.floor(args.maxChars)
                        : DEFAULT_MAX_CHARS;

                const isTruncated = slicedText.length > maxChars;
                const returnedContent = isTruncated
                    ? slicedText.slice(0, maxChars)
                    : slicedText;

                let previewFilePath: string | undefined;
                if (args?.savePreviewFile || isTruncated) {
                    previewFilePath = await writeManagedTemplatePreviewFile(
                        previewBaseName,
                        fullText
                    );
                }

                const payload: Record<string, any> = {
                    success: true,
                    fileId,
                    name: fileName,
                    fileCabinetPath,
                    folderId: response.folderId ?? null,
                    fileType: nsFileType,
                    mimeType: classification.mimeType,
                    category: "text",
                    byteSize: response.size ?? Buffer.byteLength(fullText, "utf-8"),
                    encoding: response.encoding ?? "UTF-8",
                    description: response.description ?? null,
                    url: response.url ?? null,
                    isOnline: Boolean(response.isOnline),
                    isInactive: Boolean(response.isInactive),
                    totalLines,
                    ...(hasLineSlice
                        ? {
                              startLine: effectiveStartLine,
                              endLine: effectiveEndLine
                          }
                        : {}),
                    truncated: isTruncated,
                    ...(isTruncated
                        ? {
                              truncationNote: `Content was truncated to ${maxChars} characters (out of ${slicedText.length}). Use 'startLine'/'endLine' to page through lines, or inspect 'previewFilePath' on disk.`
                          }
                        : {}),
                    ...(previewFilePath ? { previewFilePath } : {}),
                    timeElapsedMS: response.timeElapsedMS,
                    governanceUsed: response.governanceUsed,
                    content: returnedContent
                };

                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify(payload, null, 2)
                        }
                    ]
                };
            }

            // =================================================================
            // CASE 2: BINARY FILES (IMAGES, PDFS, OTHER BINARIES)
            // =================================================================
            const base64Data = rawIsText
                ? Buffer.from(rawContents, "utf-8").toString("base64")
                : rawContents;
            const binaryBuffer = Buffer.from(base64Data, "base64");

            const previewFilePath = await writeManagedTemplatePreviewFile(
                previewBaseName,
                binaryBuffer
            );
            const fileUri = pathToFileURL(previewFilePath).href;

            const metadataSummary: Record<string, any> = {
                success: true,
                fileId,
                name: fileName,
                fileCabinetPath,
                folderId: response.folderId ?? null,
                fileType: nsFileType,
                mimeType: classification.mimeType,
                category: classification.category,
                byteSize: binaryBuffer.byteLength,
                description: response.description ?? null,
                url: response.url ?? null,
                isOnline: Boolean(response.isOnline),
                isInactive: Boolean(response.isInactive),
                previewFilePath,
                timeElapsedMS: response.timeElapsedMS,
                governanceUsed: response.governanceUsed
            };

            const contentItems: ToolContentItem[] = [
                {
                    type: "text",
                    text: JSON.stringify(metadataSummary, null, 2)
                }
            ];

            if (classification.category === "image") {
                contentItems.push({
                    type: "image",
                    data: base64Data,
                    mimeType: classification.mimeType
                });
            } else {
                contentItems.push({
                    type: "resource",
                    resource: {
                        uri: fileUri,
                        mimeType: classification.mimeType,
                        blob: base64Data
                    }
                });
            }

            return {
                content: contentItems
            };
        } catch (error: any) {
            return {
                content: [
                    {
                        type: "text",
                        text: `Error viewing File Cabinet file: ${error.message}`
                    }
                ],
                isError: true
            };
        }
    }
};
