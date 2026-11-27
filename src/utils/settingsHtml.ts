export const renderSettingsHtml = (token: string): string => {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>NetSuite MCP Settings</title>
    <style>
        :root {
            --bg-primary: #0f172a;
            --bg-secondary: #1e293b;
            --bg-tertiary: #334155;
            --bg-card: #1e293b;
            --border-color: #334155;
            --text-primary: #f8fafc;
            --text-secondary: #94a3b8;
            --text-muted: #64748b;
            --accent: #3b82f6;
            --accent-hover: #2563eb;
            --success: #10b981;
            --success-bg: rgba(16, 185, 129, 0.12);
            --warning: #f59e0b;
            --warning-bg: rgba(245, 158, 11, 0.12);
            --danger: #ef4444;
            --danger-bg: rgba(239, 68, 68, 0.12);
        }
        * {
            box-sizing: border-box;
        }
        body {
            margin: 0;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            background: var(--bg-primary);
            color: var(--text-primary);
            min-height: 100vh;
            display: flex;
            flex-direction: column;
        }
        header {
            background: var(--bg-secondary);
            border-bottom: 1px solid var(--border-color);
            padding: 16px 28px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            position: sticky;
            top: 0;
            z-index: 20;
        }
        .brand {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }
        .brand h1 {
            margin: 0;
            font-size: 1.25rem;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .brand .config-path {
            font-size: 0.78rem;
            color: var(--text-secondary);
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        }
        .header-actions {
            display: flex;
            align-items: center;
            gap: 12px;
        }
        .unsaved-pill {
            font-size: 0.78rem;
            padding: 4px 10px;
            border-radius: 999px;
            background: var(--warning-bg);
            color: var(--warning);
            border: 1px solid rgba(245, 158, 11, 0.35);
            display: none;
        }
        .unsaved-pill.visible {
            display: inline-block;
        }
        .conn-pill {
            font-size: 0.76rem;
            padding: 4px 10px;
            border-radius: 999px;
            display: inline-flex;
            align-items: center;
            gap: 6px;
            border: 1px solid var(--border-color);
            background: rgba(15, 23, 42, 0.5);
            color: var(--text-secondary);
        }
        .conn-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: var(--success);
            display: inline-block;
        }
        .conn-pill.offline {
            background: var(--danger-bg);
            border-color: rgba(239, 68, 68, 0.4);
            color: #fca5a5;
        }
        .conn-pill.offline .conn-dot {
            background: var(--danger);
        }
        .btn {
            padding: 8px 16px;
            border-radius: 6px;
            border: 1px solid var(--border-color);
            background: var(--bg-tertiary);
            color: var(--text-primary);
            font-size: 0.875rem;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.15s ease;
            display: inline-flex;
            align-items: center;
            gap: 6px;
        }
        .btn:hover:not(:disabled) {
            background: #475569;
        }
        .btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        .btn-primary {
            background: var(--accent);
            border-color: var(--accent);
            color: #fff;
        }
        .btn-primary:hover:not(:disabled) {
            background: var(--accent-hover);
        }
        .btn-danger {
            background: var(--danger-bg);
            border-color: rgba(239, 68, 68, 0.4);
            color: #fca5a5;
        }
        .btn-danger:hover:not(:disabled) {
            background: rgba(239, 68, 68, 0.25);
        }
        .btn-sm {
            padding: 5px 10px;
            font-size: 0.78rem;
        }
        .tabs-bar {
            background: var(--bg-secondary);
            border-bottom: 1px solid var(--border-color);
            padding: 0 28px;
            display: flex;
            gap: 24px;
        }
        .tab-btn {
            background: none;
            border: none;
            color: var(--text-secondary);
            padding: 12px 4px;
            font-size: 0.92rem;
            font-weight: 500;
            cursor: pointer;
            border-bottom: 2px solid transparent;
            transition: all 0.15s;
        }
        .tab-btn:hover {
            color: var(--text-primary);
        }
        .tab-btn.active {
            color: var(--accent);
            border-bottom-color: var(--accent);
        }
        .banner {
            margin: 16px 28px 0;
            padding: 12px 16px;
            border-radius: 8px;
            font-size: 0.875rem;
            display: none;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
        }
        .banner.visible {
            display: flex;
        }
        .banner.success {
            background: var(--success-bg);
            border: 1px solid rgba(16, 185, 129, 0.35);
            color: #6ee7b7;
        }
        .banner.error {
            background: var(--danger-bg);
            border: 1px solid rgba(239, 68, 68, 0.35);
            color: #fca5a5;
        }
        main {
            flex: 1;
            padding: 24px 28px 48px;
            max-width: 1280px;
            width: 100%;
            margin: 0 auto;
        }
        .tab-panel {
            display: none;
        }
        .tab-panel.active {
            display: block;
        }
        /* Environments Layout */
        .env-layout {
            display: grid;
            grid-template-columns: 280px 1fr;
            gap: 24px;
            align-items: start;
        }
        .env-sidebar {
            background: var(--bg-card);
            border: 1px solid var(--border-color);
            border-radius: 10px;
            overflow: hidden;
        }
        .env-sidebar-header {
            padding: 14px 16px;
            border-bottom: 1px solid var(--border-color);
            display: flex;
            align-items: center;
            justify-content: space-between;
        }
        .env-sidebar-header h2 {
            margin: 0;
            font-size: 0.95rem;
            font-weight: 600;
        }
        .env-list {
            list-style: none;
            margin: 0;
            padding: 8px;
            display: flex;
            flex-direction: column;
            gap: 4px;
        }
        .env-item {
            padding: 10px 12px;
            border-radius: 6px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: space-between;
            transition: background 0.12s;
            border: 1px solid transparent;
        }
        .env-item:hover {
            background: rgba(255, 255, 255, 0.04);
        }
        .env-item.selected {
            background: rgba(59, 130, 246, 0.14);
            border-color: rgba(59, 130, 246, 0.4);
        }
        .env-item-name {
            font-weight: 500;
            font-size: 0.9rem;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .badge {
            font-size: 0.7rem;
            padding: 2px 8px;
            border-radius: 999px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.03em;
        }
        .badge-active {
            background: var(--success-bg);
            color: #34d399;
            border: 1px solid rgba(16, 185, 129, 0.35);
        }
        .badge-warning {
            background: var(--warning-bg);
            color: #fcd34d;
            border: 1px solid rgba(245, 158, 11, 0.35);
        }
        .badge-destructive {
            background: var(--danger-bg);
            color: #fca5a5;
            border: 1px solid rgba(239, 68, 68, 0.3);
        }
        .badge-sdf {
            background: rgba(139, 92, 246, 0.15);
            color: #c4b5fd;
            border: 1px solid rgba(139, 92, 246, 0.35);
        }
        .badge-override {
            background: rgba(59, 130, 246, 0.15);
            color: #93c5fd;
            border: 1px solid rgba(59, 130, 246, 0.35);
        }
        .card {
            background: var(--bg-card);
            border: 1px solid var(--border-color);
            border-radius: 10px;
            padding: 20px 24px;
            margin-bottom: 20px;
        }
        .card-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 18px;
            padding-bottom: 14px;
            border-bottom: 1px solid var(--border-color);
            flex-wrap: wrap;
            gap: 12px;
        }
        .card-header h3 {
            margin: 0;
            font-size: 1.05rem;
            font-weight: 600;
        }
        .card-header p {
            margin: 4px 0 0;
            font-size: 0.83rem;
            color: var(--text-secondary);
        }
        .form-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
            gap: 16px 20px;
        }
        .form-field {
            display: flex;
            flex-direction: column;
            gap: 6px;
        }
        .form-field label {
            font-size: 0.84rem;
            font-weight: 500;
            color: var(--text-primary);
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
        }
        .form-field .req {
            color: var(--danger);
            margin-left: 2px;
        }
        .input-wrap {
            position: relative;
            display: flex;
            align-items: center;
        }
        input[type="text"],
        input[type="password"],
        select {
            width: 100%;
            padding: 9px 12px;
            border-radius: 6px;
            border: 1px solid var(--border-color);
            background: var(--bg-primary);
            color: var(--text-primary);
            font-size: 0.875rem;
            outline: none;
            transition: border-color 0.15s;
        }
        input[type="text"]:focus,
        input[type="password"]:focus,
        select:focus {
            border-color: var(--accent);
        }
        .secret-toggle {
            position: absolute;
            right: 8px;
            background: none;
            border: none;
            color: var(--text-secondary);
            font-size: 0.75rem;
            cursor: pointer;
            padding: 4px 6px;
        }
        .secret-toggle:hover {
            color: var(--text-primary);
        }
        .help-text {
            font-size: 0.76rem;
            color: var(--text-secondary);
            line-height: 1.35;
        }
        /* Database Status Boxes */
        .db-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
            gap: 16px;
        }
        .db-box {
            padding: 16px;
            border-radius: 8px;
            background: rgba(15, 23, 42, 0.55);
            border: 1px solid var(--border-color);
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            gap: 14px;
        }
        .db-box-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
        }
        .db-box-title {
            font-weight: 600;
            font-size: 0.92rem;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .db-meta {
            font-size: 0.8rem;
            color: var(--text-secondary);
            line-height: 1.45;
        }
        .db-actions {
            display: flex;
            align-items: center;
            gap: 10px;
            flex-wrap: wrap;
        }
        .progress-wrap {
            margin-top: 8px;
            display: flex;
            flex-direction: column;
            gap: 6px;
        }
        .progress-track {
            width: 100%;
            height: 8px;
            background: var(--bg-tertiary);
            border-radius: 999px;
            overflow: hidden;
        }
        .progress-fill {
            height: 100%;
            background: var(--accent);
            transition: width 0.25s ease;
        }
        /* Profile Bar */
        .profile-bar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            flex-wrap: wrap;
            gap: 12px;
            padding: 12px 14px;
            background: rgba(15, 23, 42, 0.65);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            margin-bottom: 16px;
        }
        .profile-tabs {
            display: flex;
            align-items: center;
            gap: 8px;
            flex-wrap: wrap;
        }
        .profile-tab {
            padding: 6px 12px;
            border-radius: 6px;
            border: 1px solid var(--border-color);
            background: var(--bg-secondary);
            color: var(--text-secondary);
            font-size: 0.84rem;
            font-weight: 500;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            gap: 6px;
            transition: all 0.15s;
        }
        .profile-tab:hover {
            color: var(--text-primary);
            border-color: #475569;
        }
        .profile-tab.selected {
            background: rgba(59, 130, 246, 0.16);
            border-color: var(--accent);
            color: var(--text-primary);
        }
        .preset-chips {
            display: flex;
            align-items: center;
            gap: 6px;
            flex-wrap: wrap;
            margin-bottom: 16px;
        }
        .preset-label {
            font-size: 0.78rem;
            color: var(--text-secondary);
            margin-right: 4px;
        }
        /* Toggles */
        .toggle-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 12px 14px;
            border-radius: 8px;
            background: rgba(15, 23, 42, 0.55);
            border: 1px solid var(--border-color);
            margin-bottom: 10px;
            gap: 16px;
        }
        .toggle-info {
            display: flex;
            flex-direction: column;
            gap: 3px;
        }
        .toggle-title {
            font-size: 0.9rem;
            font-weight: 500;
            display: flex;
            align-items: center;
            gap: 8px;
            flex-wrap: wrap;
        }
        .toggle-desc {
            font-size: 0.79rem;
            color: var(--text-secondary);
        }
        .toggle-note {
            font-size: 0.76rem;
            color: var(--warning);
            margin-top: 2px;
        }
        .switch {
            position: relative;
            display: inline-block;
            width: 42px;
            height: 23px;
            flex-shrink: 0;
        }
        .switch input {
            opacity: 0;
            width: 0;
            height: 0;
        }
        .slider {
            position: absolute;
            cursor: pointer;
            inset: 0;
            background-color: #475569;
            transition: .2s;
            border-radius: 23px;
        }
        .slider:before {
            position: absolute;
            content: "";
            height: 17px;
            width: 17px;
            left: 3px;
            bottom: 3px;
            background-color: white;
            transition: .2s;
            border-radius: 50%;
        }
        input:checked + .slider {
            background-color: var(--accent);
        }
        input:checked + .slider.danger-on {
            background-color: var(--warning);
        }
        input:disabled + .slider {
            opacity: 0.45;
            cursor: not-allowed;
        }
        input:checked + .slider:before {
            transform: translateX(19px);
        }
        /* Category cards & expandable individual tools */
        .categories-grid {
            display: flex;
            flex-direction: column;
            gap: 16px;
            margin-top: 14px;
        }
        .tool-section {
            border: 1px solid #334155;
            border-left: 4px solid #475569;
            border-radius: 10px;
            background: #162032;
            box-shadow: 0 2px 6px rgba(0, 0, 0, 0.22);
            overflow: hidden;
            transition: border-color 0.15s ease, background 0.15s ease;
        }
        .tool-section.cat-enabled {
            border-color: rgba(59, 130, 246, 0.45);
            border-left-color: #10b981;
            background: #1a273d;
        }
        .tool-section.cat-blocked {
            border-color: rgba(239, 68, 68, 0.4);
            border-left-color: #ef4444;
            background: rgba(23, 30, 46, 0.7);
            opacity: 0.85;
        }
        .tool-section-header {
            padding: 14px 18px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            flex-wrap: wrap;
            gap: 14px;
            cursor: pointer;
            user-select: none;
            transition: background 0.12s ease;
        }
        .tool-section-header:hover {
            background: rgba(255, 255, 255, 0.03);
        }
        .tool-section-title-wrap {
            display: flex;
            flex-direction: column;
            gap: 4px;
            flex: 1;
            min-width: 240px;
        }
        .tool-section-title-line {
            display: flex;
            align-items: center;
            gap: 10px;
            flex-wrap: wrap;
        }
        .cat-chevron {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 18px;
            height: 18px;
            font-size: 0.72rem;
            color: var(--text-secondary);
            transition: transform 0.15s ease, color 0.15s ease;
        }
        .tool-section.is-open .cat-chevron {
            transform: rotate(90deg);
            color: var(--text-primary);
        }
        .tool-section-title {
            font-size: 0.96rem;
            font-weight: 600;
            color: var(--text-primary);
        }
        .count-pill {
            font-size: 0.73rem;
            font-weight: 600;
            padding: 2px 9px;
            border-radius: 999px;
            background: rgba(15, 23, 42, 0.65);
            border: 1px solid rgba(148, 163, 184, 0.25);
            color: var(--text-secondary);
        }
        .count-pill.has-active {
            background: rgba(16, 185, 129, 0.14);
            border-color: rgba(16, 185, 129, 0.35);
            color: #6ee7b7;
        }
        .tool-section-desc {
            font-size: 0.8rem;
            color: var(--text-secondary);
            padding-left: 28px;
        }
        .tool-section-actions {
            display: flex;
            align-items: center;
            gap: 14px;
            flex-shrink: 0;
        }
        .tool-section-body {
            background: #0b1120;
            border-top: 1px solid rgba(51, 65, 85, 0.75);
            padding: 4px 0;
            display: none;
            flex-direction: column;
        }
        .tool-section.is-open .tool-section-body {
            display: flex;
        }
        .tool-list-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 16px;
            padding: 10px 18px 10px 44px;
            border-bottom: 1px solid rgba(51, 65, 85, 0.45);
            transition: background 0.12s ease;
        }
        .tool-list-row:last-child {
            border-bottom: none;
        }
        .tool-list-row:hover {
            background: rgba(30, 41, 59, 0.45);
        }
        .tool-list-row.locked {
            opacity: 0.62;
        }
        .tool-list-row .toggle-desc {
            font-size: 0.77rem;
            color: #8295b0;
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
            overflow: hidden;
        }
        .row-controls {
            display: flex;
            align-items: center;
            gap: 14px;
            flex-shrink: 0;
        }
        .block-pill {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 4px 10px;
            border-radius: 6px;
            border: 1px solid var(--border-color);
            background: rgba(15, 23, 42, 0.55);
            color: var(--text-secondary);
            font-size: 0.76rem;
            font-weight: 500;
            cursor: pointer;
            user-select: none;
            transition: all 0.15s ease;
        }
        .block-pill:hover {
            border-color: rgba(239, 68, 68, 0.45);
            color: var(--text-primary);
        }
        .block-pill.active {
            background: var(--danger-bg);
            border-color: rgba(239, 68, 68, 0.5);
            color: #fca5a5;
        }
        .block-pill.disabled-pill {
            opacity: 0.5;
            cursor: not-allowed;
        }
        .block-pill input[type="checkbox"] {
            margin: 0;
            accent-color: var(--danger);
            cursor: inherit;
        }
        .context-warning-box {
            padding: 10px 14px;
            border-radius: 8px;
            font-size: 0.82rem;
            margin-bottom: 14px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
        }
        .context-warning-box.optimal {
            background: var(--success-bg);
            border: 1px solid rgba(16, 185, 129, 0.35);
            color: #6ee7b7;
        }
        .context-warning-box.heavy {
            background: var(--warning-bg);
            border: 1px solid rgba(245, 158, 11, 0.4);
            color: #fcd34d;
        }
        .empty-state {
            text-align: center;
            padding: 48px 24px;
            background: var(--bg-card);
            border: 1px dashed var(--border-color);
            border-radius: 10px;
        }
        .empty-state h3 {
            margin: 0 0 8px;
            font-size: 1.1rem;
        }
        .empty-state p {
            margin: 0 0 20px;
            color: var(--text-secondary);
            font-size: 0.9rem;
        }
        .test-result {
            margin-top: 12px;
            padding: 10px 14px;
            border-radius: 6px;
            font-size: 0.83rem;
            display: none;
        }
        .test-result.visible {
            display: block;
        }
        .test-result.ok {
            background: var(--success-bg);
            border: 1px solid rgba(16, 185, 129, 0.35);
            color: #6ee7b7;
        }
        .test-result.err {
            background: var(--danger-bg);
            border: 1px solid rgba(239, 68, 68, 0.35);
            color: #fca5a5;
        }
        .reset-link {
            background: none;
            border: none;
            color: var(--text-secondary);
            font-size: 0.74rem;
            cursor: pointer;
            text-decoration: underline;
            padding: 0;
        }
        .reset-link:hover {
            color: var(--text-primary);
        }
        .sub-tabs {
            display: flex;
            gap: 8px;
            margin-bottom: 18px;
            flex-wrap: wrap;
        }
        .sub-tab-btn {
            padding: 7px 14px;
            border-radius: 6px;
            border: 1px solid var(--border-color);
            background: var(--bg-secondary);
            color: var(--text-secondary);
            font-size: 0.84rem;
            font-weight: 500;
            cursor: pointer;
        }
        .sub-tab-btn.active {
            background: rgba(59, 130, 246, 0.16);
            border-color: var(--accent);
            color: var(--text-primary);
        }
        @media (max-width: 820px) {
            .env-layout {
                grid-template-columns: 1fr;
            }
        }
    </style>
</head>
<body>
    <header>
        <div class="brand">
            <h1>NetSuite MCP Configuration</h1>
            <div class="config-path" id="configDirDisplay">Loading configuration path...</div>
        </div>
        <div class="header-actions">
            <span class="conn-pill" id="connPill" title="Local settings server connection status">
                <span class="conn-dot"></span>
                <span id="connPillText">Connected</span>
            </span>
            <span class="unsaved-pill" id="unsavedPill">Unsaved changes</span>
            <button class="btn btn-primary" id="saveBtn" onclick="saveAllSettings()">Save Changes</button>
        </div>
    </header>

    <div class="tabs-bar">
        <button class="tab-btn active" data-tab="environments" onclick="switchMainTab('environments')">Environments &amp; Tool Profiles (env.json &amp; state.json)</button>
        <button class="tab-btn" data-tab="global" onclick="switchMainTab('global')">Global &amp; SDF Defaults (config.json)</button>
    </div>

    <div id="statusBanner" class="banner">
        <span id="statusBannerText"></span>
        <button class="btn btn-sm" onclick="hideBanner()">Dismiss</button>
    </div>

    <main>
        <!-- TAB 1: ENVIRONMENTS -->
        <section id="tab-environments" class="tab-panel active">
            <div class="env-layout">
                <aside class="env-sidebar">
                    <div class="env-sidebar-header">
                        <h2>Environments</h2>
                        <button class="btn btn-sm btn-primary" onclick="addNewEnvironment()">+ Add</button>
                    </div>
                    <ul class="env-list" id="envList"></ul>
                </aside>
                <div id="envEditorArea"></div>
            </div>
        </section>

        <!-- TAB 2: GLOBAL CONFIG -->
        <section id="tab-global" class="tab-panel">
            <div class="sub-tabs" id="globalSubTabs"></div>
            <div id="globalSectionsContainer"></div>
        </section>
    </main>

    <!-- Hidden file input for SQLite database picker -->
    <input type="file" id="sqliteFileInput" accept=".db,.sqlite,.sqlite3,application/x-sqlite3,application/octet-stream" style="display:none;" onchange="handleSqliteFilePicked(this)" />

    <script>
        const SESSION_TOKEN = ${JSON.stringify(token)};
        const DEFAULT_PROFILE_NAME = "default";
        let appState = {
            configDir: "",
            activeEnvironment: null,
            activeProfile: "default",
            environments: {},
            appConfig: {},
            schema: {
                environmentCredentialFields: [],
                globalSections: [],
                toolCategories: [],
                profilePresets: [],
                defaultEnabledCategories: ["table_discovery", "data_operations"],
                defaultDisabledTools: [
                    "netsuite_rebuild_vector_database"
                ],
                tools: []
            }
        };
        let selectedEnvName = null;
        let selectedProfileByEnv = {}; // { [envName]: profileName }
        let openCategoryDetails = new Set(); // tracks which category details are expanded
        let selectedGlobalSectionId = null;
        let isDirty = false;
        let lastConfigVersion = null;
        let pendingRenames = []; // [{ from, to }]
        let envDbStatusCache = {}; // { [envName]: statusObj }
        let dbPollTimer = null;

        function markDirty(dirty = true) {
            isDirty = dirty;
            const pill = document.getElementById("unsavedPill");
            if (dirty) {
                pill.classList.add("visible");
            } else {
                pill.classList.remove("visible");
            }
        }

        function showBanner(message, type = "success") {
            const banner = document.getElementById("statusBanner");
            const text = document.getElementById("statusBannerText");
            banner.className = "banner visible " + type;
            text.innerHTML = message;
        }

        function hideBanner() {
            const banner = document.getElementById("statusBanner");
            banner.className = "banner";
        }

        function switchMainTab(tabName) {
            document.querySelectorAll(".tab-btn").forEach(btn => {
                btn.classList.toggle("active", btn.dataset.tab === tabName);
            });
            document.querySelectorAll(".tab-panel").forEach(panel => {
                panel.classList.toggle("active", panel.id === "tab-" + tabName);
            });
        }

        function createDefaultProfileObj() {
            const defCats = Array.isArray(appState.schema?.defaultEnabledCategories)
                ? [...appState.schema.defaultEnabledCategories]
                : ["table_discovery", "data_operations"];
            const defDisabled = Array.isArray(appState.schema?.defaultDisabledTools)
                ? [...appState.schema.defaultDisabledTools]
                : ["netsuite_rebuild_vector_database"];
            return {
                description: "Core schema discovery and data querying tools",
                disableDestructive: false,
                disableSdf: false,
                allowDynamicActivation: true,
                enabledCategories: defCats,
                blockedCategories: [],
                enabledTools: [],
                disabledTools: defDisabled,
                blockedTools: []
            };
        }

        function ensureEnvironmentProfiles(env) {
            if (!env || typeof env !== "object") return;
            if (!env.profiles || typeof env.profiles !== "object" || Array.isArray(env.profiles)) {
                env.profiles = {};
            }
            if (!env.profiles[DEFAULT_PROFILE_NAME]) {
                env.profiles[DEFAULT_PROFILE_NAME] = createDefaultProfileObj();
            }
            Object.keys(env.profiles).forEach(pName => {
                const p = env.profiles[pName] || {};
                p.disableDestructive = Boolean(p.disableDestructive ?? false);
                p.disableSdf = Boolean(p.disableSdf ?? false);
                p.allowDynamicActivation = p.allowDynamicActivation !== undefined ? Boolean(p.allowDynamicActivation) : true;
                if (!Array.isArray(p.enabledCategories)) {
                    p.enabledCategories = Array.isArray(appState.schema?.defaultEnabledCategories)
                        ? [...appState.schema.defaultEnabledCategories]
                        : ["table_discovery", "data_operations"];
                }
                if (!Array.isArray(p.blockedCategories)) p.blockedCategories = [];
                if (!Array.isArray(p.enabledTools)) p.enabledTools = [];
                if (!Array.isArray(p.disabledTools)) {
                    p.disabledTools = Array.isArray(appState.schema?.defaultDisabledTools)
                        ? [...appState.schema.defaultDisabledTools]
                        : ["netsuite_rebuild_vector_database"];
                }
                if (!Array.isArray(p.blockedTools)) p.blockedTools = [];
                env.profiles[pName] = p;
            });
        }

        function getSelectedProfileName(envName) {
            if (!envName || !appState.environments[envName]) return DEFAULT_PROFILE_NAME;
            const env = appState.environments[envName];
            ensureEnvironmentProfiles(env);
            const currentSel = selectedProfileByEnv[envName];
            if (currentSel && env.profiles[currentSel]) {
                return currentSel;
            }
            if (envName === appState.activeEnvironment && appState.activeProfile && env.profiles[appState.activeProfile]) {
                selectedProfileByEnv[envName] = appState.activeProfile;
                return appState.activeProfile;
            }
            selectedProfileByEnv[envName] = DEFAULT_PROFILE_NAME;
            return DEFAULT_PROFILE_NAME;
        }

        async function loadSettings(preserveSelection = false) {
            try {
                const res = await fetch("/api/settings?token=" + encodeURIComponent(SESSION_TOKEN));
                if (!res.ok) {
                    throw new Error("HTTP " + res.status);
                }
                const data = await res.json();
                const prevSelectedEnv = selectedEnvName;

                appState = data;
                if (!appState.activeProfile) {
                    appState.activeProfile = DEFAULT_PROFILE_NAME;
                }
                if (data.configVersion) {
                    lastConfigVersion = data.configVersion;
                }
                document.getElementById("configDirDisplay").textContent = "Config folder: " + data.configDir;

                Object.keys(appState.environments).forEach(envName => {
                    ensureEnvironmentProfiles(appState.environments[envName]);
                });

                const envNames = Object.keys(appState.environments);
                if (preserveSelection && prevSelectedEnv && appState.environments[prevSelectedEnv]) {
                    selectedEnvName = prevSelectedEnv;
                } else if (appState.activeEnvironment && appState.environments[appState.activeEnvironment]) {
                    selectedEnvName = appState.activeEnvironment;
                } else if (envNames.length > 0) {
                    selectedEnvName = envNames[0];
                } else {
                    selectedEnvName = null;
                }

                if (appState.schema.globalSections.length > 0 && !selectedGlobalSectionId) {
                    selectedGlobalSectionId = appState.schema.globalSections[0].id;
                }

                renderAll();
                markDirty(false);
                if (selectedEnvName) {
                    void refreshDbStatus(selectedEnvName);
                }
            } catch (err) {
                showBanner("Failed to load settings: " + err.message, "error");
            }
        }

        function renderAll() {
            renderEnvSidebar();
            renderEnvEditor();
            renderGlobalTab();
        }

        function renderEnvSidebar() {
            const listEl = document.getElementById("envList");
            listEl.innerHTML = "";
            const envNames = Object.keys(appState.environments);

            if (envNames.length === 0) {
                const emptyLi = document.createElement("li");
                emptyLi.style.padding = "12px";
                emptyLi.style.color = "var(--text-secondary)";
                emptyLi.style.fontSize = "0.83rem";
                emptyLi.textContent = "No environments configured yet.";
                listEl.appendChild(emptyLi);
                return;
            }

            envNames.forEach(name => {
                const li = document.createElement("li");
                li.className = "env-item" + (name === selectedEnvName ? " selected" : "");
                li.onclick = () => {
                    selectedEnvName = name;
                    renderEnvSidebar();
                    renderEnvEditor();
                    void refreshDbStatus(name);
                };

                const nameSpan = document.createElement("span");
                nameSpan.className = "env-item-name";
                nameSpan.textContent = name;
                li.appendChild(nameSpan);

                if (name === appState.activeEnvironment) {
                    const badge = document.createElement("span");
                    badge.className = "badge badge-active";
                    badge.textContent = "Active (" + (appState.activeProfile || "default") + ")";
                    li.appendChild(badge);
                }

                listEl.appendChild(li);
            });
        }

        function addNewEnvironment() {
            let baseName = "NewEnv";
            let counter = 1;
            let candidate = baseName;
            while (appState.environments[candidate]) {
                counter++;
                candidate = baseName + counter;
            }

            appState.environments[candidate] = {
                accountId: "",
                sdfId: "",
                scriptId: "",
                deploymentId: "",
                consumerKey: "",
                consumerSecret: "",
                token: "",
                tokenSecret: "",
                profiles: {
                    [DEFAULT_PROFILE_NAME]: createDefaultProfileObj()
                }
            };

            if (Object.keys(appState.environments).length === 1 || !appState.activeEnvironment) {
                appState.activeEnvironment = candidate;
                appState.activeProfile = DEFAULT_PROFILE_NAME;
            }

            selectedEnvName = candidate;
            selectedProfileByEnv[candidate] = DEFAULT_PROFILE_NAME;
            markDirty(true);
            renderEnvSidebar();
            renderEnvEditor();
            void refreshDbStatus(candidate);
        }

        function deleteEnvironment(envName) {
            const isCurrent = envName === appState.activeEnvironment;
            const warningMsg = isCurrent
                ? "Are you sure you want to delete '" + envName + "'? This is currently the ACTIVE environment. Deleting it will leave no active environment selected unless another is chosen."
                : "Are you sure you want to delete environment '" + envName + "'?";

            if (!confirm(warningMsg)) {
                return;
            }

            delete appState.environments[envName];
            delete selectedProfileByEnv[envName];
            const remaining = Object.keys(appState.environments);

            if (isCurrent) {
                appState.activeEnvironment = null;
                appState.activeProfile = DEFAULT_PROFILE_NAME;
            }

            selectedEnvName = remaining.length > 0 ? remaining[0] : null;
            markDirty(true);
            renderEnvSidebar();
            renderEnvEditor();
            if (selectedEnvName) {
                void refreshDbStatus(selectedEnvName);
            }
        }

        function renameSelectedEnvironment(newNameRaw) {
            const newName = newNameRaw.trim();
            if (!selectedEnvName || !newName || newName === selectedEnvName) {
                return;
            }
            if (newName.includes("/") || newName.includes("\\\\") || newName === "." || newName === "..") {
                alert("Environment name cannot contain slashes or relative path dots.");
                renderEnvEditor();
                return;
            }
            if (appState.environments[newName]) {
                alert("An environment named '" + newName + "' already exists.");
                renderEnvEditor();
                return;
            }

            const oldName = selectedEnvName;
            const updatedEnvs = {};
            Object.keys(appState.environments).forEach(k => {
                if (k === oldName) {
                    updatedEnvs[newName] = appState.environments[k];
                } else {
                    updatedEnvs[k] = appState.environments[k];
                }
            });
            appState.environments = updatedEnvs;

            if (selectedProfileByEnv[oldName]) {
                selectedProfileByEnv[newName] = selectedProfileByEnv[oldName];
                delete selectedProfileByEnv[oldName];
            }

            const existingRename = pendingRenames.find(r => r.to === oldName);
            if (existingRename) {
                existingRename.to = newName;
            } else {
                pendingRenames.push({ from: oldName, to: newName });
            }

            if (envDbStatusCache[oldName]) {
                envDbStatusCache[newName] = envDbStatusCache[oldName];
                delete envDbStatusCache[oldName];
            }

            if (appState.activeEnvironment === oldName) {
                appState.activeEnvironment = newName;
            }
            selectedEnvName = newName;
            markDirty(true);
            renderEnvSidebar();
            renderEnvEditor();
            void refreshDbStatus(newName);
        }

        async function setAsActiveEnvironmentAndProfile(envName, profileName) {
            const targetProf = profileName || getSelectedProfileName(envName) || DEFAULT_PROFILE_NAME;
            appState.activeEnvironment = envName;
            appState.activeProfile = targetProf;
            selectedProfileByEnv[envName] = targetProf;
            renderEnvSidebar();
            renderEnvEditor();

            try {
                const res = await fetch("/api/active-environment?token=" + encodeURIComponent(SESSION_TOKEN), {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ activeEnvironment: envName, activeProfile: targetProf })
                });
                const data = await res.json();
                if (res.ok && data.success) {
                    if (data.configVersion) {
                        lastConfigVersion = data.configVersion;
                    }
                    showBanner(
                        "<strong>Active environment set to '" + escapeHtml(envName) + "' (profile: '" + escapeHtml(targetProf) + "')!</strong> " +
                        "state.json has been updated and your MCP client has been notified to refresh its tool list.",
                        "success"
                    );
                } else {
                    markDirty(true);
                }
            } catch {
                markDirty(true);
            }
        }

        function selectProfileTab(profileName) {
            if (!selectedEnvName) return;
            selectedProfileByEnv[selectedEnvName] = profileName;
            renderEnvEditor();
        }

        function addNewProfile() {
            if (!selectedEnvName || !appState.environments[selectedEnvName]) return;
            const env = appState.environments[selectedEnvName];
            ensureEnvironmentProfiles(env);

            const rawName = prompt("Enter a name for the new tool profile (e.g., 'developer', 'admin', 'readonly'):", "developer");
            if (!rawName) return;
            const profName = rawName.trim();
            if (!profName) return;

            if (env.profiles[profName]) {
                alert("A profile named '" + profName + "' already exists in environment '" + selectedEnvName + "'.");
                return;
            }

            // If user named it after a known preset, pre-populate from that preset
            const presets = appState.schema.profilePresets || [];
            const matchingPreset = presets.find(p => p.id.toLowerCase() === profName.toLowerCase());

            if (matchingPreset) {
                const defDisabled = Array.isArray(appState.schema?.defaultDisabledTools)
                    ? [...appState.schema.defaultDisabledTools]
                    : ["netsuite_rebuild_vector_database"];
                env.profiles[profName] = {
                    description: matchingPreset.description,
                    disableDestructive: Boolean(matchingPreset.disableDestructive),
                    disableSdf: Boolean(matchingPreset.disableSdf),
                    allowDynamicActivation: Boolean(matchingPreset.allowDynamicActivation),
                    enabledCategories: [...matchingPreset.enabledCategories],
                    blockedCategories: Array.isArray(matchingPreset.blockedCategories) ? [...matchingPreset.blockedCategories] : [],
                    enabledTools: Array.isArray(matchingPreset.enabledTools) ? [...matchingPreset.enabledTools] : [],
                    disabledTools: Array.isArray(matchingPreset.disabledTools) ? [...matchingPreset.disabledTools] : defDisabled,
                    blockedTools: Array.isArray(matchingPreset.blockedTools) ? [...matchingPreset.blockedTools] : []
                };
            } else {
                env.profiles[profName] = createDefaultProfileObj();
            }

            selectedProfileByEnv[selectedEnvName] = profName;
            markDirty(true);
            renderEnvEditor();
        }

        function deleteSelectedProfile() {
            if (!selectedEnvName || !appState.environments[selectedEnvName]) return;
            const env = appState.environments[selectedEnvName];
            const profName = getSelectedProfileName(selectedEnvName);

            if (profName === DEFAULT_PROFILE_NAME) {
                alert("The 'default' profile is permanent and cannot be deleted.");
                return;
            }

            if (!confirm("Delete profile '" + profName + "' from environment '" + selectedEnvName + "'?")) {
                return;
            }

            delete env.profiles[profName];
            selectedProfileByEnv[selectedEnvName] = DEFAULT_PROFILE_NAME;

            if (appState.activeEnvironment === selectedEnvName && appState.activeProfile === profName) {
                appState.activeProfile = DEFAULT_PROFILE_NAME;
            }

            markDirty(true);
            renderEnvSidebar();
            renderEnvEditor();
        }

        function applyPresetToSelectedProfile(presetId) {
            if (!selectedEnvName || !appState.environments[selectedEnvName]) return;
            const env = appState.environments[selectedEnvName];
            const profName = getSelectedProfileName(selectedEnvName);
            const prof = env.profiles[profName];
            if (!prof) return;

            const presets = appState.schema.profilePresets || [];
            const preset = presets.find(p => p.id === presetId);
            if (!preset) return;

            const defDisabled = Array.isArray(appState.schema?.defaultDisabledTools)
                ? [...appState.schema.defaultDisabledTools]
                : ["netsuite_rebuild_vector_database"];

            prof.description = preset.description;
            prof.disableDestructive = Boolean(preset.disableDestructive);
            prof.disableSdf = Boolean(preset.disableSdf);
            prof.allowDynamicActivation = Boolean(preset.allowDynamicActivation);
            prof.enabledCategories = [...preset.enabledCategories];
            prof.blockedCategories = Array.isArray(preset.blockedCategories) ? [...preset.blockedCategories] : [];
            prof.enabledTools = Array.isArray(preset.enabledTools) ? [...preset.enabledTools] : [];
            prof.disabledTools = Array.isArray(preset.disabledTools) ? [...preset.disabledTools] : defDisabled;
            prof.blockedTools = Array.isArray(preset.blockedTools) ? [...preset.blockedTools] : [];

            markDirty(true);
            renderEnvEditor();
        }

        function updateProfileDescription(val) {
            if (!selectedEnvName || !appState.environments[selectedEnvName]) return;
            const env = appState.environments[selectedEnvName];
            const profName = getSelectedProfileName(selectedEnvName);
            if (!env.profiles[profName]) return;
            env.profiles[profName].description = val;
            markDirty(true);
        }

        function updateProfileFlag(flagKey, checked) {
            if (!selectedEnvName || !appState.environments[selectedEnvName]) return;
            const env = appState.environments[selectedEnvName];
            const profName = getSelectedProfileName(selectedEnvName);
            const prof = env.profiles[profName];
            if (!prof) return;

            prof[flagKey] = Boolean(checked);
            markDirty(true);
            renderEnvEditor();
        }

        function toggleProfileCategory(categoryId, enabled) {
            if (!selectedEnvName || !appState.environments[selectedEnvName]) return;
            const env = appState.environments[selectedEnvName];
            const profName = getSelectedProfileName(selectedEnvName);
            const prof = env.profiles[profName];
            if (!prof) return;

            if (!Array.isArray(prof.enabledCategories)) prof.enabledCategories = [];
            if (!Array.isArray(prof.blockedCategories)) prof.blockedCategories = [];
            if (prof.blockedCategories.includes(categoryId)) return;

            const idx = prof.enabledCategories.indexOf(categoryId);

            if (enabled && idx === -1) {
                prof.enabledCategories.push(categoryId);
            } else if (!enabled && idx !== -1) {
                prof.enabledCategories.splice(idx, 1);
            }

            // Note: We intentionally preserve prof.disabledTools and prof.enabledTools so toggling
            // a category off and back on never loses per-tool overrides.
            markDirty(true);
            renderEnvEditor();
        }

        function toggleBlockCategory(categoryId, blocked) {
            if (!selectedEnvName || !appState.environments[selectedEnvName]) return;
            const env = appState.environments[selectedEnvName];
            const profName = getSelectedProfileName(selectedEnvName);
            const prof = env.profiles[profName];
            if (!prof) return;

            if (!Array.isArray(prof.blockedCategories)) prof.blockedCategories = [];
            if (!Array.isArray(prof.enabledCategories)) prof.enabledCategories = [];

            const bIdx = prof.blockedCategories.indexOf(categoryId);
            if (blocked) {
                if (bIdx === -1) prof.blockedCategories.push(categoryId);
                prof.enabledCategories = prof.enabledCategories.filter(c => c !== categoryId);
            } else {
                if (bIdx !== -1) prof.blockedCategories.splice(bIdx, 1);
            }

            markDirty(true);
            renderEnvEditor();
        }

        function toggleIndividualToolStartup(toolName, categoryId, enabled) {
            if (!selectedEnvName || !appState.environments[selectedEnvName]) return;
            const env = appState.environments[selectedEnvName];
            const profName = getSelectedProfileName(selectedEnvName);
            const prof = env.profiles[profName];
            if (!prof) return;

            if (!Array.isArray(prof.enabledCategories)) prof.enabledCategories = [];
            if (!Array.isArray(prof.enabledTools)) prof.enabledTools = [];
            if (!Array.isArray(prof.disabledTools)) prof.disabledTools = [];

            const isCatEnabled = prof.enabledCategories.includes(categoryId);

            if (isCatEnabled) {
                // Category is ON at startup: enabled tools are not in disabledTools; disabled tools are in disabledTools
                if (enabled) {
                    prof.disabledTools = prof.disabledTools.filter(t => t !== toolName);
                } else {
                    if (!prof.disabledTools.includes(toolName)) {
                        prof.disabledTools.push(toolName);
                    }
                    prof.enabledTools = prof.enabledTools.filter(t => t !== toolName);
                }
            } else {
                // Category is OFF at startup: enabled tools are in enabledTools; disabled tools are not in enabledTools
                if (enabled) {
                    if (!prof.enabledTools.includes(toolName)) {
                        prof.enabledTools.push(toolName);
                    }
                    prof.disabledTools = prof.disabledTools.filter(t => t !== toolName);
                } else {
                    prof.enabledTools = prof.enabledTools.filter(t => t !== toolName);
                }
            }

            markDirty(true);
            renderEnvEditor();
        }

        function toggleIndividualToolBlocked(toolName, blocked) {
            if (!selectedEnvName || !appState.environments[selectedEnvName]) return;
            const env = appState.environments[selectedEnvName];
            const profName = getSelectedProfileName(selectedEnvName);
            const prof = env.profiles[profName];
            if (!prof) return;

            if (!Array.isArray(prof.blockedTools)) prof.blockedTools = [];
            if (!Array.isArray(prof.enabledTools)) prof.enabledTools = [];

            if (blocked) {
                if (!prof.blockedTools.includes(toolName)) {
                    prof.blockedTools.push(toolName);
                }
                prof.enabledTools = prof.enabledTools.filter(t => t !== toolName);
            } else {
                prof.blockedTools = prof.blockedTools.filter(t => t !== toolName);
            }

            markDirty(true);
            renderEnvEditor();
        }

        function toggleCategoryDrawer(catId) {
            if (openCategoryDetails.has(catId)) {
                openCategoryDetails.delete(catId);
            } else {
                openCategoryDetails.add(catId);
            }
            const el = document.getElementById("tool_cat_section_" + catId);
            if (el) {
                el.classList.toggle("is-open", openCategoryDetails.has(catId));
            }
        }

        function escapeHtml(str) {
            return String(str ?? "")
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;");
        }

        function formatBytes(bytes) {
            if (!bytes || bytes <= 0) return "0 B";
            const units = ["B", "KB", "MB", "GB"];
            let idx = 0;
            let val = bytes;
            while (val >= 1024 && idx < units.length - 1) {
                val /= 1024;
                idx++;
            }
            return val.toFixed(idx === 0 ? 0 : 2) + " " + units[idx];
        }

        function formatTimestamp(ms) {
            if (!ms) return "";
            try {
                return new Date(ms).toLocaleString();
            } catch {
                return "";
            }
        }

        function formatPhaseLabel(phase) {
            switch (phase) {
                case "loading_schema": return "Loading schema tables and fields...";
                case "generating_embeddings": return "Generating table embeddings...";
                case "writing_database": return "Writing LanceDB vector database...";
                case "done": return "Completed";
                case "error": return "Failed";
                default: return phase || "";
            }
        }

        async function refreshDbStatus(envName) {
            if (!envName) return;
            try {
                const res = await fetch("/api/db-status?token=" + encodeURIComponent(SESSION_TOKEN) + "&env=" + encodeURIComponent(envName));
                if (!res.ok) return;
                const data = await res.json();
                if (data.success) {
                    envDbStatusCache[envName] = data;
                    if (selectedEnvName === envName) {
                        renderDbStatusCardContent();
                    }
                    const isBuilding = data.rebuildState && data.rebuildState.status === "in_progress";
                    if (isBuilding && selectedEnvName === envName) {
                        clearTimeout(dbPollTimer);
                        dbPollTimer = setTimeout(() => {
                            void refreshDbStatus(envName);
                        }, 1200);
                    }
                }
            } catch {
                // ignore background status errors
            }
        }

        function renderDbStatusCardContent() {
            const container = document.getElementById("dbStatusCardBody");
            if (!container || !selectedEnvName) return;

            const st = envDbStatusCache[selectedEnvName];
            if (!st) {
                container.innerHTML = '<div class="help-text">Checking database status...</div>';
                return;
            }

            const rebuild = st.rebuildState;
            const isRebuilding = rebuild && rebuild.status === "in_progress";
            const isOutOfDate = st.sqliteExists && st.lanceExists && st.sqliteModifiedAt && st.lanceModifiedAt && (st.sqliteModifiedAt > st.lanceModifiedAt + 2000);

            let sqliteBadge = st.sqliteExists
                ? '<span class="badge badge-active">Loaded</span>'
                : '<span class="badge badge-warning">Missing</span>';

            let sqliteMeta = "";
            if (st.sqliteExists) {
                const countStr = typeof st.sqliteTableCount === "number" ? \`\${st.sqliteTableCount} tables • \` : "";
                sqliteMeta = \`
                    <div><strong>File:</strong> <code>\${escapeHtml(selectedEnvName)}.db</code></div>
                    <div><strong>Details:</strong> \${countStr}\${formatBytes(st.sqliteSize)}</div>
                    <div><strong>Updated:</strong> \${escapeHtml(formatTimestamp(st.sqliteModifiedAt))}</div>
                \`;
            } else {
                sqliteMeta = \`
                    <div>No SQLite schema database found at <code>\${escapeHtml(selectedEnvName)}.db</code>.</div>
                    <div style="margin-top:4px;">Export a schema database using <code>MCPSchemaLoad.html</code> in NetSuite, then click below to load and rename it automatically.</div>
                \`;
            }

            let lanceBadge = "";
            if (isRebuilding) {
                lanceBadge = '<span class="badge badge-override">Building...</span>';
            } else if (st.lanceExists && isOutOfDate) {
                lanceBadge = '<span class="badge badge-warning">Needs Rebuild</span>';
            } else if (st.lanceExists) {
                lanceBadge = '<span class="badge badge-active">Ready</span>';
            } else {
                lanceBadge = '<span class="badge badge-warning">Not Built</span>';
            }

            let lanceMeta = "";
            if (isRebuilding) {
                const pct = rebuild.totalTables > 0
                    ? Math.round((rebuild.processedTables / rebuild.totalTables) * 100)
                    : 5;
                const elapsed = ((Date.now() - rebuild.startedAt) / 1000).toFixed(1);
                lanceMeta = \`
                    <div><strong>Phase:</strong> \${escapeHtml(formatPhaseLabel(rebuild.phase))}</div>
                    <div><strong>Progress:</strong> \${rebuild.totalTables > 0 ? \`\${rebuild.processedTables} / \${rebuild.totalTables} tables (\${pct}%)\` : "Preparing tables..."} • \${elapsed}s</div>
                    <div class="progress-wrap">
                        <div class="progress-track">
                            <div class="progress-fill" style="width: \${pct}%;"></div>
                        </div>
                    </div>
                \`;
            } else if (rebuild && rebuild.status === "failed") {
                lanceMeta = \`
                    <div style="color:#fca5a5;"><strong>Last rebuild failed:</strong> \${escapeHtml(rebuild.error || "Unknown error")}</div>
                \`;
            } else if (st.lanceExists) {
                const lastCompletedNote = (rebuild && rebuild.status === "completed")
                    ? \`<div><strong>Last build:</strong> Indexed \${rebuild.processedTables} tables in \${((rebuild.completedAt - rebuild.startedAt) / 1000).toFixed(1)}s</div>\`
                    : "";
                lanceMeta = \`
                    <div><strong>Directory:</strong> <code>\${escapeHtml(selectedEnvName)}.lance</code></div>
                    <div><strong>Updated:</strong> \${escapeHtml(formatTimestamp(st.lanceModifiedAt))}</div>
                    \${lastCompletedNote}
                    \${isOutOfDate ? '<div class="toggle-note">⚠️ SQLite database is newer than the vector database. Rebuild recommended.</div>' : ''}
                \`;
            } else {
                lanceMeta = \`
                    <div>Vector database <code>\${escapeHtml(selectedEnvName)}.lance</code> has not been built yet.</div>
                    <div style="margin-top:4px;">Required for natural-language semantic table search (<code>netsuite_search_tables</code>).</div>
                \`;
            }

            container.innerHTML = \`
                <div class="db-grid">
                    <div class="db-box">
                        <div>
                            <div class="db-box-header">
                                <span class="db-box-title">SQLite Schema Database</span>
                                \${sqliteBadge}
                            </div>
                            <div class="db-meta" style="margin-top: 10px;">
                                \${sqliteMeta}
                            </div>
                        </div>
                        <div class="db-actions">
                            <button class="btn btn-sm \${st.sqliteExists ? '' : 'btn-primary'}" \${isRebuilding ? 'disabled' : ''} onclick="triggerSqliteFilePicker()">
                                \${st.sqliteExists ? "Replace SQLite Database (.db)..." : "Load SQLite Database (.db)..."}
                            </button>
                        </div>
                    </div>

                    <div class="db-box">
                        <div>
                            <div class="db-box-header">
                                <span class="db-box-title">LanceDB Vector Database</span>
                                \${lanceBadge}
                            </div>
                            <div class="db-meta" style="margin-top: 10px;">
                                \${lanceMeta}
                            </div>
                        </div>
                        <div class="db-actions">
                            <button
                                class="btn btn-sm \${(!st.lanceExists || isOutOfDate) && st.sqliteExists ? 'btn-primary' : ''}"
                                \${(!st.sqliteExists || isRebuilding) ? 'disabled' : ''}
                                onclick="triggerVectorDbRebuild()"
                            >
                                \${isRebuilding ? "Rebuilding Vector Database..." : (st.lanceExists ? "Rebuild Vector Database (.lance)" : "Build Vector Database (.lance)")}
                            </button>
                        </div>
                    </div>
                </div>
                <div id="dbActionResult" class="test-result"></div>
            \`;
        }

        function triggerSqliteFilePicker() {
            const input = document.getElementById("sqliteFileInput");
            if (!input) return;
            input.value = "";
            input.click();
        }

        async function handleSqliteFilePicked(inputEl) {
            const file = inputEl.files && inputEl.files[0];
            if (!file || !selectedEnvName) return;

            const envName = selectedEnvName;
            const resEl = document.getElementById("dbActionResult");
            if (resEl) {
                resEl.className = "test-result visible ok";
                resEl.textContent = "Uploading and validating '" + file.name + "' for environment '" + envName + "'...";
            }

            try {
                const arrayBuffer = await file.arrayBuffer();
                const res = await fetch("/api/upload-sqlite?token=" + encodeURIComponent(SESSION_TOKEN) + "&env=" + encodeURIComponent(envName), {
                    method: "POST",
                    headers: { "Content-Type": "application/octet-stream" },
                    body: arrayBuffer
                });
                const data = await res.json();
                if (!res.ok || !data.success) {
                    throw new Error(data.error || ("HTTP " + res.status));
                }

                envDbStatusCache[envName] = data;
                renderDbStatusCardContent();

                const newResEl = document.getElementById("dbActionResult");
                if (newResEl) {
                    newResEl.className = "test-result visible ok";
                    newResEl.textContent = "✓ Loaded '" + file.name + "' as '" + envName + ".db' (" + data.tableCount + " tables, " + data.fieldCount + " fields).";
                }
            } catch (err) {
                const newResEl = document.getElementById("dbActionResult");
                if (newResEl) {
                    newResEl.className = "test-result visible err";
                    newResEl.textContent = "✗ Failed to load SQLite database: " + err.message;
                }
            }
        }

        async function triggerVectorDbRebuild() {
            if (!selectedEnvName) return;
            const envName = selectedEnvName;

            try {
                const res = await fetch("/api/rebuild-vector-db?token=" + encodeURIComponent(SESSION_TOKEN) + "&env=" + encodeURIComponent(envName), {
                    method: "POST"
                });
                const data = await res.json();
                if (!res.ok || !data.success) {
                    throw new Error(data.error || ("HTTP " + res.status));
                }
                await refreshDbStatus(envName);
            } catch (err) {
                const resEl = document.getElementById("dbActionResult");
                if (resEl) {
                    resEl.className = "test-result visible err";
                    resEl.textContent = "✗ Failed to start vector database rebuild: " + err.message;
                }
            }
        }

        function renderEnvEditor() {
            const container = document.getElementById("envEditorArea");
            if (!selectedEnvName || !appState.environments[selectedEnvName]) {
                container.innerHTML = \`
                    <div class="empty-state">
                        <h3>No Environment Selected</h3>
                        <p>Create your first NetSuite environment to configure credentials, schema databases, and tool profiles. When you click Save Changes, the config folder and JSON files will be created automatically.</p>
                        <button class="btn btn-primary" onclick="addNewEnvironment()">+ Create Environment</button>
                    </div>
                \`;
                return;
            }

            const env = appState.environments[selectedEnvName];
            ensureEnvironmentProfiles(env);

            const selectedProfileName = getSelectedProfileName(selectedEnvName);
            const activeProf = env.profiles[selectedProfileName] || env.profiles[DEFAULT_PROFILE_NAME];

            const isEnvActive = selectedEnvName === appState.activeEnvironment;
            const isProfileActive = isEnvActive && (appState.activeProfile || DEFAULT_PROFILE_NAME) === selectedProfileName;
            const sdfIdMissing = !env.sdfId || String(env.sdfId).trim() === "";

            let credsHtml = "";
            appState.schema.environmentCredentialFields.forEach(field => {
                const val = env[field.key] ?? "";
                const inputType = field.type === "secret" ? "password" : "text";
                const inputId = "env_field_" + field.key;
                credsHtml += \`
                    <div class="form-field">
                        <label for="\${inputId}">
                            <span>\${escapeHtml(field.label)}\${field.required ? '<span class="req">*</span>' : ''}</span>
                        </label>
                        <div class="input-wrap">
                            <input
                                type="\${inputType}"
                                id="\${inputId}"
                                value="\${escapeHtml(val)}"
                                placeholder="\${escapeHtml(field.placeholder || '')}"
                                oninput="updateEnvField('\${field.key}', this.value)"
                            />
                            \${field.type === "secret" ? \`<button type="button" class="secret-toggle" onclick="toggleSecretVisibility('\${inputId}', this)">Show</button>\` : ""}
                        </div>
                        \${field.helpText ? \`<div class="help-text">\${escapeHtml(field.helpText)}</div>\` : ""}
                    </div>
                \`;
            });

            // Profile selector tabs
            const profileNames = Object.keys(env.profiles);
            let profileTabsHtml = "";
            profileNames.forEach(pName => {
                const isSelected = pName === selectedProfileName;
                const isThisActive = isEnvActive && (appState.activeProfile || DEFAULT_PROFILE_NAME) === pName;
                profileTabsHtml += \`
                    <button
                        type="button"
                        class="profile-tab \${isSelected ? 'selected' : ''}"
                        onclick="selectProfileTab('\${escapeHtml(pName)}')"
                    >
                        <span>\${escapeHtml(pName)}</span>
                        \${isThisActive ? '<span class="badge badge-active" style="font-size:0.62rem; padding:1px 6px;">Active</span>' : ''}
                    </button>
                \`;
            });

            // Preset buttons
            const presets = Array.isArray(appState.schema.profilePresets) ? appState.schema.profilePresets : [];
            const presetsHtml = presets.map(preset => \`
                <button
                    type="button"
                    class="btn btn-sm"
                    onclick="applyPresetToSelectedProfile('\${escapeHtml(preset.id)}')"
                    title="\${escapeHtml(preset.description)}"
                >\${escapeHtml(preset.title)}</button>
            \`).join("");

            // Build categories & tools sections
            const selectableTools = appState.schema.tools || [];
            const definedCategories = Array.isArray(appState.schema.toolCategories) && appState.schema.toolCategories.length > 0
                ? appState.schema.toolCategories
                : [
                    { id: "table_discovery", title: "Table & Schema Discovery", description: "" },
                    { id: "data_operations", title: "Data Querying & Record Operations", description: "" },
                    { id: "script_execution", title: "Script Execution & Log Inspection", description: "" },
                    { id: "sdf_file_deployment", title: "File Cabinet & SDF Files", description: "" },
                    { id: "script_management", title: "Script Management", description: "" },
                    { id: "custom_objects", title: "Custom Objects (Records & Lists)", description: "" },
                    { id: "translations", title: "Translation Collections", description: "" },
                    { id: "templates", title: "Templates (Advanced PDF & Email)", description: "" }
                ];

            const categoryList = [...definedCategories];
            const knownCategoryIds = new Set(categoryList.map(c => c.id));
            if (selectableTools.some(t => !t.category || !knownCategoryIds.has(t.category))) {
                categoryList.push({ id: "other", title: "Other Tools", description: "" });
            }

            let totalBaselineEnabledCount = 0;
            let toolsSectionsHtml = "";

            categoryList.forEach(cat => {
                const sectionTools = selectableTools.filter(t => {
                    const toolCat = (t.category && knownCategoryIds.has(t.category)) ? t.category : "other";
                    return toolCat === cat.id;
                });

                if (sectionTools.length === 0) {
                    return;
                }

                const isCategoryBlocked = Array.isArray(activeProf.blockedCategories) && activeProf.blockedCategories.includes(cat.id);
                const isCategoryEnabled = !isCategoryBlocked && Array.isArray(activeProf.enabledCategories) && activeProf.enabledCategories.includes(cat.id);
                let sectionEnabledCount = 0;
                let sectionBlockedCount = 0;
                let sectionDisabledInEnabledCatCount = 0;
                let sectionRowsHtml = "";

                sectionTools.forEach(tool => {
                    const lockedByDestructive = tool.isDestructive && activeProf.disableDestructive === true;
                    const lockedBySdfSetting = tool.requiresSdf && activeProf.disableSdf === true;
                    const lockedByMissingSdfId = tool.requiresSdf && sdfIdMissing;
                    const isHardGuardrailLocked = isCategoryBlocked || lockedByDestructive || lockedBySdfSetting || lockedByMissingSdfId;

                    const isExplicitlyBlocked = Array.isArray(activeProf.blockedTools) && activeProf.blockedTools.includes(tool.name);
                    const isExplicitlyEnabled = Array.isArray(activeProf.enabledTools) && activeProf.enabledTools.includes(tool.name);
                    const isExplicitlyDisabled = Array.isArray(activeProf.disabledTools) && activeProf.disabledTools.includes(tool.name);

                    if (isExplicitlyBlocked || isHardGuardrailLocked) {
                        sectionBlockedCount++;
                    } else if (isCategoryEnabled && isExplicitlyDisabled) {
                        sectionDisabledInEnabledCatCount++;
                    }

                    let lockReasons = [];
                    if (isCategoryBlocked) {
                        lockReasons.push("Locked because entire category is Blocked");
                    }
                    if (lockedByDestructive) {
                        lockReasons.push("Locked by 'Disable Destructive Tools' guardrail");
                    }
                    if (lockedBySdfSetting) {
                        lockReasons.push("Locked by 'Disable SDF Tools' guardrail");
                    } else if (lockedByMissingSdfId) {
                        lockReasons.push("Locked because 'SDF Auth ID (sdfId)' is not configured");
                    }
                    if (isExplicitlyBlocked) {
                        lockReasons.push("Hard-blocked in blockedTools (cannot be dynamically activated)");
                    }

                    const isEffectiveBaselineEnabled =
                        !isHardGuardrailLocked &&
                        !isExplicitlyBlocked &&
                        (isCategoryEnabled ? !isExplicitlyDisabled : isExplicitlyEnabled);

                    if (isEffectiveBaselineEnabled) {
                        sectionEnabledCount++;
                        totalBaselineEnabledCount++;
                    }

                    const isToggleLocked = isHardGuardrailLocked || isExplicitlyBlocked;

                    sectionRowsHtml += \`
                        <div class="tool-list-row \${isToggleLocked ? 'locked' : ''}">
                            <div class="toggle-info">
                                <div class="toggle-title">
                                    <code>\${escapeHtml(tool.name)}</code>
                                    \${tool.isDestructive ? '<span class="badge badge-destructive">Destructive</span>' : ''}
                                    \${tool.requiresSdf ? '<span class="badge badge-sdf">Requires SDF</span>' : ''}
                                    \${(!isToggleLocked && ((isCategoryEnabled && isExplicitlyDisabled) || (!isCategoryEnabled && isExplicitlyEnabled)))
                                        ? '<span class="badge badge-override">Custom</span>'
                                        : ''
                                    }
                                </div>
                                <div class="toggle-desc" title="\${escapeHtml(tool.description)}">\${escapeHtml(tool.description)}</div>
                                \${lockReasons.length > 0 ? \`<div class="toggle-note">⚠️ \${escapeHtml(lockReasons.join(" • "))}</div>\` : ''}
                            </div>
                            <div class="row-controls">
                                <label
                                    class="block-pill \${isExplicitlyBlocked ? 'active' : ''} \${isCategoryBlocked ? 'disabled-pill' : ''}"
                                    title="Hard-block this tool so it is never enabled at startup or via dynamic session activation"
                                >
                                    <input
                                        type="checkbox"
                                        \${isExplicitlyBlocked ? "checked" : ""}
                                        \${isCategoryBlocked ? "disabled" : ""}
                                        onchange="toggleIndividualToolBlocked('\${tool.name}', this.checked)"
                                    />
                                    <span>Block</span>
                                </label>
                                <label
                                    class="switch"
                                    title="\${isToggleLocked ? escapeHtml(lockReasons.join(', ')) : 'Toggle whether this tool is enabled at session startup'}"
                                >
                                    <input
                                        type="checkbox"
                                        \${isEffectiveBaselineEnabled ? "checked" : ""}
                                        \${isToggleLocked ? "disabled" : ""}
                                        onchange="toggleIndividualToolStartup('\${tool.name}', '\${escapeHtml(cat.id)}', this.checked)"
                                    />
                                    <span class="slider"></span>
                                </label>
                            </div>
                        </div>
                    \`;
                });

                const isDetailsOpen = openCategoryDetails.has(cat.id);
                let catBadgeHtml = "";
                if (isCategoryBlocked) {
                    catBadgeHtml = '<span class="badge badge-destructive">Blocked</span>';
                } else if (!isCategoryEnabled && activeProf.allowDynamicActivation !== false && sectionEnabledCount === 0) {
                    catBadgeHtml = '<span class="badge badge-override">On-Demand</span>';
                }

                toolsSectionsHtml += \`
                    <div
                        id="tool_cat_section_\${escapeHtml(cat.id)}"
                        class="tool-section \${isCategoryBlocked ? 'cat-blocked' : (isCategoryEnabled ? 'cat-enabled' : '')} \${isDetailsOpen ? 'is-open' : ''}"
                    >
                        <div
                            class="tool-section-header"
                            onclick="toggleCategoryDrawer('\${escapeHtml(cat.id)}')"
                            title="Click to expand or collapse individual tools in \${escapeHtml(cat.title)}"
                        >
                            <div class="tool-section-title-wrap">
                                <div class="tool-section-title-line">
                                    <span class="cat-chevron">▶</span>
                                    <span class="tool-section-title">\${escapeHtml(cat.title)}</span>
                                    <span class="count-pill \${sectionEnabledCount > 0 ? 'has-active' : ''}">
                                        \${sectionEnabledCount} / \${sectionTools.length} active
                                    </span>
                                    \${catBadgeHtml}
                                    \${sectionBlockedCount > 0 && !isCategoryBlocked ? \`<span class="badge badge-destructive">\${sectionBlockedCount} blocked</span>\` : ''}
                                </div>
                                \${cat.description ? \`<div class="tool-section-desc">\${escapeHtml(cat.description)}</div>\` : ''}
                            </div>
                            <div class="tool-section-actions" onclick="event.stopPropagation()">
                                <label
                                    class="block-pill \${isCategoryBlocked ? 'active' : ''}"
                                    title="Hard-block this entire category so none of its tools can be enabled at startup or via dynamic session activation"
                                >
                                    <input
                                        type="checkbox"
                                        \${isCategoryBlocked ? "checked" : ""}
                                        onchange="toggleBlockCategory('\${escapeHtml(cat.id)}', this.checked)"
                                    />
                                    <span>Block</span>
                                </label>
                                <label
                                    class="switch"
                                    title="\${isCategoryBlocked ? 'Unblock category first to enable it at startup' : 'Toggle whether this category is enabled at session startup'}"
                                >
                                    <input
                                        type="checkbox"
                                        \${isCategoryEnabled ? "checked" : ""}
                                        \${isCategoryBlocked ? "disabled" : ""}
                                        onchange="toggleProfileCategory('\${escapeHtml(cat.id)}', this.checked)"
                                    />
                                    <span class="slider"></span>
                                </label>
                            </div>
                        </div>
                        <div class="tool-section-body">
                            \${sectionRowsHtml}
                        </div>
                    </div>
                \`;
            });

            // System tools count: list_environments, switch_environment, open_settings (+ manage_toolsets when dynamic activation is on)
            const systemToolsCount = activeProf.allowDynamicActivation !== false ? 4 : 3;
            const totalInitialTools = totalBaselineEnabledCount + systemToolsCount;
            const isHeavyContext = totalInitialTools > 20;

            container.innerHTML = \`
                <div class="card">
                    <div class="card-header">
                        <div>
                            <h3>Environment: \${escapeHtml(selectedEnvName)}</h3>
                            <p>Configure NetSuite OAuth 1.0a credentials, RESTlet endpoints, and SuiteCloud CLI Auth ID.</p>
                        </div>
                        <div style="display:flex; gap:8px; align-items:center;">
                            \${isEnvActive
                                ? \`<span class="badge badge-active" style="padding:6px 12px; font-size:0.78rem;">✓ Active Environment (\${escapeHtml(appState.activeProfile || 'default')})</span>\`
                                : \`<button class="btn btn-sm" onclick="setAsActiveEnvironmentAndProfile('\${escapeHtml(selectedEnvName)}', '\${escapeHtml(selectedProfileName)}')">Set as Active Environment</button>\`
                            }
                            <button class="btn btn-sm btn-danger" onclick="deleteEnvironment('\${escapeHtml(selectedEnvName)}')">Delete Environment</button>
                        </div>
                    </div>

                    <div class="form-grid" style="margin-bottom: 20px;">
                        <div class="form-field">
                            <label for="env_name_input">Environment Name <span class="req">*</span></label>
                            <input
                                type="text"
                                id="env_name_input"
                                value="\${escapeHtml(selectedEnvName)}"
                                onchange="renameSelectedEnvironment(this.value)"
                            />
                            <div class="help-text">Key used in env.json, state.json, and for &lt;environment&gt;.db schema files.</div>
                        </div>
                    </div>

                    <div class="form-grid">
                        \${credsHtml}
                    </div>

                    <div style="margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--border-color); display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:12px;">
                        <div class="help-text">Verify your OAuth credentials and RESTlet deployment before saving.</div>
                        <button class="btn" id="testConnBtn" onclick="testCurrentEnvironmentConnection()">Test Connection</button>
                    </div>
                    <div id="testConnResult" class="test-result"></div>
                </div>

                <div class="card">
                    <div class="card-header">
                        <div>
                            <h3>Schema &amp; Vector Database</h3>
                            <p>Load the exported NetSuite SQLite schema database (<code>\${escapeHtml(selectedEnvName)}.db</code>) and build the LanceDB vector index (<code>\${escapeHtml(selectedEnvName)}.lance</code>) shared across all profiles in this environment.</p>
                        </div>
                    </div>
                    <div id="dbStatusCardBody"></div>
                </div>

                <div class="card">
                    <div class="card-header">
                        <div>
                            <h3>Tool Profiles &amp; Permissions</h3>
                            <p>Create lightweight tool profiles for <strong>\${escapeHtml(selectedEnvName)}</strong> (e.g., <code>default</code>, <code>developer</code>, <code>admin</code>) that share credentials and databases while keeping agent context lean.</p>
                        </div>
                    </div>

                    <div class="profile-bar">
                        <div class="profile-tabs">
                            <span style="font-size:0.8rem; color:var(--text-secondary); margin-right:4px;">Profiles:</span>
                            \${profileTabsHtml}
                            <button type="button" class="btn btn-sm" onclick="addNewProfile()">+ Add Profile</button>
                        </div>
                        <div style="display:flex; align-items:center; gap:8px;">
                            \${isProfileActive
                                ? '<span class="badge badge-active" style="padding:5px 10px;">✓ Active Profile</span>'
                                : \`<button type="button" class="btn btn-sm btn-primary" onclick="setAsActiveEnvironmentAndProfile('\${escapeHtml(selectedEnvName)}', '\${escapeHtml(selectedProfileName)}')">Activate '\${escapeHtml(selectedProfileName)}' Now</button>\`
                            }
                            \${selectedProfileName !== DEFAULT_PROFILE_NAME
                                ? \`<button type="button" class="btn btn-sm btn-danger" onclick="deleteSelectedProfile()">Delete Profile</button>\`
                                : ''
                            }
                        </div>
                    </div>

                    <div class="form-grid" style="margin-bottom: 16px;">
                        <div class="form-field">
                            <label for="profile_desc_input">Profile Description (<code>\${escapeHtml(selectedProfileName)}</code>)</label>
                            <input
                                type="text"
                                id="profile_desc_input"
                                value="\${escapeHtml(activeProf.description || '')}"
                                placeholder="e.g., Core schema discovery and data querying tools"
                                oninput="updateProfileDescription(this.value)"
                            />
                        </div>
                    </div>

                    <div class="preset-chips">
                        <span class="preset-label">Quick Apply Preset to <strong>\${escapeHtml(selectedProfileName)}</strong>:</span>
                        \${presetsHtml}
                    </div>

                    <div class="context-warning-box \${isHeavyContext ? 'heavy' : 'optimal'}">
                        <div>
                            <strong>\${totalInitialTools} tools enabled at session startup</strong>
                            (\${totalBaselineEnabledCount} domain tools + \${systemToolsCount} system tools).
                            \${isHeavyContext
                                ? " ⚠️ Having more than ~20 tools enabled simultaneously can increase token usage and degrade agent tool-selection accuracy. Consider disabling specialized categories and relying on Dynamic Toolset Activation."
                                : " ✓ Lightweight startup footprint for optimal agent accuracy and speed."
                            }
                        </div>
                    </div>

                    <h4 style="margin: 16px 0 10px; font-size: 0.92rem; color: var(--text-primary);">Hard Security Guardrails &amp; Dynamic Activation</h4>

                    <div class="toggle-row">
                        <div class="toggle-info">
                            <div class="toggle-title">
                                <span>Allow Dynamic Session Toolset Activation (<code>allowDynamicActivation</code>)</span>
                                <span class="badge badge-override">Context Saver</span>
                            </div>
                            <div class="toggle-desc">When enabled, exposes <code>netsuite_manage_toolsets</code> so the AI assistant can temporarily activate inactive tool categories on-demand for the current chat session. Never bypasses <code>disableDestructive</code>, <code>disableSdf</code>, or <code>blockedTools</code>.</div>
                        </div>
                        <label class="switch">
                            <input
                                type="checkbox"
                                \${activeProf.allowDynamicActivation !== false ? "checked" : ""}
                                onchange="updateProfileFlag('allowDynamicActivation', this.checked)"
                            />
                            <span class="slider"></span>
                        </label>
                    </div>

                    <div class="toggle-row">
                        <div class="toggle-info">
                            <div class="toggle-title">
                                <span>Disable Destructive Tools (<code>disableDestructive</code>)</span>
                                <span class="badge badge-destructive">Hard Guardrail</span>
                            </div>
                            <div class="toggle-desc">Hard-blocks all tools that create/modify records, upload files, deploy SDF objects, or run server-side functions. Cannot be overridden dynamically. Recommended for Production.</div>
                        </div>
                        <label class="switch">
                            <input
                                type="checkbox"
                                \${activeProf.disableDestructive === true ? "checked" : ""}
                                onchange="updateProfileFlag('disableDestructive', this.checked)"
                            />
                            <span class="slider danger-on"></span>
                        </label>
                    </div>

                    <div class="toggle-row">
                        <div class="toggle-info">
                            <div class="toggle-title">
                                <span>Disable SDF Tools (<code>disableSdf</code>)</span>
                                <span class="badge badge-sdf">Hard Guardrail</span>
                            </div>
                            <div class="toggle-desc">Hard-blocks all SuiteCloud Development Framework (SDF) deployment and file upload tools. Cannot be overridden dynamically.</div>
                            \${sdfIdMissing ? '<div class="toggle-note">ℹ️ Note: SDF Auth ID (sdfId) is currently blank, so SDF tools are automatically disabled.</div>' : ''}
                        </div>
                        <label class="switch">
                            <input
                                type="checkbox"
                                \${activeProf.disableSdf === true ? "checked" : ""}
                                onchange="updateProfileFlag('disableSdf', this.checked)"
                            />
                            <span class="slider danger-on"></span>
                        </label>
                    </div>

                    <h4 style="margin: 20px 0 8px; font-size: 0.92rem; color: var(--text-primary);">Tool Categories (<code>enabledCategories</code>) &amp; Individual Tool Overrides</h4>
                    <div class="help-text" style="margin-bottom: 10px;">
                        Toggle which categories are loaded at startup for the <strong>\${escapeHtml(selectedProfileName)}</strong> profile, or check <strong>Block Category</strong> to hard-block an entire category. Expand any category to toggle individual tools on/off at startup (<code>disabledTools</code> / <code>enabledTools</code>) or hard-block individual tools (<code>blockedTools</code>).
                    </div>

                    <div class="categories-grid">
                        \${toolsSectionsHtml}
                    </div>
                </div>
            \`;

            renderDbStatusCardContent();
        }

        function toggleSecretVisibility(inputId, btn) {
            const input = document.getElementById(inputId);
            if (!input) return;
            if (input.type === "password") {
                input.type = "text";
                btn.textContent = "Hide";
            } else {
                input.type = "password";
                btn.textContent = "Show";
            }
        }

        function updateEnvField(key, value) {
            if (!selectedEnvName || !appState.environments[selectedEnvName]) return;
            const prevSdfEmpty = !appState.environments[selectedEnvName].sdfId || String(appState.environments[selectedEnvName].sdfId).trim() === "";
            appState.environments[selectedEnvName][key] = value;
            markDirty(true);

            if (key === "sdfId") {
                const nowSdfEmpty = !value || String(value).trim() === "";
                if (prevSdfEmpty !== nowSdfEmpty) {
                    const cursorPos = document.getElementById("env_field_sdfId")?.selectionStart;
                    renderEnvEditor();
                    const input = document.getElementById("env_field_sdfId");
                    if (input) {
                        input.focus();
                        if (typeof cursorPos === "number") {
                            input.setSelectionRange(cursorPos, cursorPos);
                        }
                    }
                }
            }
        }

        async function testCurrentEnvironmentConnection() {
            if (!selectedEnvName || !appState.environments[selectedEnvName]) return;
            const env = appState.environments[selectedEnvName];
            const btn = document.getElementById("testConnBtn");
            const resEl = document.getElementById("testConnResult");

            btn.disabled = true;
            btn.textContent = "Testing Connection...";
            resEl.className = "test-result";
            resEl.textContent = "";

            try {
                const res = await fetch("/api/test-connection?token=" + encodeURIComponent(SESSION_TOKEN), {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ config: env })
                });
                const data = await res.json();
                if (data.success) {
                    resEl.className = "test-result visible ok";
                    resEl.textContent = "✓ " + data.message;
                } else {
                    resEl.className = "test-result visible err";
                    resEl.textContent = "✗ " + (data.error || "Connection test failed.");
                }
            } catch (err) {
                resEl.className = "test-result visible err";
                resEl.textContent = "✗ Request failed: " + err.message;
            } finally {
                btn.disabled = false;
                btn.textContent = "Test Connection";
            }
        }

        // Helpers for nested config.json paths
        function getNestedConfigValue(obj, pathArr) {
            let cur = obj;
            for (const segment of pathArr) {
                if (!cur || typeof cur !== "object") return undefined;
                cur = cur[segment];
            }
            return cur;
        }

        function setNestedConfigValue(obj, pathArr, key, value) {
            let cur = obj;
            for (const segment of pathArr) {
                if (!cur[segment] || typeof cur[segment] !== "object" || Array.isArray(cur[segment])) {
                    cur[segment] = {};
                }
                cur = cur[segment];
            }
            if (value === undefined) {
                delete cur[key];
            } else {
                cur[key] = value;
            }
        }

        function renderGlobalTab() {
            const subTabsEl = document.getElementById("globalSubTabs");
            const containerEl = document.getElementById("globalSectionsContainer");
            subTabsEl.innerHTML = "";
            containerEl.innerHTML = "";

            const sections = appState.schema.globalSections || [];
            if (sections.length === 0) return;

            if (!selectedGlobalSectionId) {
                selectedGlobalSectionId = sections[0].id;
            }

            sections.forEach(sec => {
                const sectionObj = getNestedConfigValue(appState.appConfig, sec.configPath) || {};
                const overrideCount = sec.fields.filter(f => sectionObj[f.key] !== undefined).length;

                const btn = document.createElement("button");
                btn.className = "sub-tab-btn" + (sec.id === selectedGlobalSectionId ? " active" : "");
                btn.textContent = sec.title + (overrideCount > 0 ? \` (\${overrideCount} customized)\` : "");
                btn.onclick = () => {
                    selectedGlobalSectionId = sec.id;
                    renderGlobalTab();
                };
                subTabsEl.appendChild(btn);
            });

            const activeSec = sections.find(s => s.id === selectedGlobalSectionId) || sections[0];
            const sectionData = getNestedConfigValue(appState.appConfig, activeSec.configPath) || {};

            let fieldsHtml = "";
            activeSec.fields.forEach(field => {
                const hasOverride = sectionData[field.key] !== undefined;
                const rawVal = hasOverride ? sectionData[field.key] : field.defaultValue;
                const displayVal = rawVal === null || rawVal === undefined ? "" : String(rawVal);

                let controlHtml = "";
                if (field.type === "select" && Array.isArray(field.options)) {
                    const optionsHtml = field.options.map(opt => {
                        const isSelected = String(rawVal) === String(opt.value);
                        return \`<option value="\${escapeHtml(opt.value)}" \${isSelected ? "selected" : ""}>\${escapeHtml(opt.label)}</option>\`;
                    }).join("");
                    controlHtml = \`
                        <select onchange="updateGlobalField('\${activeSec.id}', '\${field.key}', this.value)">
                            \${optionsHtml}
                        </select>
                    \`;
                } else {
                    controlHtml = \`
                        <input
                            type="text"
                            value="\${escapeHtml(displayVal)}"
                            placeholder="\${escapeHtml(field.placeholder || '')}"
                            oninput="updateGlobalField('\${activeSec.id}', '\${field.key}', this.value)"
                        />
                    \`;
                }

                fieldsHtml += \`
                    <div class="form-field">
                        <label>
                            <span>
                                <code>\${escapeHtml(field.label)}</code>
                                \${hasOverride ? '<span class="badge badge-override" style="margin-left:6px;">Customized</span>' : ''}
                            </span>
                            \${hasOverride ? \`<button type="button" class="reset-link" onclick="resetGlobalField('\${activeSec.id}', '\${field.key}')">Reset to default</button>\` : ''}
                        </label>
                        \${controlHtml}
                        <div class="help-text">
                            Default: <code>\${field.defaultValue === null ? "null" : escapeHtml(field.defaultValue ?? "auto")}</code>
                            \${field.helpText ? " — " + escapeHtml(field.helpText) : ""}
                        </div>
                    </div>
                \`;
            });

            containerEl.innerHTML = \`
                <div class="card">
                    <div class="card-header">
                        <div>
                            <h3>\${escapeHtml(activeSec.title)}</h3>
                            <p>\${escapeHtml(activeSec.description)}</p>
                        </div>
                        <button class="btn btn-sm" onclick="resetAllSectionFields('\${activeSec.id}')">Reset Section to Defaults</button>
                    </div>
                    <div class="form-grid">
                        \${fieldsHtml}
                    </div>
                </div>
            \`;
        }

        function updateGlobalField(sectionId, fieldKey, rawValue) {
            const sec = appState.schema.globalSections.find(s => s.id === sectionId);
            if (!sec) return;
            const field = sec.fields.find(f => f.key === fieldKey);
            if (!field) return;

            let normalizedValue = rawValue;

            if (sec.id === "project" && (fieldKey === "buildBeforeUpload" || fieldKey === "saveObjectsToProject")) {
                if (rawValue === "true") normalizedValue = true;
                else if (rawValue === "false") normalizedValue = false;
                else normalizedValue = "auto";
            } else if (field.type === "nullable_text" && rawValue.trim() === "") {
                normalizedValue = null;
            } else if (field.type === "text" && rawValue.trim() === "" && field.defaultValue === undefined) {
                setNestedConfigValue(appState.appConfig, sec.configPath, fieldKey, undefined);
                markDirty(true);
                return;
            }

            if (normalizedValue === field.defaultValue) {
                setNestedConfigValue(appState.appConfig, sec.configPath, fieldKey, undefined);
            } else {
                setNestedConfigValue(appState.appConfig, sec.configPath, fieldKey, normalizedValue);
            }

            markDirty(true);
            if (field.type === "select") {
                renderGlobalTab();
            }
        }

        function resetGlobalField(sectionId, fieldKey) {
            const sec = appState.schema.globalSections.find(s => s.id === sectionId);
            if (!sec) return;
            setNestedConfigValue(appState.appConfig, sec.configPath, fieldKey, undefined);
            markDirty(true);
            renderGlobalTab();
        }

        function resetAllSectionFields(sectionId) {
            const sec = appState.schema.globalSections.find(s => s.id === sectionId);
            if (!sec) return;
            sec.fields.forEach(f => {
                setNestedConfigValue(appState.appConfig, sec.configPath, f.key, undefined);
            });
            markDirty(true);
            renderGlobalTab();
        }

        async function saveAllSettings() {
            const saveBtn = document.getElementById("saveBtn");
            saveBtn.disabled = true;
            saveBtn.textContent = "Saving...";
            hideBanner();

            try {
                const payload = {
                    activeEnvironment: appState.activeEnvironment,
                    activeProfile: appState.activeProfile || DEFAULT_PROFILE_NAME,
                    environments: appState.environments,
                    appConfig: appState.appConfig,
                    renamedEnvironments: pendingRenames
                };

                const res = await fetch("/api/settings?token=" + encodeURIComponent(SESSION_TOKEN), {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload)
                });

                const data = await res.json();
                if (!res.ok || !data.success) {
                    throw new Error(data.error || ("HTTP " + res.status));
                }

                if (data.configVersion) {
                    lastConfigVersion = data.configVersion;
                }
                pendingRenames = [];
                markDirty(false);
                if (selectedEnvName) {
                    void refreshDbStatus(selectedEnvName);
                }
                showBanner(
                    "<strong>Settings saved to " + escapeHtml(appState.configDir) + "!</strong> " +
                    "The MCP server has notified your AI client that available tools may have changed. " +
                    "<em>Note: If your client/harness does not immediately reflect added or removed tools, toggle the NetSuite MCP server off and on again.</em>",
                    "success"
                );
            } catch (err) {
                showBanner("Failed to save settings: " + escapeHtml(err.message), "error");
            } finally {
                saveBtn.disabled = false;
                saveBtn.textContent = "Save Changes";
            }
        }

        window.addEventListener("beforeunload", (e) => {
            if (isDirty) {
                e.preventDefault();
                e.returnValue = "";
            }
        });

        let lastServerPid = null;
        let eventSource = null;

        function handleIncomingConfigUpdate(data) {
            if (!data || !data.configVersion) return;
            if (lastConfigVersion && data.configVersion === lastConfigVersion) {
                return;
            }
            lastConfigVersion = data.configVersion;

            if (!isDirty) {
                void loadSettings(true);
            } else {
                let changed = false;
                if (data.activeEnvironment !== undefined && data.activeEnvironment !== appState.activeEnvironment) {
                    appState.activeEnvironment = data.activeEnvironment;
                    changed = true;
                }
                if (data.activeProfile !== undefined && data.activeProfile !== appState.activeProfile) {
                    appState.activeProfile = data.activeProfile;
                    changed = true;
                }
                if (changed) {
                    renderEnvSidebar();
                    renderEnvEditor();
                }
            }
        }

        function connectServerEvents() {
            if (eventSource) {
                try {
                    eventSource.close();
                } catch {}
            }
            try {
                eventSource = new EventSource("/api/events?token=" + encodeURIComponent(SESSION_TOKEN));
                eventSource.onmessage = (evt) => {
                    try {
                        const data = JSON.parse(evt.data);
                        const pill = document.getElementById("connPill");
                        const text = document.getElementById("connPillText");
                        if (pill && text) {
                            pill.classList.remove("offline");
                            text.textContent = "Connected";
                        }
                        if (data.pid) {
                            if (lastServerPid !== null && data.pid !== lastServerPid && !isDirty) {
                                lastServerPid = data.pid;
                                void loadSettings(true);
                                return;
                            }
                            lastServerPid = data.pid;
                        }
                        if (data.type === "config-changed" || data.type === "connected") {
                            handleIncomingConfigUpdate(data);
                        }
                    } catch {}
                };
                eventSource.onerror = () => {
                    const pill = document.getElementById("connPill");
                    const text = document.getElementById("connPillText");
                    if (pill && text) {
                        pill.classList.add("offline");
                        text.textContent = "Server Offline (waiting for MCP...)";
                    }
                };
            } catch {}
        }

        async function checkServerHeartbeat() {
            const pill = document.getElementById("connPill");
            const text = document.getElementById("connPillText");
            try {
                const res = await fetch("/api/ping?token=" + encodeURIComponent(SESSION_TOKEN));
                if (!res.ok) throw new Error("HTTP " + res.status);
                const data = await res.json();
                if (pill && text) {
                    pill.classList.remove("offline");
                    text.textContent = "Connected";
                }
                if (lastServerPid !== null && data.pid && data.pid !== lastServerPid && !isDirty) {
                    lastServerPid = data.pid;
                    void loadSettings(true);
                    return;
                } else if (data.pid) {
                    lastServerPid = data.pid;
                }
                handleIncomingConfigUpdate(data);
            } catch {
                if (pill && text) {
                    pill.classList.add("offline");
                    text.textContent = "Server Offline (waiting for MCP...)";
                }
            }
        }

        connectServerEvents();
        setInterval(checkServerHeartbeat, 10000);
        void checkServerHeartbeat();

        loadSettings();
    </script>
</body>
</html>`;
};
