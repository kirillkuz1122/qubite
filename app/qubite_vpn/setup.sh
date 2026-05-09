#!/bin/bash
# Qubite VPN — bootstrap скрипт.
#
# Этот скрипт генерирует файлы, которые flutter create обычно создаёт автоматически:
# - flutter managed configs (generated_plugin_registrant, flutter_export_environment, etc.)
# - platform-specific wrappers
#
# Требования: Flutter SDK в PATH
#
# Использование:
#   chmod +x setup.sh && ./setup.sh

set -euo pipefail

# Проверка Flutter
if ! command -v flutter &> /dev/null; then
    echo "Flutter SDK не найден в PATH."
    echo ""
    echo "Установите Flutter:"
    echo "  https://docs.flutter.dev/get-started/install"
    echo ""
    echo "Или укажите путь:"
    echo "  export PATH=\"\$PATH:/path/to/flutter/bin\""
    exit 1
fi

echo "Flutter найден: $(flutter --version | head -1)"
echo ""

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Создать временный flutter-проект для получения boilerplate
TEMP_DIR=$(mktemp -d)
echo "Создаю scaffold проект в $TEMP_DIR..."

flutter create --org ru.qubite --project-name qubite_vpn \
    --platforms=android,ios,windows,linux,macos \
    "$TEMP_DIR/qubite_vpn" > /dev/null 2>&1

echo "Копирую platform-файлы..."

# Копируем только недостающие файлы (не перетираем наши)
copy_if_missing() {
    local src="$1"
    local dst="$2"
    if [ ! -f "$dst" ]; then
        mkdir -p "$(dirname "$dst")"
        cp "$src" "$dst"
        echo "  + $dst"
    fi
}

# Flutter managed dirs
for platform in android ios windows linux macos; do
    if [ -d "$TEMP_DIR/qubite_vpn/$platform" ]; then
        # Рекурсивно копируем файлы, которых нет
        find "$TEMP_DIR/qubite_vpn/$platform" -type f | while read -r file; do
            relative="${file#$TEMP_DIR/qubite_vpn/}"
            copy_if_missing "$file" "$SCRIPT_DIR/$relative"
        done
    fi
done

# analysis_options.yaml
copy_if_missing "$TEMP_DIR/qubite_vpn/analysis_options.yaml" "$SCRIPT_DIR/analysis_options.yaml"

# Чистка
rm -rf "$TEMP_DIR"

echo ""
echo "Получаю зависимости..."
flutter pub get

echo ""
echo "=== Setup complete ==="
echo ""
echo "Запуск:"
echo "  flutter run -d windows"
echo "  flutter run -d linux"
echo "  flutter run -d android"
echo ""
echo "Сборка:"
echo "  flutter build apk --release"
echo "  flutter build windows --release"
