const { St, GLib, Gio, GObject, Clutter } = imports.gi;
imports.gi.versions.Soup = '2.4';
const Soup = imports.gi.Soup;
const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const ExtensionUtils = imports.misc.extensionUtils;

const API_URL = 'https://api.anthropic.com/v1/messages';
const TOKEN_URL = 'https://console.anthropic.com/v1/oauth/token';
const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';

const ClaudeIndicator = GObject.registerClass(
class ClaudeIndicator extends PanelMenu.Button {
    _init() {
        super._init(0.0, 'Claude Usage Monitor');

        // Runtime paths
        let home = GLib.get_home_dir();
        this._credentialsPath = home + '/.claude/.credentials.json';
        this._statsCachePath = home + '/.claude/stats-cache.json';

        this._settings = ExtensionUtils.getSettings(
            'org.gnome.shell.extensions.claude-usage'
        );

        // Panel label
        this._label = new St.Label({
            text: 'Claude: ...',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'claude-usage-label',
        });
        this.add_child(this._label);

        // Build popup menu
        this._buildMenu();

        // HTTP session
        this._session = new Soup.SessionAsync();

        // State
        this._fiveHourUtil = null;
        this._fiveHourReset = null;
        this._sevenDayUtil = null;
        this._sevenDayReset = null;
        this._overageUtil = null;
        this._status = null;
        this._subscriptionType = null;
        this._lastRefresh = null;
        this._refreshing = false;
        this._timer = null;
        this._resetTimer = null;

        // Watch for settings changes
        this._settingsChangedId = this._settings.connect('changed', () => {
            this._restartTimer();
        });

        // Start
        this._startTimer();
        this._refresh();
    }

    _buildMenu() {
        // Header
        this._headerItem = new PopupMenu.PopupMenuItem('Claude Usage', {
            reactive: false,
            style_class: 'claude-menu-heading',
        });
        this.menu.addMenuItem(this._headerItem);

        // Plan type
        this._planItem = new PopupMenu.PopupMenuItem(
            '  Plan: --', { reactive: false, style_class: 'claude-menu-status' }
        );
        this.menu.addMenuItem(this._planItem);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // 5-hour window
        this._fiveHourHeaderItem = new PopupMenu.PopupMenuItem(
            '5-Hour Window', { reactive: false, style_class: 'claude-menu-heading' }
        );
        this._fiveHourBarItem = new PopupMenu.PopupMenuItem(
            '  Usage: --', { reactive: false, style_class: 'claude-menu-item' }
        );
        this._fiveHourResetItem = new PopupMenu.PopupMenuItem(
            '  Resets in: --', { reactive: false, style_class: 'claude-menu-item' }
        );
        this.menu.addMenuItem(this._fiveHourHeaderItem);
        this.menu.addMenuItem(this._fiveHourBarItem);
        this.menu.addMenuItem(this._fiveHourResetItem);

        this._rateLimitSep1 = new PopupMenu.PopupSeparatorMenuItem();
        this.menu.addMenuItem(this._rateLimitSep1);

        // 7-day window
        this._sevenDayHeaderItem = new PopupMenu.PopupMenuItem(
            '7-Day Window', { reactive: false, style_class: 'claude-menu-heading' }
        );
        this._sevenDayBarItem = new PopupMenu.PopupMenuItem(
            '  Usage: --', { reactive: false, style_class: 'claude-menu-item' }
        );
        this._sevenDayResetItem = new PopupMenu.PopupMenuItem(
            '  Resets in: --', { reactive: false, style_class: 'claude-menu-item' }
        );
        this.menu.addMenuItem(this._sevenDayHeaderItem);
        this.menu.addMenuItem(this._sevenDayBarItem);
        this.menu.addMenuItem(this._sevenDayResetItem);

        this._rateLimitSep2 = new PopupMenu.PopupSeparatorMenuItem();
        this.menu.addMenuItem(this._rateLimitSep2);

        // Status line
        this._statusItem = new PopupMenu.PopupMenuItem(
            'Status: --', { reactive: false, style_class: 'claude-menu-item' }
        );
        this.menu.addMenuItem(this._statusItem);

        // Last refresh
        this._lastCheckItem = new PopupMenu.PopupMenuItem(
            'Last check: never', { reactive: false, style_class: 'claude-menu-status' }
        );
        this.menu.addMenuItem(this._lastCheckItem);

        // Collect rate limit items for visibility toggling
        this._rateLimitItems = [
            this._fiveHourHeaderItem, this._fiveHourBarItem, this._fiveHourResetItem,
            this._rateLimitSep1,
            this._sevenDayHeaderItem, this._sevenDayBarItem, this._sevenDayResetItem,
            this._rateLimitSep2,
            this._statusItem,
        ];

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Today's activity
        this._todayHeaderItem = new PopupMenu.PopupMenuItem(
            "Today's Activity", { reactive: false, style_class: 'claude-menu-heading' }
        );
        this._todayMessagesItem = new PopupMenu.PopupMenuItem(
            '  Messages: --', { reactive: false, style_class: 'claude-menu-item' }
        );
        this._todaySessionsItem = new PopupMenu.PopupMenuItem(
            '  Sessions: --', { reactive: false, style_class: 'claude-menu-item' }
        );
        this._todayToolCallsItem = new PopupMenu.PopupMenuItem(
            '  Tool calls: --', { reactive: false, style_class: 'claude-menu-item' }
        );
        this._todayTokensItem = new PopupMenu.PopupMenuItem(
            '  Tokens: --', { reactive: false, style_class: 'claude-menu-item' }
        );
        this.menu.addMenuItem(this._todayHeaderItem);
        this.menu.addMenuItem(this._todayMessagesItem);
        this.menu.addMenuItem(this._todaySessionsItem);
        this.menu.addMenuItem(this._todayToolCallsItem);
        this.menu.addMenuItem(this._todayTokensItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Lifetime stats
        this._lifetimeHeaderItem = new PopupMenu.PopupMenuItem(
            'Lifetime Stats', { reactive: false, style_class: 'claude-menu-heading' }
        );
        this._lifetimeSessionsItem = new PopupMenu.PopupMenuItem(
            '  Sessions: --', { reactive: false, style_class: 'claude-menu-item' }
        );
        this._lifetimeMessagesItem = new PopupMenu.PopupMenuItem(
            '  Messages: --', { reactive: false, style_class: 'claude-menu-item' }
        );
        this._lifetimeSinceItem = new PopupMenu.PopupMenuItem(
            '  Since: --', { reactive: false, style_class: 'claude-menu-item' }
        );
        this.menu.addMenuItem(this._lifetimeHeaderItem);
        this.menu.addMenuItem(this._lifetimeSessionsItem);
        this.menu.addMenuItem(this._lifetimeMessagesItem);
        this.menu.addMenuItem(this._lifetimeSinceItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Refresh button
        let refreshItem = new PopupMenu.PopupMenuItem('Refresh Now');
        refreshItem.connect('activate', () => {
            this._refresh();
        });
        this.menu.addMenuItem(refreshItem);

        // Settings button
        let settingsItem = new PopupMenu.PopupMenuItem('Settings...');
        settingsItem.connect('activate', () => {
            ExtensionUtils.openPrefs();
        });
        this.menu.addMenuItem(settingsItem);
    }

    _startTimer() {
        if (this._timer) {
            GLib.source_remove(this._timer);
            this._timer = null;
        }

        let interval = this._settings.get_int('refresh-interval');
        this._timer = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            interval,
            () => {
                this._refresh();
                return GLib.SOURCE_CONTINUE;
            }
        );

        // Update the reset countdown every 30 seconds
        if (this._resetTimer) {
            GLib.source_remove(this._resetTimer);
        }
        this._resetTimer = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            30,
            () => {
                this._updateDisplay();
                return GLib.SOURCE_CONTINUE;
            }
        );
    }

    _restartTimer() {
        this._startTimer();
    }

    _readCredentials() {
        try {
            let file = Gio.File.new_for_path(this._credentialsPath);
            if (!file.query_exists(null)) return null;

            let [ok, contents] = file.load_contents(null);
            if (!ok) return null;

            let text = new TextDecoder().decode(contents);
            let creds = JSON.parse(text);

            if (!creds.claudeAiOauth || !creds.claudeAiOauth.accessToken)
                return null;

            // Store subscription info
            this._subscriptionType = creds.claudeAiOauth.subscriptionType || null;

            // Check if token is expired
            let expiry = creds.claudeAiOauth.expiresAt;
            if (expiry && Date.now() > expiry) {
                // Token expired — try refresh in background
                if (creds.claudeAiOauth.refreshToken && !this._refreshing) {
                    this._refreshToken(creds);
                }
                return null;
            }

            return creds.claudeAiOauth.accessToken;
        } catch (e) {
            return null;
        }
    }

    _refreshToken(creds) {
        this._refreshing = true;

        let message = Soup.Message.new('POST', TOKEN_URL);
        message.request_headers.append('content-type', 'application/json');

        let body = JSON.stringify({
            grant_type: 'refresh_token',
            refresh_token: creds.claudeAiOauth.refreshToken,
            client_id: CLIENT_ID,
        });

        message.set_request('application/json', Soup.MemoryUse.COPY, body);

        this._session.queue_message(message, (_session, msg) => {
            this._refreshing = false;

            if (msg.status_code !== 200) return;

            try {
                let resp = JSON.parse(msg.response_body.data);
                if (!resp.access_token) return;

                // Update credentials file
                creds.claudeAiOauth.accessToken = resp.access_token;
                if (resp.refresh_token)
                    creds.claudeAiOauth.refreshToken = resp.refresh_token;
                creds.claudeAiOauth.expiresAt =
                    Date.now() + (resp.expires_in || 3600) * 1000;

                let file = Gio.File.new_for_path(this._credentialsPath);
                file.replace_contents(
                    JSON.stringify(creds, null, 2),
                    null, false,
                    Gio.FileCreateFlags.REPLACE_DESTINATION,
                    null
                );

                // Retry the refresh cycle now that we have a valid token
                this._refresh();
            } catch (e) {
                // Refresh failed silently — user will see "Log in"
            }
        });
    }

    _readStatsCache() {
        try {
            let file = Gio.File.new_for_path(this._statsCachePath);
            if (!file.query_exists(null)) return null;

            let [ok, contents] = file.load_contents(null);
            if (!ok) return null;

            let text = new TextDecoder().decode(contents);
            return JSON.parse(text);
        } catch (e) {
            return null;
        }
    }

    _updateStatsDisplay() {
        let stats = this._readStatsCache();
        if (!stats) return;

        // Today's activity
        let today = new Date().toISOString().slice(0, 10);
        let todayActivity = (stats.dailyActivity || []).find(d => d.date === today);
        let todayTokens = (stats.dailyModelTokens || []).find(d => d.date === today);

        if (todayActivity) {
            this._todayMessagesItem.label.set_text(
                `  Messages: ${todayActivity.messageCount.toLocaleString()}`
            );
            this._todaySessionsItem.label.set_text(
                `  Sessions: ${todayActivity.sessionCount}`
            );
            this._todayToolCallsItem.label.set_text(
                `  Tool calls: ${todayActivity.toolCallCount.toLocaleString()}`
            );
        } else {
            this._todayMessagesItem.label.set_text('  Messages: 0');
            this._todaySessionsItem.label.set_text('  Sessions: 0');
            this._todayToolCallsItem.label.set_text('  Tool calls: 0');
        }

        if (todayTokens && todayTokens.tokensByModel) {
            let total = Object.values(todayTokens.tokensByModel)
                .reduce((sum, n) => sum + n, 0);
            this._todayTokensItem.label.set_text(
                `  Tokens: ${total.toLocaleString()}`
            );
        } else {
            this._todayTokensItem.label.set_text('  Tokens: 0');
        }

        // Lifetime stats
        if (stats.totalSessions !== undefined) {
            this._lifetimeSessionsItem.label.set_text(
                `  Sessions: ${stats.totalSessions.toLocaleString()}`
            );
        }
        if (stats.totalMessages !== undefined) {
            this._lifetimeMessagesItem.label.set_text(
                `  Messages: ${stats.totalMessages.toLocaleString()}`
            );
        }
        if (stats.firstSessionDate) {
            let d = new Date(stats.firstSessionDate);
            let dateStr = d.toLocaleDateString('en-US', {
                month: 'short', day: 'numeric', year: 'numeric'
            });
            this._lifetimeSinceItem.label.set_text(`  Since: ${dateStr}`);
        }
    }

    _setRateLimitVisible(visible) {
        for (let item of this._rateLimitItems) {
            if (visible)
                item.actor.show();
            else
                item.actor.hide();
        }
    }

    _isMaxPlan() {
        return this._subscriptionType && this._subscriptionType.startsWith('max');
    }

    _formatPlanName(type) {
        if (!type) return 'Unknown';
        if (type.startsWith('max')) return 'Max';
        if (type === 'pro') return 'Pro';
        if (type === 'free') return 'Free';
        // Capitalize first letter for anything else
        return type.charAt(0).toUpperCase() + type.slice(1);
    }

    _refresh() {
        // Always update stats from local cache
        this._updateStatsDisplay();

        let token = this._readCredentials();

        if (!token) {
            this._label.set_text('Claude: Log in');
            this._label.style_class = 'claude-usage-label-warning';
            this._statusItem.label.set_text(
                "Run 'claude' in a terminal to log in"
            );
            this._planItem.label.set_text('  Plan: --');
            this._setRateLimitVisible(false);
            return;
        }

        // Update plan display
        let planName = this._formatPlanName(this._subscriptionType);
        this._planItem.label.set_text(`  Plan: ${planName}`);

        if (!this._isMaxPlan()) {
            // Non-Max plans: show stats only, no rate limit API call
            this._setRateLimitVisible(false);
            this._label.set_text(`Claude: ${planName}`);
            this._label.style_class = 'claude-usage-label';
            this._lastRefresh = new Date();
            this._lastCheckItem.label.set_text(
                'Last check: ' + this._lastRefresh.toLocaleTimeString()
            );
            return;
        }

        this._setRateLimitVisible(true);

        // Tiny API call to get rate limit headers (Max only)
        let message = Soup.Message.new('POST', API_URL);

        message.request_headers.append('Authorization', 'Bearer ' + token);
        message.request_headers.append('anthropic-version', '2023-06-01');
        message.request_headers.append('anthropic-beta', 'oauth-2025-04-20');
        message.request_headers.append('content-type', 'application/json');

        let body = JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 1,
            messages: [{ role: 'user', content: 'x' }],
        });

        message.set_request('application/json', Soup.MemoryUse.COPY, body);

        this._session.queue_message(message, (_session, msg) => {
            if (msg.status_code === 200) {
                this._parseRateLimits(msg);
                this._updateDisplay();
                this._lastRefresh = new Date();
                this._lastCheckItem.label.set_text(
                    'Last check: ' + this._lastRefresh.toLocaleTimeString()
                );
            } else if (msg.status_code === 401) {
                this._label.set_text('Claude: Log in');
                this._label.style_class = 'claude-usage-label-warning';
                this._statusItem.label.set_text(
                    "Token expired — run 'claude' in a terminal"
                );
            } else if (msg.status_code === 429) {
                // Rate limited — parse whatever headers we got
                this._parseRateLimits(msg);
                this._updateDisplay();
                this._statusItem.label.set_text('Status: Rate limited');
            } else {
                this._label.set_text('Claude: Error');
                this._label.style_class = 'claude-usage-label-warning';
                this._statusItem.label.set_text(
                    'HTTP ' + msg.status_code + ' — retrying next cycle'
                );
            }
        });
    }

    _parseRateLimits(msg) {
        let h = msg.response_headers;

        // Unified rate limit headers for Max subscribers
        let status = h.get_one('anthropic-ratelimit-unified-status');
        if (status) this._status = status;

        let fiveUtil = h.get_one('anthropic-ratelimit-unified-5h-utilization');
        let fiveReset = h.get_one('anthropic-ratelimit-unified-5h-reset');
        if (fiveUtil !== null) this._fiveHourUtil = parseFloat(fiveUtil);
        if (fiveReset !== null) this._fiveHourReset = parseInt(fiveReset, 10);

        let sevenUtil = h.get_one('anthropic-ratelimit-unified-7d-utilization');
        let sevenReset = h.get_one('anthropic-ratelimit-unified-7d-reset');
        if (sevenUtil !== null) this._sevenDayUtil = parseFloat(sevenUtil);
        if (sevenReset !== null) this._sevenDayReset = parseInt(sevenReset, 10);

        let overageUtil = h.get_one('anthropic-ratelimit-unified-overage-utilization');
        if (overageUtil !== null) this._overageUtil = parseFloat(overageUtil);
    }

    _updateDisplay() {
        if (this._fiveHourUtil === null) return;

        let fivePercent = Math.round(this._fiveHourUtil * 100);
        let sevenPercent = this._sevenDayUtil !== null
            ? Math.round(this._sevenDayUtil * 100) : null;

        // Panel text: show the more limiting window
        let resetTimestamp = this._fiveHourReset;
        let resetStr = this._formatResetTime(resetTimestamp);

        let panelText = `Claude: ${fivePercent}%`;
        if (resetStr) panelText += ` | ${resetStr}`;

        this._label.set_text(panelText);

        // Color based on 5h utilization (the tighter window)
        if (fivePercent >= 85) {
            this._label.style_class = 'claude-usage-label-critical';
        } else if (fivePercent >= 50) {
            this._label.style_class = 'claude-usage-label-warning';
        } else {
            this._label.style_class = 'claude-usage-label';
        }

        // Menu items
        this._fiveHourBarItem.label.set_text(
            `  Usage: ${fivePercent}%  ${this._makeBar(fivePercent)}`
        );
        this._fiveHourResetItem.label.set_text(
            `  Resets in: ${resetStr || 'unknown'}`
        );

        if (sevenPercent !== null) {
            this._sevenDayBarItem.label.set_text(
                `  Usage: ${sevenPercent}%  ${this._makeBar(sevenPercent)}`
            );
            this._sevenDayResetItem.label.set_text(
                `  Resets in: ${this._formatResetTime(this._sevenDayReset) || 'unknown'}`
            );
        }

        this._statusItem.label.set_text(
            `Status: ${this._status || 'unknown'}`
        );
    }

    _makeBar(percent) {
        let filled = Math.round(percent / 5);
        let empty = 20 - filled;
        return '\u2588'.repeat(filled) + '\u2591'.repeat(empty);
    }

    _formatResetTime(unixTimestamp) {
        if (!unixTimestamp) return null;

        let now = Math.floor(Date.now() / 1000);
        let diffSecs = unixTimestamp - now;

        if (diffSecs <= 0) return 'now';

        let hours = Math.floor(diffSecs / 3600);
        let minutes = Math.floor((diffSecs % 3600) / 60);

        if (hours > 24) {
            let days = Math.floor(hours / 24);
            hours = hours % 24;
            return `${days}d ${hours}h`;
        } else if (hours > 0) {
            return `${hours}h ${minutes}m`;
        } else {
            return `${minutes}m`;
        }
    }

    destroy() {
        if (this._timer) {
            GLib.source_remove(this._timer);
            this._timer = null;
        }
        if (this._resetTimer) {
            GLib.source_remove(this._resetTimer);
            this._resetTimer = null;
        }
        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = null;
        }
        if (this._session) {
            this._session.abort();
            this._session = null;
        }
        super.destroy();
    }
});

let _indicator = null;

function init() {
    // nothing needed
}

function enable() {
    _indicator = new ClaudeIndicator();
    Main.panel.addToStatusArea('claude-usage', _indicator);
}

function disable() {
    if (_indicator) {
        _indicator.destroy();
        _indicator = null;
    }
}
