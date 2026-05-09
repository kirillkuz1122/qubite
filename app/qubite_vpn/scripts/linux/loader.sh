#!/usr/bin/env bash
set -euo pipefail

# Qubite VPN - Linux Loader
# Downloads and installs all dependencies.
# Usage: sudo ./loader.sh

RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; YELLOW='\033[1;33m'; NC='\033[0m'
step() { echo -e "\n${CYAN}[*] $1${NC}"; }
ok()   { echo -e "    ${GREEN}[OK]${NC} $1"; }
err()  { echo -e "    ${RED}[ERR]${NC} $1"; }
skip() { echo -e "    ${YELLOW}[SKIP]${NC} $1"; }

if [[ $EUID -ne 0 ]]; then err "Run with sudo"; exit 1; fi

REAL_USER="${SUDO_USER:-$USER}"
REAL_HOME=$(eval echo "~$REAL_USER")
PROJECT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"

echo ""
echo "============================================"
echo "  Qubite VPN - Loader (Linux)"
echo "============================================"
echo "  Project: $PROJECT_DIR"

# --- 1. System packages ---
step "1/5 System packages"
if command -v apt-get &>/dev/null; then
    apt-get update -qq
    apt-get install -y -qq curl git unzip clang cmake ninja-build \
        pkg-config libgtk-3-dev liblzma-dev libstdc++-12-dev 2>/dev/null
    ok "apt packages installed"
elif command -v dnf &>/dev/null; then
    dnf install -y -q curl git unzip clang cmake ninja-build \
        gtk3-devel xz-devel 2>/dev/null
    ok "dnf packages installed"
elif command -v pacman &>/dev/null; then
    pacman -Sy --noconfirm --needed curl git unzip clang cmake ninja \
        gtk3 xz base-devel 2>/dev/null
    ok "pacman packages installed"
else
    err "Unknown package manager. Install manually: git, clang, cmake, ninja, gtk3-dev"
fi

# --- 2. Flutter SDK ---
step "2/5 Flutter SDK"
FLUTTER_DIR="$REAL_HOME/flutter"

if sudo -u "$REAL_USER" bash -c 'command -v flutter' &>/dev/null; then
    ok "Flutter already in PATH"
elif [[ -f "$FLUTTER_DIR/bin/flutter" ]]; then
    ok "Flutter found at $FLUTTER_DIR"
else
    echo "    Downloading Flutter SDK..."
    FLUTTER_URL="https://storage.googleapis.com/flutter_infra_release/releases/stable/linux/flutter_linux_3.24.5-stable.tar.xz"
    FLUTTER_TAR="/tmp/flutter_sdk.tar.xz"
    curl -fSL "$FLUTTER_URL" -o "$FLUTTER_TAR"
    tar xf "$FLUTTER_TAR" -C "$REAL_HOME"
    rm -f "$FLUTTER_TAR"
    chown -R "$REAL_USER:$REAL_USER" "$FLUTTER_DIR"
    ok "Flutter installed at $FLUTTER_DIR"
fi

# Add to PATH in .bashrc
FLUTTER_BIN="$FLUTTER_DIR/bin"
if ! grep -q "flutter/bin" "$REAL_HOME/.bashrc" 2>/dev/null; then
    echo "export PATH=\"\$PATH:$FLUTTER_BIN\"" >> "$REAL_HOME/.bashrc"
    ok "Added to .bashrc"
fi
export PATH="$PATH:$FLUTTER_BIN"

sudo -u "$REAL_USER" flutter --disable-analytics 2>/dev/null || true
sudo -u "$REAL_USER" dart --disable-analytics 2>/dev/null || true

# --- 3. sing-box binary ---
step "3/5 sing-box"
SINGBOX_VERSION="1.11.0"
SINGBOX_DIR="$PROJECT_DIR/core_build/linux"
SINGBOX_BIN="$SINGBOX_DIR/sing-box"

mkdir -p "$SINGBOX_DIR"

if [[ -f "$SINGBOX_BIN" ]]; then
    ok "sing-box already exists"
else
    ARCH=$(uname -m)
    case "$ARCH" in
        x86_64)  SB_ARCH="amd64" ;;
        aarch64) SB_ARCH="arm64" ;;
        *)       err "Unsupported arch: $ARCH"; SB_ARCH="" ;;
    esac

    if [[ -n "$SB_ARCH" ]]; then
        echo "    Downloading sing-box v$SINGBOX_VERSION ($SB_ARCH)..."
        SB_URL="https://github.com/SagerNet/sing-box/releases/download/v$SINGBOX_VERSION/sing-box-$SINGBOX_VERSION-linux-$SB_ARCH.tar.gz"
        SB_TAR="/tmp/sing-box.tar.gz"
        curl -fSL "$SB_URL" -o "$SB_TAR"
        tar xzf "$SB_TAR" -C /tmp
        find /tmp -name "sing-box" -type f -executable | head -1 | xargs -I{} cp {} "$SINGBOX_BIN"
        chmod +x "$SINGBOX_BIN"
        rm -rf "$SB_TAR" /tmp/sing-box-*
        if [[ -f "$SINGBOX_BIN" ]]; then
            SIZE=$(du -m "$SINGBOX_BIN" | cut -f1)
            ok "sing-box ($SIZE MB)"
        else
            err "sing-box not found in archive"
        fi
    fi
fi
chown -R "$REAL_USER:$REAL_USER" "$PROJECT_DIR/core_build"

# --- 4. Flutter deps ---
step "4/5 Flutter project dependencies"
cd "$PROJECT_DIR"
sudo -u "$REAL_USER" flutter pub get 2>/dev/null
ok "pub get done"

# --- 5. Verify ---
step "5/5 Flutter doctor"
sudo -u "$REAL_USER" flutter doctor 2>/dev/null || true

echo ""
echo "============================================"
echo "  Loader done.                              "
echo "============================================"
echo ""
echo "  Next: open a new terminal, then run:"
echo "    scripts/linux/runner.sh"
echo ""
