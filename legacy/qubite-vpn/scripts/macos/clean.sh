#!/usr/bin/env bash
set -euo pipefail

# Qubite VPN - macOS Cleanup
# Usage: ./clean.sh [--all]

PROJECT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
ALL=false
[[ "${1:-}" == "-a" || "${1:-}" == "--all" ]] && ALL=true

echo ""
echo "  Qubite VPN - Cleanup (macOS)"
echo "  =============================="

echo ""
echo "  [*] sing-box"
SB="$PROJECT_DIR/core_build/macos/sing-box"
if [[ -f "$SB" ]]; then rm -f "$SB"; echo "    [OK] Deleted"; else echo "    [SKIP]"; fi

echo "  [*] Build cache"
rm -rf "$PROJECT_DIR/build" "$PROJECT_DIR/.dart_tool" 2>/dev/null || true
echo "    [OK] Cleaned"

if $ALL; then
    echo "  [*] Flutter SDK"
    FLUTTER_DIR="$HOME/flutter"
    if [[ -d "$FLUTTER_DIR" ]]; then
        rm -rf "$FLUTTER_DIR"
        sed -i '' '/flutter\/bin/d' "$HOME/.zshrc" 2>/dev/null || true
        sed -i '' '/flutter\/bin/d' "$HOME/.bashrc" 2>/dev/null || true
        echo "    [OK] Removed"
    fi
fi

echo ""
echo "  Done."
if ! $ALL; then echo "  Use --all to also remove Flutter SDK."; fi
echo ""
