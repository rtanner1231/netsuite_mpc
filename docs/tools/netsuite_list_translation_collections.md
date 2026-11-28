# List Translation Collections (`netsuite_list_translation_collections`)

[← Back to Tools Overview](../tools-overview.md)

## Description & Usage

`netsuite_list_translation_collections` lists all **Translation Collections** (`custcollection_*`) deployed in the active NetSuite environment by executing `suitecloud object:list --type translationcollection` inside an isolated temporary SDF project.

### When to Use It
- **Discovering existing Translation Collections:** Before viewing or updating translations in an account, call `netsuite_list_translation_collections` to find the exact `custcollection_*` script IDs present in NetSuite.

### Input Parameters

This tool takes no input parameters (`{}`).

---

## Complementary Tools

- **[View Translation Collection (`netsuite_view_translation_collection`)](./netsuite_view_translation_collection.md):** Pass any `custcollection_*` `scriptId` returned by `netsuite_list_translation_collections` to inspect all of its strings, default translations, descriptions, and per-locale translated values.
- **[Update Translation Collection (`netsuite_update_translation_collection`)](./netsuite_update_translation_collection.md):** Add new strings or update locale translations on a collection discovered via `netsuite_list_translation_collections`.
- **[Create Translation Collection (`netsuite_create_translation_collection`)](./netsuite_create_translation_collection.md):** Create a brand-new `custcollection_*` if no suitable collection exists yet.

---

## Tool Metadata

| Property | Value |
| :--- | :--- |
| **Tool ID** | `netsuite_list_translation_collections` |
| **Human-Readable Name** | List Translation Collections |
| **Category** | `translations` (Translation Collections) |
| **Destructive (`isDestructive`)** | `false` |
| **Requires SDF (`requiresSdf`)** | **`true`** |
| **Default Availability** | On-demand via `netsuite_manage_toolsets` *(or enabled at startup in the `templates_localization` preset)* |

---

## Inner Workings

1. **Isolated Temporary SDF Project Execution (`listSdfTranslationCollections` in `src/utils/translations.ts`):**
   - Resolves `projectRoot` and `projectConfig`, then calls `withTempSdfProject({ tempDirPrefix: "netsuite-mcp-tc-list-" })` to scaffold a disposable SDF directory bound to the active environment's `sdfId`.
   - Executes:
     ```bash
     suitecloud object:list --type translationcollection
     ```
     inside `tempProject.tempDir`.

2. **Output Parsing & Deduplication:**
   - Splits `stdout` by newline and matches each line against `/(?:^|:)(custcollection_[a-zA-Z0-9_]+)$/i` (handling both `custcollection_foo` and `translationcollection:custcollection_foo` SuiteCloud CLI output formats while ignoring CLI status banners).
   - Deduplicates script IDs case-insensitively and returns `{ count: scriptIds.length, collections: scriptIds }`.
   - Automatically deletes the temporary SDF directory in a `finally` block.
