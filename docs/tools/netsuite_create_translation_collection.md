# Create Translation Collection (`netsuite_create_translation_collection`)

[← Back to Tools Overview](../tools-overview.md)

## Description & Usage

`netsuite_create_translation_collection` creates and deploys a new NetSuite **Translation Collection** (`custcollection_*`) along with any non-default language **XLIFF 1.2 (`.xlf`)** translation files in a single atomic SDF deployment inside an isolated temporary SDF project.

### How SDF Translation Collections & XLIFF Files Work
In NetSuite SDF, a Translation Collection consists of two parts:
1. **`Objects/<scriptId>.xml` (`<translationcollection>`):** Defines the collection's `name`, `defaultlanguage` (e.g., `en-US`), `description`, and each `<string scriptid="...">` with its `<defaulttranslation>` (in the default language) and optional translator `<description>`.
2. **`Translations/<scriptId>.<locale>.xlf` (XLIFF 1.2 files):** One `.xlf` file per non-default target locale (e.g., `custcollection_my_app.es-ES.xlf`, `custcollection_my_app.fr-FR.xlf`) listed under `<translationimports>` in `deploy.xml`.

With `netsuite_create_translation_collection`, you simply pass the `strings` array containing each string's `defaultTranslation` and an optional `translations` map (`{ "es-ES": "...", "fr-FR": "..." }`), and the tool automatically generates both the `<translationcollection>` XML and all per-locale XLIFF 1.2 `.xlf` files and deploys them together!

### Input Parameters

| Parameter | Type | Required | Description |
| :--- | :--- | :---: | :--- |
| `scriptId` | `string` | **Yes** | Script ID of the translation collection. Must start with `'custcollection_'` (e.g., `'custcollection_my_translations'`). |
| `name` | `string` | **Yes** | Display name of the translation collection. |
| `defaultLanguage` | `string` | No | Default language locale code in SDF format (e.g., `'en-US'`). Defaults to `'en-US'`. |
| `description` | `string` | No | Optional description of the translation collection. |
| `strings` | `TranslationStringDefinition[]` | **Yes** | Array of translation strings: `{ scriptId: string, defaultTranslation: string, description?: string, translations?: Record<string, string> }`. |
| `saveToProject` | `boolean` | No | Override whether `<scriptId>.xml` and `Translations/<scriptId>.<locale>.xlf` are copied into your local project after deployment succeeds. |

---

## Complementary Tools

- **[List Supported Locales (`netsuite_list_supported_locales`)](./netsuite_list_supported_locales.md):** Call first to verify the active locale codes (`es-ES`, `fr-FR`, etc.) and `defaultLocale` configured in your NetSuite environment.
- **[List Translation Collections (`netsuite_list_translation_collections`)](./netsuite_list_translation_collections.md):** Check existing `custcollection_*` IDs to avoid naming collisions.
- **[View Translation Collection (`netsuite_view_translation_collection`)](./netsuite_view_translation_collection.md):** Verify the deployed strings and translations via SDF + `N/translation`.
- **[Update Translation Collection (`netsuite_update_translation_collection`)](./netsuite_update_translation_collection.md):** Add new strings or update translations on a collection after it has been created.

---

## Tool Metadata

| Property | Value |
| :--- | :--- |
| **Tool ID** | `netsuite_create_translation_collection` |
| **Human-Readable Name** | Create Translation Collection |
| **Category** | `translations` (Translation Collections) |
| **Destructive (`isDestructive`)** | **`true`** |
| **Requires SDF (`requiresSdf`)** | **`true`** |
| **Default Availability** | On-demand via `netsuite_manage_toolsets` *(or enabled at startup in the `templates_localization` preset)* |

---

## Inner Workings

1. **Input Validation & Locale Normalization:**
   - Validates that `scriptId` starts with `custcollection_` (case-insensitive) and strips any `.xml` suffix.
   - Normalizes `defaultLanguage` (defaulting to `'en-US'`) and all keys in each string's `translations` map to hyphenated SDF format (`es_ES` -> `es-ES`) via `toSdfLocale` (`src/utils/translations.ts`).

2. **Generating `<translationcollection>` XML (`buildTranslationCollectionXml`):**
   - Uses `xmlbuilder2` to serialize `<translationcollection scriptid="...">` with `<name>`, `<defaultlanguage>`, optional `<description>`, and `<strings><string scriptid="..."><defaulttranslation>...</defaulttranslation><description>...</description></string></strings>`.

3. **Generating NetSuite-Compatible XLIFF 1.2 Files (`buildXliffFilesByLocale` & `buildXliffContent`):**
   - Iterates through all `strings` and groups non-empty translations by target locale (skipping any entry whose locale matches `defaultLanguage`, since the default language is stored in `<defaulttranslation>` inside the XML).
   - For each target locale, `buildXliffContent` constructs an XLIFF 1.2 document conforming to NetSuite SDF's exact namespace and attribute schema:
     - Root `<xliff xmlns:ns="netsuite" xmlns:ns3="urn:oasis:names:tc:xliff:document:1.2" version="1.2">`
     - `<file original="netsuite-database" source-language="<defaultLocale>" target-language="<targetLocale>" datatype="database">`
     - `<body><group ns:collection="<collectionId>">`
     - One `<trans-unit id="<stringScriptId>">` per translated string containing `<source>` (the `defaultTranslation`), `<target>` (the translated string), and `<note from="string description">` / `<note from="collection description">` when descriptions are present.
     - Sanitizes all XML text via `sanitizeXmlText` (stripping illegal XML 1.0 control characters) and normalizes `<trans-unit id>` via `normalizeTransUnitId` (unwrapping any `[scriptid=custcollection_foo.bar]` reference to `bar`).

4. **Atomic Deployment & Local Project Sync (`deployTranslationCollectionFromTempProject`):**
   - Inside an isolated temporary SDF project (`withTempSdfProject`):
     - Writes `Objects/<scriptId>.xml`.
     - Writes each locale's XLIFF file to `Translations/<scriptId>.<locale>.xlf`.
     - Configures `<tempDir>/deploy.xml` with both `<objects><path>~/Objects/<scriptId>.xml</path></objects>` and `<translationimports><path>~/Translations/<scriptId>.<locale>.xlf</path></translationimports>`.
     - Executes `suitecloud project:deploy --accountspecificvalues WARNING`.
   - If `saveToProject` resolves to `true`, copies `<scriptId>.xml` into `<sdfSourceDir>/Objects/...` (according to `objectsFolderStrategy`) and copies all `<scriptId>.<locale>.xlf` files into `<sdfSourceDir>/Translations/`.
