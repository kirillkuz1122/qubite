#!/usr/bin/env bash
set -euo pipefail

# Qubite VPN - macOS Runner
# Usage: ./runner.sh [debug|release|build]

PROJECT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
MODE="${1:-debug}"

echo ""
echo "  Qubite VPN - Runner (macOS)"
echo "  =============================="
echo ""

if ! command -v flutter &>/dev/null; then
    echo "  [ERR] Flutter not found. Run loader.sh first, then restart terminal."
    exit 1
fi

if [[ ! -f "$PROJECT_DIR/core_build/macos/sing-box" ]]; then
    echo "  [WARN] sing-box not found in core_build/macos/"
    echo ""
fi

if [[ ! -f "$PROJECT_DIR/.dart_tool/package_config.json" ]]; then
    echo "  [*] Running flutter pub get..."
    cd "$PROJECT_DIR" && flutter pub get
fi

cd "$PROJECT_DIR"

case "$MODE" in
    debug)
        echo "  [*] Debug mode (hot reload: 'r', quit: 'q')"
        echo ""
        flutter run -d macos
        ;;
    release)
        echo "  [*] Release mode"
        echo ""
        flutter run -d macos --release
        ;;
    build)
        echo "  [*] Building release..."
        echo ""
        flutter build macos --release
        echo ""
        echo "  [OK] Build at: $PROJECT_DIR/build/macos/Build/Products/Release/"
        ;;
    *)
        echo "  Usage: $0 [debug|release|build]"
        exit 1
        ;;
esac
