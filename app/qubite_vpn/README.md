# Qubite VPN

Мультиплатформенный VPN-клиент для прокси-системы Qubite.

## Возможности

- **Мультиплатформенность**: Windows, Linux, Android, iOS, macOS
- **Изолированное ядро**: sing-box работает в TUN-режиме, невидимом для других приложений
- **Split-tunneling**: российские сайты и приложения идут напрямую, остальное через VPN
- **Сессионные токены**: никаких постоянных ключей — только short-lived credentials
- **Автовыбор сервера**: latency probes + priority/weight + automatic fallback
- **Определение ТСПУ**: автоматическая детекция замедления/блокировок
- **NaiveProxy + VLESS Reality**: два протокола для обхода DPI

## Установка зависимостей

Скрипты в `scripts/` автоматически установят всё необходимое:

### Windows

```powershell
# Запустить PowerShell от имени администратора:
PowerShell -ExecutionPolicy Bypass -File scripts\setup-windows.ps1

# Или двойной клик по:
scripts\setup-windows.bat
```

Устанавливает: Chocolatey, Git, Go, CMake, Visual Studio Build Tools (C++), Flutter SDK, Android Studio, sing-box.

### Linux (Ubuntu/Debian/Fedora/Arch)

```bash
chmod +x scripts/setup-linux.sh
sudo ./scripts/setup-linux.sh

# Без Android:
sudo ./scripts/setup-linux.sh --skip-android
```

Устанавливает: build-essential, cmake, ninja, clang, gtk3-dev, Go, Flutter SDK, Android SDK + NDK, sing-box.

### macOS

```bash
chmod +x scripts/setup-macos.sh
./scripts/setup-macos.sh

# Без Android и iOS:
./scripts/setup-macos.sh --skip-android --skip-ios
```

Устанавливает: Xcode CLI Tools, Homebrew, Go, CMake, Flutter SDK, CocoaPods, Android Studio, sing-box.

### Универсальный

```bash
chmod +x scripts/setup.sh
./scripts/setup.sh
```

Определяет ОС автоматически и вызывает нужный скрипт.

## Быстрый старт (после установки)

```bash
cd qubite_vpn
flutter run -d windows    # или linux, android, macos, ios
```

## Сборка release

```bash
flutter build windows --release     # → build/windows/x64/runner/Release/
flutter build apk --release         # → build/app/outputs/flutter-apk/
flutter build linux --release       # → build/linux/x64/release/bundle/
flutter build macos --release       # → build/macos/Build/Products/Release/
flutter build ipa --release         # → build/ios/ipa/ (требует Apple Developer)
```

## Структура скриптов

```
scripts/
├── setup.sh                  # Универсальный роутер (определяет ОС)
├── setup-windows.ps1         # PowerShell: все зависимости для Windows
├── setup-windows.bat         # Обёртка для двойного клика
├── setup-linux.sh            # Bash: все зависимости для Linux
├── setup-macos.sh            # Bash: все зависимости для macOS
└── setup-android-device.sh   # Проверка Android-устройства через ADB
```

## Что устанавливают скрипты

| Компонент | Windows | Linux | macOS |
|-----------|---------|-------|-------|
| Flutter SDK | ✅ choco/zip | ✅ tar.xz | ✅ zip |
| Go | ✅ choco | ✅ tar.gz | ✅ brew |
| CMake | ✅ choco | ✅ apt/dnf/pacman | ✅ brew |
| C++ Build Tools | ✅ VS Build Tools | ✅ build-essential + clang | ✅ Xcode CLI |
| GTK3 (Linux desktop) | — | ✅ libgtk-3-dev | — |
| Android SDK + NDK | ✅ Android Studio | ✅ cmdline-tools | ✅ Android Studio |
| CocoaPods (iOS) | — | — | ✅ brew |
| sing-box v1.13.5 | ✅ go build | ✅ go build + setcap | ✅ go build |

## Архитектура

Подробное описание в [ARCHITECTURE.md](./ARCHITECTURE.md).

## Протоколы

| Протокол | Описание | Обход DPI |
|----------|----------|-----------|
| NaiveProxy | HTTP/2 CONNECT через Caddy | padding, probe resistance |
| VLESS + Reality | sing-box с SNI-маскарадом | uTLS fingerprint, Reality handshake |

## Лицензия

Proprietary — Qubite.
