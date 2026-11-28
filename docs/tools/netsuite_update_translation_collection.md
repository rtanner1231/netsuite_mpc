# Update Translation Collection (`netsuite_update_translation_collection`)

[← Back to Tools Overview](../tools-overview.md)

## Description & Usage

`netsuite_update_translation_collection` updates an existing NetSuite **Translation Collection** (`custcollection_*`) and its non-default language **XLIFF 1.2 (`.xlf`)** translation files via an isolated temporary SDF project.

### How Existing Translations Are Preserved Across Updates
When you deploy an XLIFF file (`Translations/<scriptId>.<locale>.xlf`) for a locale via SDF, NetSuite replaces the translations for that collection/locale with the `<trans-unit>` entries in the `.xlf` file. However, `suitecloud object:import --type translationcollection` only downloads `<scriptId>.xml` (the default language strings) and does **not** download existing `.xlf` files!

To ensure that updating or adding 1 string in Spanish (`es-ES`) never wipes out the other 50 existing Spanish translations in that collection, `netsuite_update_translation_collection` automatically uses a **hybrid SDF + RESTlet (`N/translation`) flow**:
1. Downloads the latest `<translationcollection>` XML from NetSuite via SDF.
2. Identifies which locales are being modified across your incoming `strings` (e.g., `['es-ES']`).
3. Calls the MCP Services RESTlet (`GET_TRANSLATIONS` via `N/translation`) to fetch all **existing** translations in NetSuite for those affected locales across all existing strings in the collection.
4. Merges your new/updated strings and locale translations on top of the existing strings and existing locale translations.
5. Generates complete `<scriptId>.xml` and `Translations/<scriptId>.<locale>.xlf` files and deploys them via SDF!

### Important NetSuite SDF Constraints
- **Adding & updating strings is supported; deleting strings is not:** NetSuite SDF Account Customization Projects do not permit deleting an existing `<string>` from a `<translationcollection>` or changing the collection's `<defaultlanguage>` after creation.

### Input Parameters

| Parameter | Type | Required | Description |
| :--- | :--- | :---: | :--- |
| `scriptId` | `string` | **Yes** | Script ID of the existing translation collection (e.g., `'custcollection_my_translations'`). |
| `name` | `string` | No | Optional updated display name of the translation collection. |
| `description` | `string` | No | Optional updated description of the translation collection. |
| `strings` | `UpdateTranslationStringInput[]` | No | Array of strings to add or update: `{ scriptId: string, defaultTranslation?: string, description?: string, translations?: Record<string, string> }`. Existing strings are matched by `scriptId` (case-insensitive) and merged; new `scriptId` entries are appended (`defaultTranslation` is required when adding a new string). |
| `saveToProject` | `boolean` | No | Override whether the updated `<scriptId>.xml` and `Translations/<scriptId>.<locale>.xlf` files are copied into your local project after deployment succeeds. |

---

## Complementary Tools

- **[View Translation Collection (`netsuite_view_translation_collection`)](./netsuite_view_translation_collection.md):** Call first to inspect the collection's current strings, default translations, and per-locale translations before calling `netsuite_update_translation_collection`.
- **[List Supported Locales (`netsuite_list_supported_locales`)](./netsuite_list_supported_locales.md):** Check valid `sdfLocale` codes (`es-ES`, `fr-FR`, etc.) enabled in the NetSuite environment.
- **[List Translation Collections (`netsuite_list_translation_collections`)](./netsuite_list_translation_collections.md):** Find the `scriptId` of the collection you want to update.

---

## Tool Metadata

| Property | Value |
| :--- | :--- |
| **Tool ID** | `netsuite_update_translation_collection` |
| **Human-Readable Name** | Update Translation Collection |
| **Category** | `translations` (Translation Collections) |
| **Destructive (`isDestructive`)** | **`true`** |
| **Requires SDF (`requiresSdf`)** | **`true`** |
| **Default Availability** | On-demand via `netsuite_manage_toolsets` *(or enabled at startup in the `templates_localization` preset)* |

---

## Inner Workings

1. **Step 1 — SDF XML Import & Parsing:**
   - Spins up an isolated temporary SDF project (`withTempSdfProject({ tempDirPrefix: "netsuite-mcp-tc-update-" })`).
   - Runs `suitecloud object:import --type translationcollection --scriptid <scriptId> --destinationfolder /Objects` (`downloadSdfObjectInTempProject`).
   - Parses `<scriptId>.xml` via `parseTranslationCollectionXml`, preserving `@translate` attributes on `<name>` and `<description>` and loading all existing `<string>` definitions.

2. **Step 2 — Affected Locale Detection & Live `N/translation` Hydration:**
   - Scans all `incoming.translations` objects in `args.strings` and normalizes each locale code via `toSdfLocale` into `affectedLocalesSet`.
   - If `existingKeys.length > 0` and `affectedLocales.length > 0`, calls the MCP Services RESTlet:
     ```json
     {
       "action": "GET_TRANSLATIONS",
       "collectionId": "custcollection_...",
       "keys": ["existing_key_1", "existing_key_2"],
       "locales": ["es-ES"],
       "defaultLocale": "en-US"
     }
     ```
   - Populates each existing string's `translations` map with the live non-empty translations returned by `N/translation` for the affected locales.

3. **Step 3 — Header & String Upsert Merge:**
   - Updates `collection.name` and `collection.description` if provided.
   - For each item in `args.strings`:
     - Looks for an existing string in `collection.strings` matching `incoming.scriptId` case-insensitively.
     - **If found (Update String):** Updates `defaultTranslation` (if provided), `description` (if provided), and shallow-merges `normalizedIncomingTranslations` onto `existingEntry.translations`.
     - **If not found (Add New String):** Validates that `incoming.defaultTranslation` is provided (returning an error if missing) and appends the new string entry to `collection.strings`.

4. **Step 4 — XLIFF Generation, SDF Deployment & Local Project Sync:**
   - Calls `deployTranslationCollectionFromTempProject`:
     - Rebuilds `<scriptId>.xml` (`buildTranslationCollectionXml`) and builds XLIFF 1.2 files (`buildXliffFilesByLocale`) for every affected locale containing all existing + newly merged translations for that locale.
     - Stages `Objects/<scriptId>.xml` and `Translations/<scriptId>.<locale>.xlf`, updates `deploy.xml` with `<objects>` and `<translationimports>`, and executes `suitecloud project:deploy --accountspecificvalues WARNING`.
     - If `saveToProject` resolves to `true`, syncs `<scriptId>.xml` into `<sdfSourceDir>/Objects/...` and writes the updated `.xlf` files into `<sdfSourceDir>/Translations/`.
