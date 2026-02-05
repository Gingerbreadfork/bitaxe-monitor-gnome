#!/bin/bash

# Bitaxe Monitor GNOME Extension Installer

EXTENSION_UUID="bitaxe-monitor@gingerbreadfork.github.io"
INSTALL_DIR="$HOME/.local/share/gnome-shell/extensions/$EXTENSION_UUID"

echo "Installing Bitaxe Monitor GNOME Extension..."

# Create extension directory
mkdir -p "$INSTALL_DIR"

# Copy extension files
echo "Copying extension files..."
cp extension.js "$INSTALL_DIR/"
cp prefs.js "$INSTALL_DIR/"
cp metadata.json "$INSTALL_DIR/"
cp stylesheet.css "$INSTALL_DIR/"

# Copy schemas
echo "Copying schemas..."
mkdir -p "$INSTALL_DIR/schemas"
cp schemas/*.xml "$INSTALL_DIR/schemas/"

# Compile schemas
echo "Compiling schemas..."
glib-compile-schemas "$INSTALL_DIR/schemas/"

echo ""
echo "Installation complete!"
echo ""
echo "Next steps:"
echo "1. Restart GNOME Shell:"
echo "   - On X11: Press Alt+F2, type 'r', and press Enter"
echo "   - On Wayland: Log out and log back in"
echo ""
echo "2. Enable the extension:"
echo "   gnome-extensions enable $EXTENSION_UUID"
echo ""
echo "3. Configure the extension:"
echo "   gnome-extensions prefs $EXTENSION_UUID"
echo ""
