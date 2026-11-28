# View Translation Collection (`netsuite_view_translation_collection`)

[← Back to Tools Overview](../tools-overview.md)

## Description & Usage

`netsuite_view_translation_collection` inspects a NetSuite **Translation Collection** (`custcollection_*`) by combining **SDF object import** with live **`N/translation` resolution** via the MCP Services RESTlet (`rl_mcp_services.js`).

### Why Both SDF and `N/translation` Are Used
In NetSuite SDF, importing a `translationcollection` object (`suitecloud object:import --type translationcollection`) downloads **only** the `<translationcollection>` XML file—which contains the collection's `name`, `defaultlanguage`, `description`, and each string's `@scriptid`, `<defaulttranslation>`, and `<description>`. It does **not** download non-default language translations (which live in XLIFF `.xlf` files in NetSuite's translation database).

To give you the complete picture across all languages, `netsuite_view_translation_collection` first downloads the collection's XML via SDF to discover all string keys and default translations, and then passes those keys to the MCP Services RESTlet (`GET_TRANSLATIONS`), which uses NetSuite's `N/translation` module to resolve the translated string values across all requested (`locales`) or active NetSuite locales!

### Important Note on Untranslated Fallback Values (`""`)
NetSuite's `N/translation` API automatically falls back to returning the collection's `defaultTranslation` string whenever a non-default locale does not have a translation entered. To avoid misleading you into thinking a string has been translated when it actually just fell back to the default language, any non-default locale whose resolved value equals `defaultTranslation` is reported as `""` (empty string) in `translations`.

### Input Parameters

| Parameter | Type | Required | Description |
| :--- | :--- | :---: | :--- |
| `scriptId` | `string` | **Yes** | Script ID of the translation collection (e.g., `'custcollection_my_translations'`). |
| `locales` | `string[]` | No | Optional array of locale codes (e.g., `['es-ES', 'fr-FR']` or `['es_ES', 'fr_FR']`) to resolve translations for. If omitted, automatically queries all active languages configured in the NetSuite environment. |

---

## Complementary Tools

- **[List Translation Collections (`netsuite_list_translation_collections`)](./netsuite_list_translation_collections.md):** Discover available `custcollection_*` script IDs before calling `netsuite_view_translation_collection`.
- **[List Supported Locales (`netsuite_list_supported_locales`)](./netsuite_list_supported_locales.md):** Check which locales are active in the NetSuite environment.
- **[Update Translation Collection (`netsuite_update_translation_collection`)](./netsuite_update_translation_collection.md):** Call `netsuite_view_translation_collection` first to inspect a collection's existing strings and missing locale translations (`""`), then pass new or updated translations to `netsuite_update_translation_collection`.

---

## Tool Metadata

| Property | Value |
| :--- | :--- |
| **Tool ID** | `netsuite_view_translation_collection` |
| **Human-Readable Name** | View Translation Collection |
| **Category** | `translations` (Translation Collections) |
| **Destructive (`isDestructive`)** | `false` |
| **Requires SDF (`requiresSdf`)** | **`true`** |
| **Default Availability** | On-demand via `netsuite_manage_toolsets` *(or enabled at startup in the `templates_localization` preset)* |

---

## Inner Workings

1. **Step 1 — SDF XML Download (`downloadSdfObjectXml`):**
   - Strips any `.xml` suffix from `scriptId`.
   - Spins up an isolated temporary SDF project (`withTempSdfProject`) and executes:
     ```bash
     suitecloud object:import --type translationcollection --scriptid <scriptId> --destinationfolder /Objects
     ```
   - Reads the downloaded `<scriptId>.xml` file and cleans up the temporary SDF directory.

2. **Step 2 — XML Parsing (`parseTranslationCollectionXml` in `src/utils/translations.ts`):**
   - Parses `<translationcollection>` via `xmlbuilder2`.
   - Extracts `scriptId`, `name` (and `@translate` attribute if present), `defaultLanguage` (normalized to hyphenated SDF format like `'en-US'`), `description`, and all `<strings><string>` nodes (`scriptId`, `defaultTranslation`, `description`).

3. **Step 3 — Batched `N/translation` Resolution in the RESTlet (`handleGetTranslations` in `rl_mcp_services.js`):**
   - If the collection has at least 1 string key, sends `{ action: "GET_TRANSLATIONS", collectionId, keys, locales, defaultLocale: parsed.defaultLanguage }` to the MCP Services RESTlet.
   - Inside `handleGetTranslations`:
     - If `locales` was omitted, calls `discoverSupportedLocales()` to get all active languages configured in the account.
     - **1,000-Key Batching (`KEY_BATCH_SIZE = 1000`):** NetSuite's `N/translation.load` enforces a hard maximum of 1,000 keys per call. The RESTlet chunks `keys` into batches of 1,000.
     - **Baseline Default Locale Load:** First loads `translation.load` for the baseline (`defaultLocale`) across all key batches to record the exact baseline string for every key (`baselineValues[k]`).
     - **5-Locale Batching (`LOCALE_BATCH_SIZE = 5`):** NetSuite's `N/translation.load` only accepts up to **5 locales** in its `locales` array per call, and `translation.selectLocale({ handle, locale })` only works for locales that were included in that `translation.load` call! Therefore, the RESTlet chunks all target locales into batches of 5, calls `translation.load({ collections: [{ alias: "col", collection: collectionId, keys: batchKeys }], locales: nsLocalesInBatch })`, and iterates through the 5 locales using `translation.selectLocale` (with automatic per-locale fallback if any single locale in the batch of 5 is rejected by NetSuite).
     - **Fallback Detection:** For each non-default locale and each key `k`, invokes `localeHandle.col[k]()` (matching key case-insensitively via `invokeHandleKey`). If the returned string equals `baselineValues[k]`, it records `""` (untranslated fallback); otherwise it records the translated string.

4. **Step 4 — Merging & Enrichment:**
   - Merges the per-locale translations from the RESTlet onto each parsed string from the SDF XML (ensuring `translations[defaultLangSdf]` is always populated with `str.defaultTranslation`).
   - If the RESTlet is unreachable, gracefully degrades to returning the default translations from the SDF XML along with a `warning` field.
