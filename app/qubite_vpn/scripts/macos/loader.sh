#!/usr/bin/env bash
set -euo pipefail

# Qubite VPN - macOS Loader
# Usage: ./loader.sh

RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; YELLOW='\033[1;33m'; NC='\033[0m'
step() { echo -e "\n${CYAN}[*] $1${NC}"; }
ok()   { echo -e "    ${GREEN}[OK]${NC} $1"; }
err()  { echo -e "    ${RED}[ERR]${NC} $1"; }
skip() { echo -e "    ${YELLOW}[SKIP]${NC} $1"; }

PROJECT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"

echo ""
echo "============================================"
echo "  Qubite VPN - Loader (macOS)"
echo "============================================"
echo "  Project: $PROJECT_DIR"

# --- 1. Xcode CLT ---
step "1/5 Xcode Command Line Tools"
if xcode-select -p &>/dev/null; then
    ok "Already installed"
else
    echo "    Installing (may prompt for password)..."
    xcode-select --install 2>/dev/null || true
    echo "    Waiting for Xcode CLT install to complete..."
    until xcode-select -p &>/dev/null; do sleep 5; done
    ok "Installed"
fi

# --- 2. Homebrew ---
step "2/5 Homebrew"
if command -v brew &>/dev/null; then
    ok "brew ready"
else
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    eval "$(/opt/homebrew/bin/brew shellenv 2>/dev/null || /usr/local/bin/brew shellenv 2>/dev/null)"
    ok "brew installed"
fi

brew install cocoapods 2>/dev/null || true
ok "cocoapods"

# --- 3. Flutter SDK ---
step "3/5 Flutter SDK"
FLUTTER_DIR="$HOME/flutter"

if command -v flutter &>/dev/null; then
    ok "Flutter already in PATH"
elif [[ -f "$FLUTTER_DIR/bin/flutter" ]]; then
    ok "Flutter found at $FLUTTER_DIR"
else
    echo "    Downloading Flutter SDK..."
    FLUTTER_URL="https://storage.googleapis.com/flutter_infra_release/releases/stable/macos/flutter_macos_3.24.5-stable.zip"
    FLUTTER_ZIP="/tmp/flutter_sdk.zip"
    curl -fSL "$FLUTTER_URL" -o "$FLUTTER_ZIP"
    unzip -qo "$FLUTTER_ZIP" -d "$HOME"
    rm -f "$FLUTTER_ZIP"
    ok "Flutter installed at $FLUTTER_DIR"
fi

# Add to PATH
FLUTTER_BIN="$FLUTTER_DIR/bin"
export PATH="$PATH:$FLUTTER_BIN"

SHELL_RC="$HOME/.zshrc"
[[ -n "${BASH_VERSION:-}" ]] && SHELL_RC="$HOME/.bashrc"
if ! grep -q "flutter/bin" "$SHELL_RC" 2>/dev/null; then
    echo "export PATH=\"\$PATH:$FLUTTER_BIN\"" >> "$SHELL_RC"
    ok "Added to $SHELL_RC"
fi

flutter --disable-analytics 2>/dev/null || true
dart --disable-analytics 2>/dev/null || true

# --- 4. sing-box binary ---
step "4/5 sing-box"
SINGBOX_VERSION="1.11.0"
SINGBOX_DIR="$PROJECT_DIR/core_build/macos"
SINGBOX_BIN="$SINGBOX_DIR/sing-box"

mkdir -p "$SINGBOX_DIR"

if [[ -f "$SINGBOX_BIN" ]]; then
    ok "sing-box already exists"
else
    ARCH=$(uname -m)
    case "$ARCH" in
        x86_64)  SB_ARCH="amd64" ;;
        arm64)   SB_ARCH="arm64" ;;
        *)       err "Unsupported: $ARCH"; SB_ARCH="" ;;
    esac

    if [[ -n "$SB_ARCH" ]]; then
        echo "    Downloading sing-box v$SINGBOX_VERSION ($SB_ARCH)..."
        SB_URL="https://github.com/SagerNet/sing-box/releases/download/v$SINGBOX_VERSION/sing-box-$SINGBOX_VERSION-darwin-$SB_ARCH.tar.gz"
        SB_TAR="/tmp/sing-box.tar.gz"
        curl -fSL "$SB_URL" -o "$SB_TAR"
        tar xzf "$SB_TAR" -C /tmp
        find /tmp -name "sing-box" -type f | head -1 | xargs -I{} cp {} "$SINGBOX_BIN"
        chmod +x "$SINGBOX_BIN"
        rm -rf "$SB_TAR" /tmp/sing-box-*
        if [[ -f "$SINGBOX_BIN" ]]; then
            SIZE=$(du -m "$SINGBOX_BIN" | awk '{print $1}')
            ok "sing-box ($SIZE MB)"
        fi
    fi
fi

# --- 5. Flutter deps ---
step "5/5 Flutter project dependencies"
cd "$PROJECT_DIR"
flutter pub get 2>/dev/null
ok "pub get done"

echo ""
echo "============================================"
echo "  Loader done.                              "
echo "============================================"
echo ""
echo "  Next: open a new terminal, then run:"
echo "    scripts/macos/runner.sh"
echo ""
