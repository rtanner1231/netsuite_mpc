# List Supported Locales (`netsuite_list_supported_locales`)

[← Back to Tools Overview](../tools-overview.md)

## Description & Usage

`netsuite_list_supported_locales` returns the active and supported languages (locales) configured in your current NetSuite environment via the MCP Services RESTlet (`rl_mcp_services.js`).

For each active locale, it returns:
- **`sdfLocale`:** The hyphenated locale code required by NetSuite SDF `<translationcollection>` XML and XLIFF 1.2 `.xlf` files (e.g., `'en-US'`, `'es-ES'`, `'fr-FR'`, `'de-DE'`, `'ja-JP'`).
- **`netsuiteLocale`:** The underscore-separated locale code used by NetSuite's SuiteScript `N/translation` module (e.g., `'en_US'`, `'es_ES'`, `'fr_FR'`).
- **`name`:** The human-readable language display name (e.g., `'English (U.S.)'`, `'Spanish'`).
- **`isDefault`:** Boolean indicating whether this locale is the NetSuite environment's default language (`defaultLocale`).
- **`source`:** Where the locale was discovered (`'general_preferences'`, `'company_preferences'`, or `'account_default'`).

### When to Use It
- **Before creating or updating a Translation Collection:** Call `netsuite_list_supported_locales` to verify which languages are enabled under **Setup > Company > General Preferences > Languages** in the target NetSuite environment and which locale is the account's `defaultLocale`.
- **Inspecting all standard NetSuite locale codes:** Pass `includeAllStandardLocales: true` to also list every standard `N/translation.Locale` enum value supported by NetSuite.

### Input Parameters

| Parameter | Type | Required | Description |
| :--- | :--- | :---: | :--- |
| `includeAllStandardLocales` | `boolean` | No | If `true`, includes the complete list of standard NetSuite `N/translation.Locale` enum values (`standardLocales`) alongside the account's active configured locales (`activeLocales`). Defaults to `false` (unless `activeLocales` is empty, in which case `standardLocales` is included automatically). |

---

## Complementary Tools

- **[Create Translation Collection (`netsuite_create_translation_collection`)](./netsuite_create_translation_collection.md):** Use the `defaultLocale` and `sdfLocale` codes returned by `netsuite_list_supported_locales` to populate `defaultLanguage` and per-string `translations` maps.
- **[Update Translation Collection (`netsuite_update_translation_collection`)](./netsuite_update_translation_collection.md):** Add or update translations for active `sdfLocale`s on an existing collection.
- **[View Translation Collection (`netsuite_view_translation_collection`)](./netsuite_view_translation_collection.md):** Inspect a collection's resolved translations across active or specified locales.

---

## Tool Metadata

| Property | Value |
| :--- | :--- |
| **Tool ID** | `netsuite_list_supported_locales` |
| **Human-Readable Name** | List Supported Locales |
| **Category** | `translations` (Translation Collections) |
| **Destructive (`isDestructive`)** | `false` |
| **Requires SDF (`requiresSdf`)** | `false` |
| **Default Availability** | On-demand via `netsuite_manage_toolsets` *(or enabled at startup in the `templates_localization` preset)* |

---

## Inner Workings

1. **RESTlet Dispatch (`GET_SUPPORTED_LOCALES`):**
   - Calls `callNetsuiteRestlet({ action: "GET_SUPPORTED_LOCALES" })`.

2. **Multi-Source Locale Discovery (`discoverSupportedLocales` in `rl_mcp_services.js`):**
   - Because different NetSuite roles have varying permission levels (some roles lack `Set Up Company` permission to load `N/config.Type.COMPANY_PREFERENCES`), the RESTlet combines four discovery sources:
     1. **Default Locale Detection:** Checks `runtime.getCurrentUser().getPreference({ name: "LANGUAGE" })`, `config.load({ type: config.Type.COMPANY_PREFERENCES })` (`LOCALE` / `LANGUAGE`), and SuiteQL `SELECT preference, value FROM companypreference WHERE preference = 'LANGUAGE'`.
     2. **SuiteQL `language` Reference Table:** Queries `SELECT key, descr, deflocale, inactive FROM language` to map NetSuite language keys and locale codes to human-readable descriptions (`descr`).
     3. **SuiteQL `websitelanguage` & `companypreference` (`TRANSLATION_LANGUAGES`):**
        - Queries `SELECT DISTINCT locale, languagename FROM websitelanguage WHERE locale IS NOT NULL ORDER BY locale` (which reflects all languages enabled under **Setup > Company > General Preferences > Languages**).
        - Also checks `companypreference` (`preference = 'TRANSLATION_LANGUAGES'`, which stores `\u0005`-delimited language keys) and active entries in `language`.
     4. **`N/config.Type.COMPANY_PREFERENCES` Sublist Fallback:** If accessible to the role, inspects the `languages` / `systemlanguages` / `tranlanguages` sublist on `COMPANY_PREFERENCES`.
   - Normalizes every discovered locale into both `netsuiteLocale` (`lang_REGION`) and `sdfLocale` (`lang-REGION`) via `normalizeLocaleFormats` and deduplicates by `sdfLocale`.
   - Also enumerates all keys on `N/translation.Locale` into `standardLocales`.
