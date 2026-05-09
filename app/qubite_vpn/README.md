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

## Быстрый старт

```bash
# Установить Flutter SDK
# https://docs.flutter.dev/get-started/install

# Клонировать и запустить
cd qubite_vpn
flutter pub get
flutter run
```

## Архитектура

Подробное описание в [ARCHITECTURE.md](./ARCHITECTURE.md).

## Протоколы

| Протокол | Описание | Обход DPI |
|----------|----------|-----------|
| NaiveProxy | HTTP/2 CONNECT через Caddy | padding, probe resistance |
| VLESS + Reality | sing-box с SNI-маскарадом | uTLS fingerprint, Reality handshake |

## Лицензия

Proprietary — Qubite.
