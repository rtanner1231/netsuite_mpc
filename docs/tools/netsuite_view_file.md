# View File (`netsuite_view_file`)

[← Back to Tools Overview](../tools-overview.md)

## Description & Usage

`netsuite_view_file` loads and inspects any file in the NetSuite File Cabinet by internal ID (`fileId`) or File Cabinet path / file name (`filePath`) via the `N/file` module in the MCP Services RESTlet (`rl_mcp_services.js`).

Unlike SDF (`suitecloud file:import`), which can only import files from specific SDF-supported folders like `/SuiteScripts`, `netsuite_view_file` can read files from **any File Cabinet folder** (`/SuiteScripts`, `/Templates`, `/Images`, `/SuiteBundles`, `/Web Site Hosting Files`, `/Attachments Received`, etc.).

### How Different File Types Are Returned
- **Text Files (`category: "text"` — `.js`, `.ts`, `.json`, `.xml`, `.html`, `.ftl`, `.css`, `.csv`, `.txt`, `.svg`, `.xlf`, etc.):**
  - Returns the file metadata (`fileId`, `name`, `fileCabinetPath`, `folderId`, `fileType`, `mimeType`, `byteSize`, `totalLines`) and the text `content` directly inline.
  - Supports line-range pagination (`startLine`, `endLine`) and character truncation (`maxChars`, default `100,000`). If truncated (or if `savePreviewFile: true`), the full text file is also saved to a local auto-cleaned preview directory (`previewFilePath`).
- **Raster Images (`category: "image"` — `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.bmp`, `.ico`, `.tiff`):**
  - Saves a local copy to `previewFilePath` and returns an embedded MCP image content block (`type: "image"`, base64 `data`, `mimeType`) so multimodal AI assistants can visually inspect the image directly.
- **PDFs & Binary Files (`category: "pdf"` or `"binary"` — `.pdf`, `.zip`, `.xlsx`, `.docx`, etc.):**
  - Saves a local copy to `previewFilePath` and returns an embedded MCP resource content block (`type: "resource"`, `uri: "file://..."`, `mimeType`, base64 `blob`).

### Input Parameters

| Parameter | Type | Required | Description |
| :--- | :--- | :---: | :--- |
| `fileId` | `number` \| `string` | No* | Numeric internal ID of the file in the NetSuite File Cabinet (e.g., `12345`). |
| `filePath` | `string` | No* | File Cabinet path (e.g., `'/SuiteScripts/my_script.js'`, `'/Images/logo.png'`, `'/Templates/E-mail Templates/welcome.html'`), bare file name (`'logo.png'`), or local workspace script path (`'TypeScripts/my_script.ts'`). |
| `startLine` | `number` | No | *(Text files only)* 1-based starting line number (defaults to `1`). |
| `endLine` | `number` | No | *(Text files only)* 1-based ending line number, inclusive (defaults to `totalLines`). |
| `maxChars` | `number` | No | *(Text files only)* Maximum characters to return inline (default: `100000`). If exceeded, inline `content` is truncated and the full file is written to `previewFilePath`. |
| `savePreviewFile` | `boolean` | No | Force saving a local copy of a text file to `previewFilePath`. (Images, PDFs, binaries, and truncated text files are always saved to `previewFilePath`). |

*\*Either `fileId` or `filePath` must be provided.*

---

## Complementary Tools

- **[Compare Files (`netsuite_compare_files`)](./netsuite_compare_files.md):** If you have a local copy of a script in your workspace and want a unified diff against the deployed File Cabinet version, use `netsuite_compare_files`. Use `netsuite_view_file` when you want to read a remote file directly or inspect non-script files (images, PDFs, HTML templates, CSVs, logs).
- **[Upload File (`netsuite_upload_file`)](./netsuite_upload_file.md):** Upload updated script files to the File Cabinet after inspecting them.
- **[Get Script (`netsuite_get_script`)](./netsuite_get_script.md) & [Search Scripts (`netsuite_search_scripts`)](./netsuite_search_scripts.md):** Discover the `fileId` or `fileCabinetPath` of any deployed SuiteScript before viewing its source code with `netsuite_view_file`.
- **[Read Email Template (`netsuite_read_email_template`)](./netsuite_read_email_template.md):** When an Email Template uses `usesmedia: true` (`<mediaitem>[/Templates/...]</mediaitem>`), use `netsuite_view_file` to read the referenced File Cabinet HTML file.

---

## Tool Metadata

| Property | Value |
| :--- | :--- |
| **Tool ID** | `netsuite_view_file` |
| **Human-Readable Name** | View File |
| **Category** | `sdf_file_deployment` (File Cabinet & SDF Files) |
| **Destructive (`isDestructive`)** | `false` |
| **Requires SDF (`requiresSdf`)** | `false` |
| **Default Availability** | On-demand via `netsuite_manage_toolsets` *(or enabled at startup in the `developer` preset)* |

---

## Inner Workings

1. **Workspace Path Normalization (`normalizeRequestedFilePath` in `src/tools/viewFile.ts`):**
   - If `filePath` looks like a local workspace path (`.ts`, `TypeScripts/...`, or `.../FileCabinet/...`), the tool resolves it via `resolveProjectFile` (using `tsconfig.json` and project configuration) to its deployed `/SuiteScripts/*.js` File Cabinet path before calling the RESTlet.

2. **Multi-Stage File Resolution in the RESTlet (`handleGetFile` in `rl_mcp_services.js`):**
   - **Stage 1 — Direct Numeric ID:** If `fileId` (or `filePath`) is purely numeric, calls `file.load({ id: Number(numericIdStr) })`.
   - **Stage 2 — Direct `N/file.load` by Path Candidates:** Tries `file.load({ id: candidate })` with the path as-is (with and without leading `/`) and, if it does not already start with `SuiteScripts/`, also tries `SuiteScripts/<path>` and `/SuiteScripts/<path>`.
   - **Stage 3 — SuiteQL `file` + `mediaitemfolder` Hierarchy Search Fallback:**
     - If `file.load` by path fails (for example, when only a bare filename like `"logo.png"` or a partial subfolder path `"sub/foo.js"` was passed), the RESTlet extracts the base filename and queries:
       ```sql
       SELECT f.id, f.name, f.folder, f.filetype, f.filesize
       FROM file f
       WHERE LOWER(f.name) = LOWER('<baseName>')
       ORDER BY f.id ASC
       ```
     - Calls `resolveFileCabinetPathsByEntries(fileRows)`, which walks parent folders up `mediaitemfolder` (up to 12 levels deep, seeded with NetSuite's negative system root folder IDs like `-15` for `SuiteScripts`, `-10` for `Templates`, `-6` for `Images`, `-100` for `Web Site Hosting Files`) to reconstruct the full `/Folder/Subfolder/file.ext` path for every match.
     - Matches exact full path first, then path suffix, or bare filename.
     - If **1** file matches, loads it by numeric `fileId`.
     - If **multiple** files match (e.g., two `logo.png` files in different folders), returns `{ success: false, errorMessage: "Multiple files matched...", candidates: [...] }` listing every candidate's `fileId` and `fileCabinetPath` so the caller can pick the exact one.

3. **MIME Classification & Managed Preview Storage (`classifyFile` & `writeManagedTemplatePreviewFile`):**
   - Back in `src/tools/viewFile.ts`, `classifyFile` inspects the file extension, NetSuite `fileType` (`PNGIMAGE`, `PDF`, `JAVASCRIPT`, `FREEMARKER`, etc.), and `rawIsText` flag to classify the file as `"text"`, `"image"`, `"pdf"`, or `"binary"`.
   - **Text Handling:** If `rawIsText` was `false` for a text-classified file (e.g., `.svg` or `.xlf` that NetSuite returned as base64), decodes the base64 buffer to UTF-8. Splits lines for `startLine`/`endLine` slicing and applies `maxChars` truncation.
   - **Managed Preview Directory (`<os.tmpdir()>/netsuite-mcp-previews`):** Binary files, images, PDFs, and truncated/saved text files are written to `<os.tmpdir()>/netsuite-mcp-previews/<fileId>_<safeFileName>` via `writeManagedTemplatePreviewFile`. Expired preview files older than 15 minutes (`PREVIEW_TTL_MS`) are pruned on every write, and a Node `process.on("exit")` hook removes the entire directory when the MCP server exits.
