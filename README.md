# Claude Usage Monitor - GNOME Shell Extension

A GNOME Shell extension that displays your Claude Max subscription usage and rate limits directly in the top panel.

![Dropdown menu with full usage details](images/dropdown.png)

## Features

- **Panel indicator** showing current 5-hour usage percentage and reset countdown
- **5-hour and 7-day rate limit windows** with progress bars and reset timers
- **Today's activity** — messages, sessions, tool calls, and tokens used today
- **Lifetime stats** — total sessions, messages, and account age
- **Color-coded warnings** — normal, warning (70%+), and critical (90%+) states
- **Login button** in settings to authenticate via Claude Code
- **Auto-refresh** on a configurable interval (default: 5 minutes)

## Requirements

- GNOME Shell 42, 43, or 44
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) installed and logged in
- An active Claude Max subscription

## Installation

### From source

```bash
git clone https://github.com/bitcoin-coder-bob/gnome-shell-extension-claude-usage.git
cd gnome-shell-extension-claude-usage
bash install.sh
```

Then restart GNOME Shell:
- **X11**: Press Alt+F2, type `r`, press Enter
- **Wayland**: Log out and back in

Enable the extension:
```bash
gnome-extensions enable claude-usage@gnome-extension
```

## Authentication

This extension uses Claude Code's OAuth credentials. No API keys needed.

1. Open the extension settings and click **Log in with Claude Code**
2. Or run `claude` in any terminal to authenticate
3. The extension reads your token from `~/.claude/.credentials.json` automatically

## How it works

- On each refresh, the extension makes a minimal API call (~9 tokens via Haiku) to read rate limit headers from the Anthropic API
- Daily activity and lifetime stats are read from Claude Code's local `~/.claude/stats-cache.json` — no API call needed
- The panel indicator updates the reset countdown every 30 seconds between full refreshes

## Configuration

Open settings via the dropdown menu or:
```bash
gnome-extensions prefs claude-usage@gnome-extension
```

- **Refresh Interval**: How often to check rate limits (60–3600 seconds, default 300)

## License

MIT
