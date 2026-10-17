#!/bin/bash
# Build .deb package for Qubite VPN
# Usage: ./build-deb.sh [version]
#
# Prerequisites: flutter build linux --release must be done first
# The script packages the bundle from build/linux/x64/release/bundle/

set -e

VERSION="${1:-1.0.0}"
ARCH="amd64"
PKG_NAME="qubite-vpn"
APP_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
BUNDLE_DIR="$APP_DIR/build/linux/x64/release/bundle"
BUILD_DIR="$APP_DIR/installer/linux/_build"

if [ ! -f "$BUNDLE_DIR/qubite_vpn" ]; then
    echo "ERROR: Bundle not found at $BUNDLE_DIR"
    echo "Run: flutter build linux --release --dart-define=VPN_APP_TOKEN=..."
    exit 1
fi

# Clean previous build
rm -rf "$BUILD_DIR"

# Create deb structure
DEB_ROOT="$BUILD_DIR/${PKG_NAME}_${VERSION}_${ARCH}"
mkdir -p "$DEB_ROOT/DEBIAN"
mkdir -p "$DEB_ROOT/opt/qubite-vpn"
mkdir -p "$DEB_ROOT/usr/share/applications"
mkdir -p "$DEB_ROOT/usr/share/icons/hicolor/192x192/apps"
mkdir -p "$DEB_ROOT/usr/bin"

# Control file
cat > "$DEB_ROOT/DEBIAN/control" <<EOF
Package: $PKG_NAME
Version: $VERSION
Architecture: $ARCH
Maintainer: Qubite <support@qubite.ru>
Description: Qubite VPN - secure VPN client
 Fast and secure VPN client powered by sing-box.
 Supports NaiveProxy and VLESS+Reality protocols.
Depends: libgtk-3-0, sing-box
Section: net
Priority: optional
Homepage: https://qubiteapp.ru
EOF

# Post-install: set capabilities so TUN works without root
cat > "$DEB_ROOT/DEBIAN/postinst" <<'EOF'
#!/bin/bash
set -e
# Allow sing-box to create TUN interfaces without root
if command -v setcap >/dev/null 2>&1; then
    SINGBOX=$(command -v sing-box 2>/dev/null || true)
    if [ -n "$SINGBOX" ]; then
        setcap cap_net_admin,cap_net_bind_service+ep "$SINGBOX" 2>/dev/null || true
    fi
fi
# Update icon cache
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
    gtk-update-icon-cache -f /usr/share/icons/hicolor/ 2>/dev/null || true
fi
# Update desktop database
if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database /usr/share/applications/ 2>/dev/null || true
fi
EOF
chmod 755 "$DEB_ROOT/DEBIAN/postinst"

# Copy bundle
cp -r "$BUNDLE_DIR"/* "$DEB_ROOT/opt/qubite-vpn/"

# Symlink in PATH
ln -sf /opt/qubite-vpn/qubite_vpn "$DEB_ROOT/usr/bin/qubite-vpn"

# Desktop entry
cp "$APP_DIR/installer/linux/qubite-vpn.desktop" "$DEB_ROOT/usr/share/applications/"

# Icon (use the largest Android icon as app icon)
cp "$APP_DIR/android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png" \
   "$DEB_ROOT/usr/share/icons/hicolor/192x192/apps/qubite-vpn.png"

# Set permissions
chmod 755 "$DEB_ROOT/opt/qubite-vpn/qubite_vpn"
find "$DEB_ROOT/opt/qubite-vpn/lib" -name "*.so" -exec chmod 644 {} \;

# Build deb
dpkg-deb --build "$DEB_ROOT"

# Move result
mv "$DEB_ROOT.deb" "$APP_DIR/installer/linux/${PKG_NAME}_${VERSION}_${ARCH}.deb"
rm -rf "$BUILD_DIR"

echo ""
echo "=== Built: installer/linux/${PKG_NAME}_${VERSION}_${ARCH}.deb ==="
echo "Install: sudo dpkg -i ${PKG_NAME}_${VERSION}_${ARCH}.deb"
