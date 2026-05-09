#!/bin/bash
# Скрипт сборки sing-box для всех платформ.
# Требования: Go 1.21+, Android NDK (для Android), Xcode (для iOS/macOS).
#
# sing-box собирается из исходников с нужными тегами:
# - with_quic — поддержка QUIC/HTTP3
# - with_reality_server — Reality (не нужен клиенту, но для совместимости)
# - with_utls — uTLS fingerprinting (маскировка под Chrome)
# - with_gvisor — сетевой стек gVisor для TUN

set -euo pipefail

SINGBOX_VERSION="1.13.5"
SINGBOX_REPO="github.com/sagernet/sing-box"
BUILD_TAGS="with_quic,with_utls,with_gvisor,with_clash_api"
OUTPUT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== Building sing-box v${SINGBOX_VERSION} ==="

# Клонировать если нужно
if [ ! -d "sing-box-src" ]; then
    git clone --branch "v${SINGBOX_VERSION}" --depth 1 \
        "https://${SINGBOX_REPO}" sing-box-src
fi

cd sing-box-src

# ─── Windows (amd64) ─────────────────────────────────────────────────────────
echo "Building for Windows amd64..."
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 \
    go build -tags "${BUILD_TAGS}" -trimpath \
    -ldflags="-s -w -X '${SINGBOX_REPO}/constant.Version=${SINGBOX_VERSION}'" \
    -o "${OUTPUT_DIR}/windows/sing-box.exe" \
    ./cmd/sing-box

# ─── Linux (amd64) ───────────────────────────────────────────────────────────
echo "Building for Linux amd64..."
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 \
    go build -tags "${BUILD_TAGS}" -trimpath \
    -ldflags="-s -w -X '${SINGBOX_REPO}/constant.Version=${SINGBOX_VERSION}'" \
    -o "${OUTPUT_DIR}/linux/sing-box" \
    ./cmd/sing-box

# ─── Android (arm64, arm, x86_64) ────────────────────────────────────────────
echo "Building for Android..."
# Требует gomobile или ручной cross-compilation через Android NDK
# Для Flutter используется библиотека через dart:ffi / platform channel
for ARCH in arm64 arm amd64; do
    GOARCH_ANDROID="${ARCH}"
    if [ "$ARCH" = "arm64" ]; then GOARCH_ANDROID="arm64"; fi
    if [ "$ARCH" = "arm" ]; then GOARCH_ANDROID="arm"; fi
    if [ "$ARCH" = "amd64" ]; then GOARCH_ANDROID="amd64"; fi

    GOOS=android GOARCH="${GOARCH_ANDROID}" CGO_ENABLED=1 \
        go build -tags "${BUILD_TAGS}" -trimpath \
        -ldflags="-s -w" \
        -o "${OUTPUT_DIR}/android/libsingbox_${ARCH}.so" \
        ./cmd/sing-box 2>/dev/null || echo "  (Android ${ARCH} requires NDK, skipping)"
done

# ─── iOS (arm64) — requires Xcode + gomobile ─────────────────────────────────
echo "Building for iOS..."
# iOS builds require gomobile bind for XCFramework
# gomobile bind -target=ios -tags "${BUILD_TAGS}" ./experimental/libbox
echo "  iOS build requires gomobile. Run: gomobile bind -target=ios ./experimental/libbox"

# ─── macOS (arm64, amd64) ────────────────────────────────────────────────────
echo "Building for macOS..."
GOOS=darwin GOARCH=arm64 CGO_ENABLED=0 \
    go build -tags "${BUILD_TAGS}" -trimpath \
    -ldflags="-s -w" \
    -o "${OUTPUT_DIR}/macos/sing-box-arm64" \
    ./cmd/sing-box 2>/dev/null || echo "  (macOS arm64 skipped — requires macOS)"

GOOS=darwin GOARCH=amd64 CGO_ENABLED=0 \
    go build -tags "${BUILD_TAGS}" -trimpath \
    -ldflags="-s -w" \
    -o "${OUTPUT_DIR}/macos/sing-box-amd64" \
    ./cmd/sing-box 2>/dev/null || echo "  (macOS amd64 skipped — requires macOS)"

echo ""
echo "=== Build complete ==="
echo "Binaries in: ${OUTPUT_DIR}/{windows,linux,android,ios,macos}/"
