const { Gtk, Gio, GLib } = imports.gi;
const ExtensionUtils = imports.misc.extensionUtils;

function init() {
    // nothing needed
}

function buildPrefsWidget() {
    let settings = ExtensionUtils.getSettings(
        'org.gnome.shell.extensions.claude-usage'
    );

    let grid = new Gtk.Grid({
        margin_top: 24,
        margin_bottom: 24,
        margin_start: 24,
        margin_end: 24,
        column_spacing: 16,
        row_spacing: 12,
        halign: Gtk.Align.CENTER,
    });

    // Title
    let titleLabel = new Gtk.Label({
        label: '<b>Claude Usage Monitor Settings</b>',
        use_markup: true,
        halign: Gtk.Align.START,
    });
    grid.attach(titleLabel, 0, 0, 2, 1);

    // Refresh interval
    let intervalLabel = new Gtk.Label({
        label: 'Refresh Interval (seconds):',
        halign: Gtk.Align.END,
    });
    let intervalSpin = new Gtk.SpinButton({
        adjustment: new Gtk.Adjustment({
            lower: 60,
            upper: 3600,
            step_increment: 60,
            value: settings.get_int('refresh-interval'),
        }),
    });
    intervalSpin.connect('value-changed', () => {
        settings.set_int('refresh-interval', intervalSpin.get_value_as_int());
    });

    grid.attach(intervalLabel, 0, 1, 1, 1);
    grid.attach(intervalSpin, 1, 1, 1, 1);

    // Auth status + login button
    let authBox = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
        spacing: 12,
        margin_top: 16,
        halign: Gtk.Align.START,
    });

    let authStatusLabel = new Gtk.Label({
        label: '',
        use_markup: true,
        halign: Gtk.Align.START,
    });

    let loginButton = new Gtk.Button({
        label: 'Log in with Claude Code',
    });
    loginButton.connect('clicked', () => {
        try {
            GLib.spawn_command_line_async(
                'gnome-terminal -- bash -c "claude; echo; echo Press Enter to close...; read"'
            );
        } catch (e) {
            // Fallback to other terminals
            try {
                GLib.spawn_command_line_async(
                    'x-terminal-emulator -e bash -c "claude; echo; echo Press Enter to close...; read"'
                );
            } catch (e2) {
                log('Claude Usage Monitor: Could not open terminal: ' + e2.message);
            }
        }
    });

    // Check auth status and update label
    let credsPath = GLib.get_home_dir() + '/.claude/.credentials.json';

    function checkAuth() {
        try {
            let file = Gio.File.new_for_path(credsPath);
            if (file.query_exists(null)) {
                let [ok, contents] = file.load_contents(null);
                if (ok) {
                    let creds = JSON.parse(imports.byteArray.toString(contents));
                    if (creds.claudeAiOauth && creds.claudeAiOauth.accessToken) {
                        let expiry = creds.claudeAiOauth.expiresAt;
                        if (!expiry || Date.now() <= expiry) {
                            return true;
                        }
                    }
                }
            }
        } catch (e) {
            // ignore
        }
        return false;
    }

    function updateAuthLabel() {
        if (checkAuth()) {
            authStatusLabel.set_markup('<small><span foreground="#73c991">Logged in</span></small>');
        } else {
            authStatusLabel.set_markup('<small><span foreground="#e8a838">Not logged in</span></small>');
        }
    }

    updateAuthLabel();

    // Watch credentials file for changes
    let credsFile = Gio.File.new_for_path(credsPath);
    let credsDir = Gio.File.new_for_path(GLib.get_home_dir() + '/.claude');
    let monitor = credsDir.monitor_directory(Gio.FileMonitorFlags.NONE, null);
    monitor.connect('changed', (m, file, otherFile, eventType) => {
        if (file.get_basename() === '.credentials.json') {
            updateAuthLabel();
        }
    });

    authBox.append(loginButton);
    authBox.append(authStatusLabel);
    grid.attach(authBox, 0, 2, 2, 1);

    // Help text
    let helpLabel = new Gtk.Label({
        label: '<small>Each refresh uses ~9 tokens via Haiku (negligible).</small>',
        use_markup: true,
        halign: Gtk.Align.START,
        margin_top: 8,
    });
    grid.attach(helpLabel, 0, 3, 2, 1);

    // Keep monitor alive as long as the widget exists
    grid._credentialMonitor = monitor;

    return grid;
}
