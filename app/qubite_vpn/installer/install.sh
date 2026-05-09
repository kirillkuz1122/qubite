#!/bin/bash
# Qubite VPN — Linux installer
# Usage: curl -fsSL https://raw.githubusercontent.com/kirillkuz1122/qubite/main/app/qubite_vpn/installer/install.sh | sudo bash
set -e

REPO="https://raw.githubusercontent.com/kirillkuz1122/qubite/main/app/qubite_vpn"
TMP_DIR=$(mktemp -d)
trap "rm -rf $TMP_DIR" EXIT

echo "=== Qubite VPN Installer ==="
echo ""

# Detect package manager
if command -v dpkg >/dev/null 2>&1; then
    PKG_TYPE="deb"
elif command -v rpm >/dev/null 2>&1; then
    PKG_TYPE="rpm"
else
    PKG_TYPE="manual"
fi

# Check sing-box
if ! command -v sing-box >/dev/null 2>&1; then
    echo "[!] sing-box not found. Installing..."
    if command -v pacman >/dev/null 2>&1; then
        pacman -S --noconfirm sing-box || echo "    Try: yay -S sing-box-bin"
    elif command -v apt >/dev/null 2>&1; then
        echo "    Install sing-box: https://sing-box.sagernet.org/installation/package-manager/"
        echo "    Or: bash <(curl -fsSL https://sing-box.sagernet.org/deb-install.sh)"
    elif command -v dnf >/dev/null 2>&1; then
        echo "    Install sing-box: https://sing-box.sagernet.org/installation/package-manager/"
    fi
    echo ""
fi

echo "[1/4] Downloading Qubite VPN..."

# Download the deb package
DEB_URL="$REPO/installer/linux/qubite-vpn_1.0.0_amd64.deb"
curl -fsSL "$DEB_URL" -o "$TMP_DIR/qubite-vpn.deb" 2>/dev/null && HAVE_DEB=1 || HAVE_DEB=0

if [ "$HAVE_DEB" = "1" ] && [ "$PKG_TYPE" = "deb" ]; then
    echo "[2/4] Installing .deb package..."
    dpkg -i "$TMP_DIR/qubite-vpn.deb" || apt-get install -f -y
    echo "[3/4] Package installed."
else
    # Manual install: download bundle files
    echo "[2/4] Manual installation to /opt/qubite-vpn/..."
    rm -rf /opt/qubite-vpn
    mkdir -p /opt/qubite-vpn

    if [ "$HAVE_DEB" = "1" ]; then
        # Extract from .deb
        dpkg-deb -x "$TMP_DIR/qubite-vpn.deb" "$TMP_DIR/extracted"
        cp -r "$TMP_DIR/extracted/opt/qubite-vpn/"* /opt/qubite-vpn/
    else
        echo "    ERROR: Could not download package."
        echo "    Clone the repo and run installer/linux/install.sh locally."
        exit 1
    fi

    echo "[3/4] Setting up desktop integration..."
    # Symlink
    ln -sf /opt/qubite-vpn/qubite_vpn /usr/bin/qubite-vpn

    # Desktop entry
    cat > /usr/share/applications/qubite-vpn.desktop <<'EOF'
[Desktop Entry]
Name=Qubite VPN
Comment=Secure VPN client
Exec=/opt/qubite-vpn/qubite_vpn
Icon=qubite-vpn
Terminal=false
Type=Application
Categories=Network;VPN;Security;
Keywords=vpn;proxy;privacy;
StartupWMClass=qubite_vpn
EOF

    # Icon
    mkdir -p /usr/share/icons/hicolor/192x192/apps
    curl -fsSL "$REPO/android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png" \
        -o /usr/share/icons/hicolor/192x192/apps/qubite-vpn.png 2>/dev/null || true

    # Update caches
    gtk-update-icon-cache -f /usr/share/icons/hicolor/ 2>/dev/null || true
    update-desktop-database /usr/share/applications/ 2>/dev/null || true
fi

# Set TUN capability on sing-box
echo "[4/4] Configuring permissions..."
SINGBOX=$(command -v sing-box 2>/dev/null || true)
if [ -n "$SINGBOX" ]; then
    setcap cap_net_admin,cap_net_bind_service+ep "$SINGBOX" 2>/dev/null || true
    echo "    sing-box TUN permissions set"
else
    echo "    [!] sing-box not found — install it for VPN to work"
fi

chmod 755 /opt/qubite-vpn/qubite_vpn

echo ""
echo "=== Qubite VPN installed! ==="
echo "Launch: qubite-vpn  (or find 'Qubite VPN' in your app menu)"
