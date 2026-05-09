#!/bin/bash
# Quick installer for Qubite VPN (no .deb needed)
# Copies bundle to /opt and registers the desktop entry
set -e

APP_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
BUNDLE_DIR="$APP_DIR/build/linux/x64/release/bundle"

if [ ! -f "$BUNDLE_DIR/qubite_vpn" ]; then
    echo "ERROR: Bundle not found. Build first:"
    echo "  flutter build linux --release --dart-define=VPN_APP_TOKEN=..."
    exit 1
fi

echo "Installing Qubite VPN..."

# Copy app
sudo rm -rf /opt/qubite-vpn
sudo mkdir -p /opt/qubite-vpn
sudo cp -r "$BUNDLE_DIR"/* /opt/qubite-vpn/
sudo chmod 755 /opt/qubite-vpn/qubite_vpn

# Symlink
sudo ln -sf /opt/qubite-vpn/qubite_vpn /usr/bin/qubite-vpn

# Desktop entry
sudo cp "$APP_DIR/installer/linux/qubite-vpn.desktop" /usr/share/applications/

# Icon
sudo mkdir -p /usr/share/icons/hicolor/192x192/apps
sudo cp "$APP_DIR/android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png" \
    /usr/share/icons/hicolor/192x192/apps/qubite-vpn.png

# Update caches
sudo gtk-update-icon-cache -f /usr/share/icons/hicolor/ 2>/dev/null || true
sudo update-desktop-database /usr/share/applications/ 2>/dev/null || true

# Set TUN capability on sing-box
SINGBOX=$(command -v sing-box 2>/dev/null || true)
if [ -n "$SINGBOX" ]; then
    sudo setcap cap_net_admin,cap_net_bind_service+ep "$SINGBOX" 2>/dev/null || true
    echo "Set TUN capabilities on $SINGBOX"
fi

echo ""
echo "Done! Qubite VPN installed."
echo "Launch from app menu or run: qubite-vpn"
