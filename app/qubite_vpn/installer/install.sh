#!/bin/bash
# Qubite VPN — Linux installer
# Usage: curl -fsSL https://raw.githubusercontent.com/kirillkuz1122/qubite/main/app/qubite_vpn/installer/install.sh | sudo bash
set -e

REPO="https://raw.githubusercontent.com/kirillkuz1122/qubite/main/app/qubite_vpn"
TMP_DIR=$(mktemp -d)
trap "rm -rf $TMP_DIR" EXIT

echo "=== Qubite VPN Installer ==="
echo ""

# ── Detect distro family ──
DISTRO="unknown"
if [ -f /etc/os-release ]; then
    . /etc/os-release
    case "$ID $ID_LIKE" in
        *arch*)   DISTRO="arch" ;;
        *debian*) DISTRO="debian" ;;
        *ubuntu*) DISTRO="debian" ;;
        *fedora*) DISTRO="fedora" ;;
        *rhel*)   DISTRO="fedora" ;;
        *suse*)   DISTRO="suse" ;;
    esac
fi
echo "    Detected: $DISTRO ($PRETTY_NAME)"
echo ""

# ── Install sing-box if missing ──
if ! command -v sing-box >/dev/null 2>&1; then
    echo "[0/4] sing-box not found, installing..."
    case "$DISTRO" in
        arch)
            pacman -S --noconfirm sing-box 2>/dev/null \
                || echo "    [!] Not in repos. Install manually: yay -S sing-box-bin"
            ;;
        debian)
            echo "    Install sing-box: https://sing-box.sagernet.org/installation/package-manager/"
            ;;
        *)
            echo "    Install sing-box: https://github.com/SagerNet/sing-box/releases"
            ;;
    esac
    echo ""
fi

# ── Download app bundle ──
echo "[1/4] Downloading Qubite VPN..."
DEB_URL="$REPO/installer/linux/qubite-vpn_1.0.0_amd64.deb"
curl -fsSL "$DEB_URL" -o "$TMP_DIR/qubite-vpn.deb"

# ── Install ──
# For Debian/Ubuntu: use dpkg+apt normally
# For everything else: extract .deb as archive and copy files manually
if [ "$DISTRO" = "debian" ] && command -v apt-get >/dev/null 2>&1; then
    echo "[2/4] Installing .deb package..."
    dpkg -i "$TMP_DIR/qubite-vpn.deb" || apt-get install -f -y
    echo "[3/4] Package installed."
else
    echo "[2/4] Extracting and installing to /opt/qubite-vpn/..."
    # .deb is just an ar archive — extract data.tar
    cd "$TMP_DIR"
    ar x qubite-vpn.deb 2>/dev/null || true
    # data.tar may be .xz, .zst, .gz or plain
    DATA_TAR=$(ls data.tar* 2>/dev/null | head -1)
    if [ -z "$DATA_TAR" ]; then
        echo "    ERROR: Failed to extract .deb"
        exit 1
    fi
    mkdir -p extracted
    tar xf "$DATA_TAR" -C extracted

    # Copy app files
    rm -rf /opt/qubite-vpn
    cp -r extracted/opt/qubite-vpn /opt/qubite-vpn
    chmod 755 /opt/qubite-vpn/qubite_vpn
    find /opt/qubite-vpn/lib -name "*.so" -exec chmod 644 {} \; 2>/dev/null || true

    echo "[3/4] Setting up desktop integration..."

    # Symlink in PATH
    ln -sf /opt/qubite-vpn/qubite_vpn /usr/bin/qubite-vpn

    # Desktop entry (shows in app menu)
    cat > /usr/share/applications/qubite-vpn.desktop <<'DESKTOP'
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
DESKTOP

    # Icon
    mkdir -p /usr/share/icons/hicolor/192x192/apps
    if [ -f extracted/usr/share/icons/hicolor/192x192/apps/qubite-vpn.png ]; then
        cp extracted/usr/share/icons/hicolor/192x192/apps/qubite-vpn.png \
           /usr/share/icons/hicolor/192x192/apps/qubite-vpn.png
    else
        curl -fsSL "$REPO/android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png" \
            -o /usr/share/icons/hicolor/192x192/apps/qubite-vpn.png 2>/dev/null || true
    fi

    # Update caches
    gtk-update-icon-cache -f /usr/share/icons/hicolor/ 2>/dev/null || true
    update-desktop-database /usr/share/applications/ 2>/dev/null || true
fi

# ── Set TUN capability on sing-box ──
echo "[4/4] Configuring permissions..."
SINGBOX=$(command -v sing-box 2>/dev/null || true)
if [ -n "$SINGBOX" ]; then
    setcap cap_net_admin,cap_net_bind_service+ep "$SINGBOX" 2>/dev/null || true
    echo "    sing-box TUN permissions set ($SINGBOX)"
else
    echo "    [!] sing-box not found — install it for VPN to work"
    case "$DISTRO" in
        arch)   echo "    Run: sudo pacman -S sing-box  OR  yay -S sing-box-bin" ;;
        debian) echo "    See: https://sing-box.sagernet.org/installation/package-manager/" ;;
        *)      echo "    See: https://github.com/SagerNet/sing-box/releases" ;;
    esac
fi

echo ""
echo "=== Qubite VPN installed! ==="
echo "Launch: qubite-vpn  (or find 'Qubite VPN' in your app menu)"
