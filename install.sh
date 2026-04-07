#!/bin/bash
set -e

EXT_UUID="claude-usage@bitcoin-coder-bob.github.io"
EXT_DIR="$HOME/.local/share/gnome-shell/extensions/$EXT_UUID"
SRC_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Installing Claude Usage Monitor extension..."

# Create extension directory
mkdir -p "$EXT_DIR/schemas"

# Copy files
cp "$SRC_DIR/metadata.json" "$EXT_DIR/"
cp "$SRC_DIR/extension.js" "$EXT_DIR/"
cp "$SRC_DIR/prefs.js" "$EXT_DIR/"
cp "$SRC_DIR/stylesheet.css" "$EXT_DIR/"
cp "$SRC_DIR/schemas/"*.xml "$EXT_DIR/schemas/"

# Compile schemas
echo "Compiling GSettings schemas..."
glib-compile-schemas "$EXT_DIR/schemas/"

echo ""
echo "Extension installed to: $EXT_DIR"
echo ""
echo "Next steps:"
echo "  1. Restart GNOME Shell: press Alt+F2, type 'r', press Enter"
echo "     (or log out and back in on Wayland)"
echo "  2. Enable the extension:"
echo "     gnome-extensions enable $EXT_UUID"
echo "  3. Authentication is handled by Claude Code."
echo "     Run 'claude' in a terminal to log in if needed."
echo ""
echo "Done!"
