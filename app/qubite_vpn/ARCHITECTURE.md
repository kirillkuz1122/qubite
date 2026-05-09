# Qubite VPN — Архитектура приложения

## Обзор

Мультиплатформенный VPN-клиент на базе **Flutter** + **sing-box**, интегрированный с прокси-системой Qubite.

### Поддерживаемые платформы

| Платформа | UI | VPN-ядро | Изоляция |
|-----------|-----|----------|----------|
| Windows | Flutter | sing-box.exe (subprocess) | TUN, no localhost ports |
| Linux | Flutter | sing-box (subprocess) | TUN, strict_route |
| Android | Flutter | sing-box (VpnService + FFI) | Android VPN sandbox |
| iOS | Flutter | sing-box (NetworkExtension) | iOS packet tunnel |
| macOS | Flutter | sing-box (subprocess) | TUN, strict_route |

---

## Стек технологий

- **UI Framework**: Flutter 3.x (Dart)
- **State Management**: Riverpod
- **VPN Core**: sing-box v1.13.5 (Go)
- **Протоколы**: NaiveProxy (HTTP/2 CONNECT), VLESS + Reality
- **Хранение**: Hive (config), flutter_secure_storage (credentials)
- **Сеть**: Dio + cookie_jar (HTTP), Socket (latency probes)

---

## Архитектура приложения

```
┌─────────────────────────────────────────────────┐
│                   Flutter UI                     │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────┐ │
│  │  Login   │ │   Home   │ │ Servers/Settings │ │
│  └────┬─────┘ └────┬─────┘ └────────┬─────────┘ │
│       └─────────────┼───────────────┘            │
│                     ▼                            │
│            ┌─────────────────┐                   │
│            │  Riverpod State │                   │
│            │  (Providers)    │                   │
│            └────────┬────────┘                   │
├─────────────────────┼───────────────────────────┤
│              Core Layer                          │
│  ┌──────────┐ ┌─────┴──────┐ ┌───────────────┐  │
│  │ VPN      │ │ Session    │ │ Server        │  │
│  │ Engine   │ │ Manager    │ │ Selector      │  │
│  └────┬─────┘ └─────┬──────┘ └───────┬───────┘  │
│       │             │                │           │
│  ┌────┴─────┐ ┌─────┴──────┐ ┌──────┴────────┐  │
│  │ Singbox  │ │ Qubite API │ │ Whitelist     │  │
│  │ Core     │ │ Client     │ │ Detector      │  │
│  └────┬─────┘ └────────────┘ └───────────────┘  │
├───────┼─────────────────────────────────────────┤
│       ▼          Platform Layer                  │
│  ┌──────────────────────────────────────────┐    │
│  │ Windows: sing-box.exe subprocess          │   │
│  │ Linux:   sing-box subprocess              │   │
│  │ Android: VpnService + sing-box FFI        │   │
│  │ iOS:     NetworkExtension + sing-box      │   │
│  │ macOS:   sing-box subprocess              │   │
│  └──────────────────────────────────────────┘    │
└─────────────────────────────────────────────────┘
```

---

## Цикл подключения

```
1. Пользователь нажимает "Подключить"
       │
2. VpnEngine.connect()
       │
3. Получить routing profile → GET /api/proxy/routing-profile
       │                       (fallback на дефолтный если API недоступен)
       │
4. Выбрать сервер → ServerSelector.selectBest()
       │              ├─ Фильтр по health != offline
       │              ├─ Сортировка по priority (min)
       │              ├─ Среди одинаковых priority → по latency
       │              └─ Без latency данных → weighted random
       │
5. Запросить credential → POST /api/proxy/session/start
       │                   { deviceId, serverId }
       │                   → { session: { credential: { username, password, expiresAt, refreshAfter } } }
       │
6. Сгенерировать sing-box config
       │  ├─ Inbound: TUN (не localhost SOCKS/HTTP!)
       │  ├─ Outbound: HTTP proxy (NaiveProxy) или VLESS+Reality
       │  └─ Route: split-tunneling rules из routing profile
       │
7. Запустить sing-box
       │  ├─ Desktop: subprocess с TUN
       │  └─ Mobile: VpnService / NetworkExtension
       │
8. Запустить refresh timer (credential.refreshAfter)
       │
9. Статус → "Подключено"
       │
  ─── Периодически ───
       │
10. POST /api/proxy/session/refresh (каждые ~10 мин)
       │  → Новые credentials → обновить sing-box config
       │
11. POST /api/proxy/events/heartbeat (каждые 60 сек)
       │
12. Агрегация + отправка телеметрии трафика (каждые 30 сек)
       │  POST /api/proxy/events/traffic
       │  (только домены, БЕЗ полных URL)
```

---

## Изоляция ядра

### Проблема
Другие приложения на устройстве могут:
- Сканировать открытые порты и обнаружить прокси
- Перехватить localhost SOCKS/HTTP трафик
- Анализировать процессы и сетевые соединения

### Решение

**1. Только TUN-режим (без localhost proxy)**

sing-box конфигурируется с ЕДИНСТВЕННЫМ inbound — TUN:
```json
{
  "inbounds": [{
    "type": "tun",
    "strict_route": true,
    "auto_route": true
  }]
}
```
Никаких SOCKS5 на :1080 или HTTP proxy на :8080. Другие приложения не видят прокси.

**2. strict_route**

Включен `strict_route: true` — весь трафик идёт ТОЛЬКО через TUN, bypass невозможен.

**3. Android VpnService**

Android создаёт изолированный VPN sandbox:
- TUN-интерфейс принадлежит только VpnService
- `addDisallowedApplication()` исключает РФ-приложения на уровне ОС
- Другие приложения не могут прочитать VPN-трафик

**4. Process isolation (Desktop)**

sing-box запускается как отдельный процесс:
- Не наследует env-переменные proxy (http_proxy, HTTPS_PROXY)
- На Windows: `CREATE_NO_WINDOW` скрывает процесс от пользователя
- Нет shared memory или IPC с другими приложениями

---

## Split-tunneling

Routing profile с сервера определяет что проксировать:

| Трафик | Действие | Пример |
|--------|----------|--------|
| .ru / .рф / .su | direct | yandex.ru, vk.com, gosuslugi.ru |
| Банки, госсервисы | direct | sberbank.ru, nalog.gov.ru |
| Локальные сети | direct | 192.168.x.x, 10.x.x.x |
| Всё остальное | proxy | google.com, youtube.com, twitter.com |

На Android дополнительно — split по приложениям через `addDisallowedApplication()`.

---

## Определение белых списков (ТСПУ)

`WhitelistDetector` автоматически определяет сетевую среду:

1. **Probe**: TCP connect к youtube.com, twitter.com, instagram.com
2. **Control**: TCP connect к yandex.ru, vk.com
3. **Анализ**:
   - Если probe unreachable → режим `blocked` (нужен VPN)
   - Если probe >> 3x control → режим `throttled` (замедление, нужен VPN)
   - Если probe ≈ control → режим `unrestricted`

Рекомендация показывается пользователю при первом запуске и при смене сети.

---

## Автовыбор сервера

`ServerSelector` выбирает лучший сервер:

```
1. GET /api/proxy/servers → список серверов
2. Фильтр: health != "offline"
3. Сортировка по priority (меньше = лучше)
4. Среди одинаковых priority:
   a. Если есть latency данные → выбрать с минимальным latency
   b. Если нет → weighted random (weight)
5. При ошибке → fallback на следующий сервер
```

Latency измеряется через TCP connect к domain:443 (< 5 сек timeout).

---

## Credential lifecycle

```
Сессия живёт ~30 минут (PROXY_SESSION_TTL_MS)
Refresh каждые ~10 минут (PROXY_REFRESH_AFTER_MS)

T=0:00   POST /api/proxy/session/start → credential v1
T=10:00  POST /api/proxy/session/refresh → credential v2 (v1 уничтожен)
T=20:00  POST /api/proxy/session/refresh → credential v3
T=30:00  Если не refresh — сессия истекает, отключение
```

Пароль НИКОГДА не показывается пользователю. Пользователь не видит "ключи" — только сессионные токены, привязанные к устройству и сайту.

---

## Структура проекта

```
qubite_vpn/
├── lib/
│   ├── main.dart                          # Entry point
│   ├── core/
│   │   ├── singbox_core.dart              # sing-box process management + config gen
│   │   ├── vpn_engine.dart                # Высокоуровневый VPN controller
│   │   ├── server_selector.dart           # Выбор и измерение серверов
│   │   ├── session_manager.dart           # Credential lifecycle + refresh
│   │   ├── isolation.dart                 # Изоляция ядра от приложений
│   │   └── whitelist_detector.dart        # Детекция ТСПУ / белых списков
│   ├── data/
│   │   ├── api/
│   │   │   └── qubite_api.dart            # HTTP-клиент Qubite API
│   │   └── models/
│   │       ├── server_model.dart           # ProxyServer
│   │       ├── session_model.dart          # ProxySession, Credential
│   │       ├── device_model.dart           # ProxyDevice
│   │       ├── routing_profile.dart        # RoutingProfile, rules
│   │       └── catalog_model.dart          # ConnectionCatalog
│   ├── presentation/
│   │   ├── app.dart                       # MaterialApp root
│   │   ├── theme.dart                     # Dark theme (Qubite branding)
│   │   ├── providers/
│   │   │   ├── auth_provider.dart          # Auth state
│   │   │   └── vpn_provider.dart           # VPN state
│   │   ├── screens/
│   │   │   ├── login_screen.dart           # Auth screen
│   │   │   ├── home_screen.dart            # Main screen + connect button
│   │   │   ├── servers_screen.dart         # Server list + latency
│   │   │   └── settings_screen.dart        # Settings + account
│   │   └── widgets/
│   │       ├── connection_button.dart      # Animated connect/disconnect
│   │       ├── status_indicator.dart       # Ring animation
│   │       └── server_card.dart            # Server list item
│   └── services/
│       ├── service_locator.dart            # DI / singleton registry
│       ├── heartbeat_service.dart          # Periodic heartbeat
│       └── traffic_collector.dart          # Traffic telemetry aggregation
├── android/
│   └── app/src/main/
│       ├── AndroidManifest.xml             # VPN permissions + service declaration
│       └── kotlin/ru/qubite/vpn/
│           └── QubiteVpnService.kt         # Android VPN Service
├── core_build/
│   └── build_singbox.sh                   # Cross-platform sing-box build script
├── pubspec.yaml                           # Flutter dependencies
└── ARCHITECTURE.md                        # This file
```

---

## Сборка

### Предварительные требования

- Flutter SDK 3.x
- Go 1.21+ (для сборки sing-box)
- Android SDK + NDK (для Android)
- Xcode (для iOS/macOS)

### Шаги

```bash
# 1. Собрать sing-box для целевых платформ
cd core_build && bash build_singbox.sh

# 2. Установить Flutter зависимости
cd .. && flutter pub get

# 3. Запуск в debug
flutter run -d windows    # или linux, android, ios, macos

# 4. Release build
flutter build apk --release          # Android
flutter build ipa --release          # iOS
flutter build windows --release      # Windows
flutter build linux --release        # Linux
```

---

## Безопасность

- Credentials хранятся ТОЛЬКО в `flutter_secure_storage` (Keychain/Keystore)
- Пароли прокси НИКОГДА не показываются в UI
- Session cookies не экспортируются
- Телеметрия — только домены, без полных URL
- No-log режим: если сервер вернул `privacy: "no_logs"`, телеметрия отключается
- TLS certificate pinning для API (TODO)

---

## TODO (следующие шаги)

- [ ] Platform channel для Android VpnService ↔ Flutter
- [ ] iOS NetworkExtension интеграция
- [ ] TLS certificate pinning для qubiteapp.ru
- [ ] OAuth login (Google, Yandex, VK, Telegram) через WebView
- [ ] Auto-reconnect при потере соединения
- [ ] Quick Settings tile (Android)
- [ ] System tray (Windows/Linux/macOS)
- [ ] Bandwidth graph (fl_chart)
- [ ] Subscription URL import (для NekoBox-совместимости)
- [ ] Geoip-based server recommendations
- [ ] Localization (ru/en)
