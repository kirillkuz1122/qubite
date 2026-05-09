#!/usr/bin/env bash
set -euo pipefail

# Qubite VPN - Linux Runner
# Usage: ./runner.sh [debug|release|build]

PROJECT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
MODE="${1:-debug}"

echo ""
echo "  Qubite VPN - Runner (Linux)"
echo "  =============================="
echo ""

# Check flutter
if ! command -v flutter &>/dev/null; then
    echo "  [ERR] Flutter not found. Run loader.sh first, then restart terminal."
    exit 1
fi

# Check sing-box
if [[ ! -f "$PROJECT_DIR/core_build/linux/sing-box" ]]; then
    echo "  [WARN] sing-box not found in core_build/linux/"
    echo "         Run loader.sh to download it."
    echo ""
fi

# Ensure deps
if [[ ! -f "$PROJECT_DIR/.dart_tool/package_config.json" ]]; then
    echo "  [*] Running flutter pub get..."
    cd "$PROJECT_DIR" && flutter pub get
    echo ""
fi

cd "$PROJECT_DIR"

case "$MODE" in
    debug)
        echo "  [*] Debug mode (hot reload: press 'r', quit: 'q')"
        echo ""
        flutter run -d linux
        ;;
    release)
        echo "  [*] Release mode"
        echo ""
        flutter run -d linux --release
        ;;
    build)
        echo "  [*] Building release..."
        echo ""
        flutter build linux --release
        echo ""
        echo "  [OK] Build at: $PROJECT_DIR/build/linux/x64/release/bundle/"
        ;;
    *)
        echo "  Usage: $0 [debug|release|build]"
        exit 1
        ;;
esac
