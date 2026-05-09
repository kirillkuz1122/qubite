#!/usr/bin/env bash
set -euo pipefail

# Qubite VPN - Linux Cleanup
# Usage: sudo ./clean.sh [-a|--all]

RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; NC='\033[0m'
step() { echo -e "\n${CYAN}[*] $1${NC}"; }
ok()   { echo -e "    ${GREEN}[OK]${NC} $1"; }
skip() { echo -e "    [SKIP] $1"; }

ALL=false
[[ "${1:-}" == "-a" || "${1:-}" == "--all" ]] && ALL=true

REAL_USER="${SUDO_USER:-$USER}"
REAL_HOME=$(eval echo "~$REAL_USER")
PROJECT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"

echo ""
echo "============================================"
echo "  Qubite VPN - Cleanup (Linux)"
echo "============================================"

step "sing-box binary"
SB="$PROJECT_DIR/core_build/linux/sing-box"
if [[ -f "$SB" ]]; then rm -f "$SB"; ok "Deleted"; else skip "Not found"; fi

step "Build cache"
if [[ -d "$PROJECT_DIR/build" ]]; then rm -rf "$PROJECT_DIR/build"; ok "Deleted build/"; fi
if [[ -d "$PROJECT_DIR/.dart_tool" ]]; then rm -rf "$PROJECT_DIR/.dart_tool"; ok "Deleted .dart_tool/"; fi

if $ALL; then
    step "Flutter SDK"
    FLUTTER_DIR="$REAL_HOME/flutter"
    if [[ -d "$FLUTTER_DIR" ]]; then
        rm -rf "$FLUTTER_DIR"
        sed -i '/flutter\/bin/d' "$REAL_HOME/.bashrc" 2>/dev/null || true
        ok "Removed $FLUTTER_DIR"
    else skip "Not found"; fi
fi

echo ""
echo "  Done. Restart terminal."
if ! $ALL; then echo "  Use --all to also remove Flutter SDK."; fi
echo ""
