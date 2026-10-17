# Прокси-система Qubite: полный обзор

## Общая архитектура

Qubite содержит встроенную VPN/прокси-систему, которая работает **отдельно от основного сайта**. Основной сайт живёт на `qubiteapp.ru`, прокси-entrypoint — на `proxy.qubiteapp.online`. Прокси может продолжать работать даже при остановке веб-приложения (PM2), пока не истекут синхронизированные credentials.

### Поддерживаемые протоколы

1. **NaiveProxy** (основной) — HTTP/2 CONNECT через Caddy с `forwardproxy` модулем klzgrad
2. **VLESS + Reality** (дополнительный) — через sing-box, для обхода DPI через SNI-маскарад

### Сетевая схема

```
Клиент
  -> Авторизация через https://qubiteapp.ru
  -> Регистрация устройства
  -> Получение short-lived credential (логин/пароль)
  -> Подключение к proxy.qubiteapp.online

Сервер (порт 443):
  nginx SNI router (stream модуль, ssl_preread)
    |
    |-- Домены *.qubiteapp.online / *.qubiteapp.ru --> Caddy NaiveProxy на :18443
    |-- Прочие SNI (маскарад)                      --> sing-box Reality на :18444+
    |
Caddy (:18443):
    |-- proxy.qubiteapp.online  -> forward_proxy (NaiveProxy)
    |-- qubiteapp.ru            -> reverse_proxy localhost:8080 (Nginx internal)
    |
Nginx internal (:8080):
    -> Node.js/Express на 127.0.0.1:3000
```

### Независимость от сайта

Прокси работает как отдельный systemd-сервис (`caddy-naive.service`), не через PM2:
- `pm2 qubiteapp` — сайт/API
- `caddy-naive.service` — прокси-фронтенд и TLS
- `singbox-reality.service` — VLESS+Reality
- `nginx.service` — SNI-роутер + внутренний reverse proxy

---

## Файловая карта прокси-системы

### Бэкенд

| Файл | Назначение |
|------|-----------|
| `back/src/proxy/routes.js` (~1700 строк) | Все HTTP-роуты прокси API, шифрование credentials, сериализация, routing profile, subscription profiles |
| `back/src/db.js` (proxy-секция) | SQLite-таблицы и CRUD-функции для всех прокси-сущностей |
| `back/src/config.js` | Env-переменные для прокси (PROXY_*) |
| `back/src/telegram/handlers/proxy.js` | Telegram-бот: управление VPN-подписками (owner) |
| `back/src/request-guard.js` | Исключение `/api/proxy/node/` и `/api/proxy/sync/` из origin guard |
| `back/server.js` | Монтирование прокси-роутов, исключение sync из maintenance mode |

### Deploy / Ops

| Файл | Назначение |
|------|-----------|
| `deploy/proxy/setup-master-server.sh` | Полный setup мастер-сервера (Caddy + sing-box + Nginx + PM2 + sync) |
| `deploy/proxy/setup-proxy-node.sh` | Setup дочерней прокси-ноды (без Node.js сайта) |
| `deploy/proxy/Caddyfile.naive` | Шаблон конфигурации Caddy с NaiveProxy |
| `deploy/proxy/nginx-sni-router.conf` | Nginx stream конфиг: SNI-маршрутизация на порту 443 |
| `deploy/proxy/nginx-internal-qubite.conf` | Nginx http-конфиг для внутреннего прокси на :8080 |
| `deploy/proxy/singbox-reality-config.json` | Шаблон конфигурации sing-box для VLESS+Reality |
| `deploy/proxy/sync-caddy-credentials.mjs` | Агент синхронизации: забирает credentials из API, пишет в Caddy/sing-box/nginx |
| `deploy/proxy/proxy-node-heartbeat.mjs` | Heartbeat-скрипт: отправляет метрики ноды (CPU, RAM, диск, Caddy status) |
| `deploy/proxy/proxy-log-reporter.mjs` | Long-running сервис: tail'ит Caddy access log и отправляет трафик на API |
| `deploy/proxy/tc-fair-share.sh` | TC CAKE qdisc для fair-share bandwidth между клиентами |

### Фронтенд

| Файл | Назначение |
|------|-----------|
| `front/js/api.js` (proxy-секция) | API-клиент: 15+ функций для admin proxy management |
| `front/js/app.js` (proxy-секция) | UI: панель "Прокси" для owner — серверы, SNI-маршруты, подписки, логи |

### Документация

| Файл | Назначение |
|------|-----------|
| `docs/proxy/architecture.md` | Архитектура прокси-подсистемы |
| `docs/proxy/app-api.md` | Контракт API для клиентского приложения (desktop/mobile) |
| `docs/proxy/server-setup.md` | Инструкции по развёртыванию |

---

## База данных: таблицы

### `proxy_servers`

Реестр прокси-нод.

```sql
CREATE TABLE IF NOT EXISTS proxy_servers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT NOT NULL UNIQUE,              -- "PS-..." (публичный ID)
    name TEXT NOT NULL,                    -- "ru1", "Qubite Proxy"
    public_domain TEXT NOT NULL UNIQUE,    -- "proxy.qubiteapp.online"
    proxy_url TEXT NOT NULL,               -- "https://proxy.qubiteapp.online"
    ipv4_address TEXT DEFAULT '',          -- "193.233.91.128"
    ipv6_address TEXT DEFAULT '',          -- "2a01:e5c0:17bc::2"
    ipv4_domain TEXT DEFAULT '',           -- "proxy4.qubiteapp.online"
    ipv6_domain TEXT DEFAULT '',           -- "proxy6.qubiteapp.online"
    supports_ipv4 INTEGER DEFAULT 1,
    supports_ipv6 INTEGER DEFAULT 1,
    region TEXT DEFAULT '',                -- "eu-test"
    provider TEXT DEFAULT '',              -- "qubite"
    priority INTEGER DEFAULT 100,          -- меньше = предпочтительнее
    weight INTEGER DEFAULT 100,            -- для балансировки в одном priority
    status TEXT DEFAULT 'active',          -- active | disabled | maintenance
    health_status TEXT DEFAULT 'unknown',  -- online | degraded | unknown | pending
    node_token_hash TEXT DEFAULT '',       -- хеш токена для аутентификации ноды
    last_seen_at TEXT,
    last_heartbeat_at TEXT,
    metrics_json TEXT DEFAULT '{}',        -- JSON: CPU, RAM, диск, uptime, Caddy status
    last_error TEXT DEFAULT '',
    metadata_json TEXT DEFAULT '{}',       -- JSON: reality.publicKey, reality.shortId, reality.port
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
```

Индексы: `idx_proxy_servers_status_priority`, `idx_proxy_servers_token`.

### `proxy_sni_routes`

SNI-маршруты для маскарада (Reality/NaiveProxy через альтернативный SNI-домен).

```sql
CREATE TABLE IF NOT EXISTS proxy_sni_routes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT NOT NULL UNIQUE,
    server_id INTEGER DEFAULT NULL,       -- FK -> proxy_servers; NULL = все серверы
    route_domain TEXT NOT NULL UNIQUE,     -- "sni.proxy.qubiteapp.online"
    target_sni TEXT NOT NULL,             -- "www.cloudflare.com" (маскарад)
    redirect_url TEXT NOT NULL,           -- "https://www.cloudflare.com/" (для браузера без proxy)
    ip_family TEXT DEFAULT 'auto',        -- auto | ipv4 | ipv6
    status TEXT DEFAULT 'active',         -- active | disabled
    notes TEXT DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (server_id) REFERENCES proxy_servers (id) ON DELETE SET NULL
);
```

### `proxy_subscriptions`

VPN-подписки пользователей. Подписка привязана к user и определяет доступ к прокси.

```sql
CREATE TABLE IF NOT EXISTS proxy_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT NOT NULL UNIQUE,
    user_id INTEGER NOT NULL,             -- FK -> users
    token_hash TEXT NOT NULL UNIQUE,      -- хеш subscription token (для URL подписки)
    label TEXT DEFAULT '',                -- "vpn-username"
    status TEXT DEFAULT 'active',         -- active | disabled | revoked
    no_logs INTEGER DEFAULT 0,           -- no-log режим для подписки
    source TEXT DEFAULT 'site_user',      -- site_user | standalone_link
    is_vip INTEGER DEFAULT 0,            -- VIP-флаг (без ограничений скорости)
    speed_limit_mbps INTEGER DEFAULT NULL, -- лимит скорости (Mbps), NULL = без лимита
    max_connections INTEGER DEFAULT 3,    -- макс. устройств
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    expires_at TEXT DEFAULT NULL,         -- NULL = бессрочная
    revoked_at TEXT DEFAULT NULL,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
```

### `proxy_devices`

Зарегистрированные устройства пользователей.

```sql
CREATE TABLE IF NOT EXISTS proxy_devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT NOT NULL UNIQUE,              -- "PD-..." или client-generated ID
    user_id INTEGER NOT NULL,
    device_name TEXT DEFAULT '',           -- "Kirill Laptop"
    platform TEXT DEFAULT '',              -- "windows", "android", "subscription"
    app_version TEXT DEFAULT '',
    fingerprint_hash TEXT DEFAULT '',      -- хеш non-secret device fingerprint
    public_key TEXT DEFAULT '',
    status TEXT DEFAULT 'active',          -- active | revoked
    last_seen_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    revoked_at TEXT DEFAULT NULL,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
```

Unique-индекс по `(user_id, fingerprint_hash)` WHERE fingerprint_hash != ''.

### `proxy_sessions`

Short-lived прокси-сессии. Каждая сессия = одна пара username/password для Caddy.

```sql
CREATE TABLE IF NOT EXISTS proxy_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT NOT NULL UNIQUE,             -- "PXS-..."
    user_id INTEGER NOT NULL,
    device_id INTEGER NOT NULL,           -- FK -> proxy_devices
    server_id INTEGER NOT NULL,           -- FK -> proxy_servers
    username TEXT NOT NULL UNIQUE,        -- "qb_1_abc123" (unique login для Caddy)
    secret_hash TEXT NOT NULL,            -- хеш пароля
    secret_ciphertext TEXT DEFAULT '',    -- зашифрованный пароль (AES-256-GCM)
    previous_secret_hash TEXT,            -- предыдущий хеш (при rotate)
    ip_address TEXT DEFAULT '',
    user_agent TEXT DEFAULT '',
    status TEXT DEFAULT 'active',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,             -- TTL: по умолчанию 30 мин
    refresh_after_at TEXT NOT NULL,       -- когда нужно обновить: по умолчанию 10 мин
    revoked_at TEXT DEFAULT NULL,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    FOREIGN KEY (device_id) REFERENCES proxy_devices (id) ON DELETE CASCADE,
    FOREIGN KEY (server_id) REFERENCES proxy_servers (id) ON DELETE CASCADE
);
```

### `proxy_events`

Журнал событий прокси (регистрация устройств, старт/стоп сессий, heartbeat).

```sql
CREATE TABLE IF NOT EXISTS proxy_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER DEFAULT NULL,
    device_id INTEGER DEFAULT NULL,
    session_id INTEGER DEFAULT NULL,
    server_id INTEGER DEFAULT NULL,
    action TEXT NOT NULL,                 -- proxy.device.register, proxy.session.start, etc.
    severity TEXT DEFAULT 'info',
    ip_address TEXT DEFAULT '',
    user_agent TEXT DEFAULT '',
    details_json TEXT DEFAULT '{}',
    created_at TEXT NOT NULL
);
```

### `proxy_traffic_logs`

Телеметрия трафика (domain-level, без полных URL).

```sql
CREATE TABLE IF NOT EXISTS proxy_traffic_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT NOT NULL UNIQUE,
    user_id INTEGER DEFAULT NULL,
    device_id INTEGER DEFAULT NULL,
    session_id INTEGER DEFAULT NULL,
    server_id INTEGER DEFAULT NULL,
    destination_host TEXT DEFAULT '',      -- "example.com"
    destination_port INTEGER DEFAULT 0,
    action TEXT DEFAULT 'proxy',          -- proxy | direct
    transport TEXT DEFAULT '',            -- "https"
    request_count INTEGER DEFAULT 1,
    bytes_up INTEGER DEFAULT 0,
    bytes_down INTEGER DEFAULT 0,
    status_code INTEGER DEFAULT 0,
    app_version TEXT DEFAULT '',
    details_json TEXT DEFAULT '{}',
    created_at TEXT NOT NULL
);
```

Индексы: по server+time, user+time, host+time, created_at DESC.

### Поле в `users`

```sql
proxy_no_logs INTEGER NOT NULL DEFAULT 0  -- owner может включить no-log режим
```

---

## API-эндпоинты

### Клиентские (для приложения, требуют авторизацию + активную подписку)

| Метод | Путь | Назначение |
|-------|------|-----------|
| GET | `/api/proxy/servers` | Список доступных прокси-серверов |
| GET | `/api/proxy/catalog` | Каталог всех вариантов подключения (normal, ipv4, ipv6, sni) |
| GET | `/api/proxy/routing-profile` | Профиль split-tunneling (direct для .ru, локальных сетей) |
| GET | `/api/proxy/devices` | Список устройств пользователя |
| POST | `/api/proxy/devices/register` | Регистрация устройства |
| POST | `/api/proxy/devices/:deviceId/revoke` | Отзыв устройства |
| POST | `/api/proxy/session/start` | Начало прокси-сессии (получение credential) |
| POST | `/api/proxy/session/refresh` | Обновление credential сессии |
| POST | `/api/proxy/session/stop` | Остановка сессии |
| POST | `/api/proxy/events/heartbeat` | Heartbeat от клиентского приложения |
| POST | `/api/proxy/events/traffic` | Телеметрия трафика от клиента |
| GET | `/api/proxy/subscription/:token` | Subscription URL (NaiveProxy + VLESS URI) |

### Админские (owner only)

| Метод | Путь | Назначение |
|-------|------|-----------|
| GET | `/api/admin/proxy-servers` | Список серверов с admin-подробностями |
| POST | `/api/admin/proxy-servers` | Добавить прокси-ноду (возвращает node token) |
| PATCH | `/api/admin/proxy-servers/:uid` | Обновить настройки ноды |
| POST | `/api/admin/proxy-servers/:uid/rotate-token` | Перевыпустить node token |
| GET | `/api/admin/proxy-servers/:uid/stats` | Статистика трафика ноды |
| GET | `/api/admin/proxy-sni-routes` | Список SNI-маршрутов |
| POST | `/api/admin/proxy-sni-routes` | Добавить SNI-маршрут |
| PATCH | `/api/admin/proxy-sni-routes/:uid` | Обновить SNI-маршрут |
| DELETE | `/api/admin/proxy-sni-routes/:uid` | Удалить SNI-маршрут |
| GET | `/api/admin/proxy-subscriptions` | Список VPN-подписок |
| POST | `/api/admin/proxy-subscriptions` | Выдать подписку пользователю |
| POST | `/api/admin/proxy-subscription-links` | Создать standalone-ссылку (создаётся виртуальный user) |
| PATCH | `/api/admin/proxy-subscriptions/:uid` | Обновить подписку (статус, VIP, скорость, устройства) |
| POST | `/api/admin/proxy-subscriptions/:uid/renew` | Продлить подписку на N месяцев |
| DELETE | `/api/admin/proxy-subscriptions/:uid` | Удалить подписку |
| GET | `/api/admin/proxy-logs` | Логи трафика (фильтр по серверу, юзеру, хосту) |
| PATCH | `/api/admin/proxy-users/:userId/privacy` | Включить/выключить no-log для пользователя |

### Server-to-server (аутентификация по node token или PROXY_SYNC_TOKEN)

| Метод | Путь | Назначение |
|-------|------|-----------|
| GET | `/api/proxy/sync/credentials` | Sync agent забирает active credentials + SNI routes + Reality users |
| POST | `/api/proxy/node/heartbeat` | Heartbeat от прокси-ноды (метрики здоровья) |
| POST | `/api/proxy/node/traffic` | Трафик из Caddy access log (от log reporter) |

Эти endpoints исключены из origin guard в `request-guard.js` и из maintenance mode в `server.js`.

---

## Модель credential

```
user account -> proxy subscription -> registered device -> proxy session -> short-lived credential
```

- Subscription определяет **право доступа** к VPN
- Device — стабильный `deviceId`, генерируемый клиентским приложением
- Session — пара `username:password` для Caddy basic_auth, живёт ~30 минут
- При refresh старый пароль заменяется новым (rotate)
- Пароль хранится зашифрованным (AES-256-GCM) с ключом `PROXY_CREDENTIAL_ENCRYPTION_KEY`

### Subscription URL

Формат: `{APP_BASE_URL}/api/proxy/subscription/{token}`

Возвращает plain-text список URI:
- **NaiveProxy**: `naive+https://username:password@host:443?padding=true#label`
- **VLESS**: `vless://uuid@host:443?encryption=none&flow=xtls-rprx-vision&security=reality&sni=target&fp=chrome&pbk=key&sid=id&type=tcp#label`

Для каждого сервера генерируются варианты: default, ipv4, ipv6. Для SNI-маршрутов — дополнительные VLESS-записи с маскарадным SNI.

UUID для VLESS детерминированно выводится из `token_hash` подписки через SHA-1 (UUID v5-подобная схема).

---

## Шифрование credentials

```javascript
// Ключ: SHA-256 от PROXY_CREDENTIAL_ENCRYPTION_KEY
// Алгоритм: AES-256-GCM
// Формат хранения: "v1.{iv_base64url}.{tag_base64url}.{ciphertext_base64url}"

function encryptProxyCredential(secret) {
    const key = crypto.createHash("sha256").update(PROXY_CREDENTIAL_ENCRYPTION_KEY).digest();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    // ...
}
```

---

## Routing Profile (split-tunneling)

Клиентское приложение применяет правила **до** отправки трафика в прокси:

```javascript
{
    version: 1,
    defaultAction: "proxy",
    rules: [
        { action: "direct", type: "domainSuffix", values: [".ru", ".рф", ".su"] },
        { action: "direct", type: "domainSuffix", values: [
            ".gosuslugi.ru", ".nalog.gov.ru", ".mos.ru",
            ".sberbank.ru", ".tinkoff.ru", ".alfabank.ru",
            ".vk.com", ".yandex.ru", ".mail.ru"
        ]},
        { action: "direct", type: "cidr", values: [
            "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16",
            "127.0.0.0/8", "169.254.0.0/16",
            "::1/128", "fc00::/7", "fe80::/10"
        ]}
    ]
}
```

---

## Контроль доступа

- **Клиентские API** (`/api/proxy/*`): требуют авторизованного пользователя **и** активную подписку (`hasActiveProxySubscriptionForUser`). Owner имеет доступ без подписки.
- **Админские API** (`/api/admin/proxy-*`): только `requireOwner`.
- **Node API** (`/api/proxy/node/*`, `/api/proxy/sync/*`): аутентификация по Bearer token (node_token_hash или PROXY_SYNC_TOKEN).
- **No-log режим**: owner может включить `proxy_no_logs` для пользователя — тогда трафик-логи и proxy_events не записываются. Аналогично `no_logs` на уровне подписки.

---

## Sync-агент (`sync-caddy-credentials.mjs`)

Запускается по таймеру (каждые 30 секунд). Выполняет:

1. **Запрос к API**: `GET /api/proxy/sync/credentials` с Bearer PROXY_SYNC_TOKEN
2. **Обновление Caddy credentials**: записывает в `/etc/caddy/forwardproxy-credentials.caddy` строки `basic_auth "username" "password"` для всех активных сессий
3. **Обновление SNI-маршрутов**: записывает в `/etc/caddy/qubite-sni-routes.caddy` Caddy site-блоки для каждого SNI-домена с forward_proxy + redirect
4. **Обновление sing-box config**: генерирует `/etc/singbox/config.json` с inbound'ами VLESS+Reality (отдельный inbound на каждый целевой SNI, каждый на своём порту начиная с 18444)
5. **Обновление nginx SNI router**: генерирует `/etc/nginx/stream.d/sni-router.conf` с map-блоком, маршрутизирующим SNI-домены на соответствующие порты sing-box
6. **Перезагрузка сервисов**: `systemctl reload caddy-naive`, `systemctl restart singbox-reality`, `systemctl reload nginx`

### Данные от API

```json
{
    "credentials": [
        { "username": "qb_1_abc", "password": "secret", "expiresAt": "...", "domain": "..." }
    ],
    "sniRoutes": [
        { "domain": "sni.proxy.qubiteapp.online", "targetSni": "www.cloudflare.com", "redirectUrl": "https://www.cloudflare.com/", "ipFamily": "auto" }
    ],
    "realityUsers": [
        { "uuid": "derived-uuid", "isVip": false, "speedLimitMbps": null }
    ]
}
```

### VIP и скорость в sing-box

- Non-VIP пользователи с `speedLimitMbps` получают `speed_limit` в конфиге sing-box
- VIP пользователи не имеют ограничений скорости
- Дефолтный лимит задаётся через env `DEFAULT_SPEED_LIMIT_MBPS`

---

## Heartbeat-скрипт (`proxy-node-heartbeat.mjs`)

Запускается каждые 60 секунд по таймеру. Отправляет:

```json
{
    "health": "online",              // или "degraded" если Caddy не active
    "activeConnections": 42,         // из /proc/net/tcp
    "cpuLoad": 0.5,                  // os.loadavg()[0]
    "memoryUsedMb": 1024,
    "memoryTotalMb": 4096,
    "diskUsedPercent": 35,           // из df -P /
    "uptimeSeconds": 86400,
    "caddyActive": true              // systemctl is-active caddy-naive
}
```

---

## Log reporter (`proxy-log-reporter.mjs`)

Long-running демон. Tail'ит `/var/log/caddy/proxy-access.log` (Caddy JSON format):

1. Парсит каждую JSON-строку лога
2. Фильтрует только `CONNECT`-запросы (прокси-трафик)
3. Извлекает username из `Proxy-Authorization: Basic ...` заголовка
4. Агрегирует события по ключу `username:host`
5. Каждые 10 секунд (`REPORT_INTERVAL_MS`) отправляет batch на `POST /api/proxy/node/traffic`
6. При ошибке отправки — события возвращаются в буфер для следующей попытки
7. При ротации лога — автоматически переключается на новый файл

---

## TC fair-share (`tc-fair-share.sh`)

Опциональный bandwidth shaping через Linux Traffic Control с CAKE qdisc:

```bash
tc qdisc add dev eth0 root cake \
    bandwidth 1gbit \
    flowblind \       # чистый per-flow fairness
    nat \             # корректная обработка NAT
    wash \            # очистка DSCP (против priority gaming)
    ack-filter \
    no-split-gso
```

Управление: `systemctl enable --now qubite-tc-fair-share`.

---

## Конфигурация Caddy (`Caddyfile.naive`)

```caddyfile
{
    order forward_proxy before file_server
    admin 127.0.0.1:2019
    https_port 18443                    # за nginx SNI router
}

:18443, proxy.qubiteapp.online, proxy4.qubiteapp.online, proxy6.qubiteapp.online {
    tls { on_demand }
    route {
        forward_proxy {
            import /etc/caddy/forwardproxy-credentials.caddy   # basic_auth из sync
            hide_ip
            hide_via
            probe_resistance                                    # анти-probing
        }
        redir https://qubiteapp.ru{uri} 302                   # без credentials -> redirect
    }
    log {
        output file /var/log/caddy/proxy-access.log { roll_size 50mb; roll_keep 5 }
        format json
    }
}

import /etc/caddy/qubite-sni-routes.caddy                     # динамические SNI-блоки

https://qubiteapp.ru, https://www.qubiteapp.ru, ... {
    reverse_proxy localhost:8080                                # сайт
}
```

---

## Nginx SNI router (`nginx-sni-router.conf`)

```nginx
stream {
    map $ssl_preread_server_name $backend {
        ~\.qubiteapp\.online$     caddy_backend;
        ~\.qubiteapp\.ru$         caddy_backend;
        qubiteapp.online          caddy_backend;
        qubiteapp.ru              caddy_backend;
        ""                        caddy_backend;
        # Динамические SNI -> reality_XXXXX (по портам)
        default                   caddy_backend;    # fallback
    }

    upstream caddy_backend  { server 127.0.0.1:18443; }
    upstream reality_18444  { server 127.0.0.1:18444; }
    # ... (по одному upstream на каждый SNI target)

    server {
        listen 443;
        listen [::]:443;
        ssl_preread on;                   # читает SNI без расшифровки TLS
        proxy_pass $backend;
    }
}
```

sync-caddy-credentials.mjs динамически перегенерирует этот конфиг при каждой синхронизации, добавляя upstream'ы для каждого уникального target SNI.

---

## sing-box Reality (`singbox-reality-config.json`)

```json
{
    "inbounds": [
        {
            "type": "vless",
            "tag": "vless-reality-www-microsoft-com",
            "listen": "127.0.0.1",
            "listen_port": 18444,
            "users": [
                { "uuid": "derived-uuid", "flow": "xtls-rprx-vision", "speed_limit": "50 mbps" }
            ],
            "tls": {
                "enabled": true,
                "server_name": "www.microsoft.com",
                "reality": {
                    "enabled": true,
                    "handshake": { "server": "www.microsoft.com", "server_port": 443 },
                    "private_key": "...",
                    "short_id": ["deadbeef"]
                }
            }
        }
    ],
    "outbounds": [{ "type": "direct", "tag": "direct" }]
}
```

Для каждого уникального target SNI из `proxy_sni_routes` создаётся отдельный inbound на порту 18444+N.

---

## Telegram-бот: управление VPN

Файл: `back/src/telegram/handlers/proxy.js`

Owner-only меню "VPN-управление":

| Действие | Описание |
|----------|----------|
| VPN-подписки | Список всех подписок с пагинацией |
| Карточка подписки | Лейбл, юзер, статус, VIP, срок, скорость, устройства |
| Продлить на месяц | `renewProxySubscription(uid, 1)` |
| VIP toggle | Включить/снять VIP (без лимита скорости) |
| Скорость | Ввод лимита в Mbps (0 = без лимита) |
| Устройства | Ввод макс. количества устройств |
| Включить/Отключить | Toggle active/disabled + revoke сессий при отключении |

Все действия записываются в audit_log.

---

## Фронтенд: API-клиент (`front/js/api.js`)

15 функций для admin-панели:

| Функция | Endpoint |
|---------|----------|
| `loadAdminProxyServers()` | GET `/api/admin/proxy-servers` |
| `createAdminProxyServer(payload)` | POST `/api/admin/proxy-servers` |
| `updateAdminProxyServer(id, payload)` | PATCH `/api/admin/proxy-servers/:id` |
| `rotateAdminProxyServerToken(id)` | POST `/api/admin/proxy-servers/:id/rotate-token` |
| `loadAdminProxySniRoutes()` | GET `/api/admin/proxy-sni-routes` |
| `createAdminProxySniRoute(payload)` | POST `/api/admin/proxy-sni-routes` |
| `updateAdminProxySniRoute(id, payload)` | PATCH `/api/admin/proxy-sni-routes/:id` |
| `deleteAdminProxySniRoute(id)` | DELETE `/api/admin/proxy-sni-routes/:id` |
| `loadAdminProxySubscriptions()` | GET `/api/admin/proxy-subscriptions` |
| `createAdminProxySubscription(payload)` | POST `/api/admin/proxy-subscriptions` |
| `createAdminProxySubscriptionLink(payload)` | POST `/api/admin/proxy-subscription-links` |
| `renewAdminProxySubscription(id, months)` | POST `/api/admin/proxy-subscriptions/:id/renew` |
| `updateAdminProxySubscription(id, payload)` | PATCH `/api/admin/proxy-subscriptions/:id` |
| `deleteAdminProxySubscription(id)` | DELETE `/api/admin/proxy-subscriptions/:id` |
| `loadAdminProxyLogs(params)` | GET `/api/admin/proxy-logs` |
| `loadAdminProxyServerStats(id, hours)` | GET `/api/admin/proxy-servers/:id/stats` |
| `updateAdminProxyUserPrivacy(userId, noLogs)` | PATCH `/api/admin/proxy-users/:id/privacy` |

---

## Env-переменные для прокси

```env
# Основные
PROXY_PUBLIC_DOMAIN=proxy.qubiteapp.online    # дефолтный домен прокси
PROXY_DEFAULT_REGION=eu-test                   # регион по умолчанию

# Сессии
PROXY_SESSION_TTL_MS=1800000                   # 30 минут (мин: 5 мин, макс: 24 ч)
PROXY_REFRESH_AFTER_MS=600000                  # 10 минут (мин: 1 мин, макс: 1 ч)
PROXY_MAX_ACTIVE_DEVICES=3                     # макс. активных устройств (мин: 1, макс: 20)

# Безопасность
PROXY_CREDENTIAL_ENCRYPTION_KEY=<secret>       # ключ шифрования credentials (AES-256-GCM)
PROXY_SYNC_TOKEN=<secret>                      # токен для sync agent
```

---

## Deploy: два сценария

### Master server (`setup-master-server.sh`)

Полная установка: сайт + прокси на одном сервере.

1. Устанавливает Node.js, npm, nginx, Go, ufw, fail2ban
2. Собирает Caddy с NaiveProxy (`xcaddy build --with forwardproxy@naive`)
3. Устанавливает sing-box v1.13.5
4. Генерирует Reality keypair
5. Настраивает nginx: SNI router на :443, internal proxy на :8080
6. Настраивает Caddy: NaiveProxy на :18443
7. Настраивает sing-box: Reality на :18444+
8. Создаёт systemd-сервисы и таймеры
9. Настраивает PM2 для Node.js приложения
10. Открывает порты 22, 80, 443 в ufw

### Proxy node (`setup-proxy-node.sh`)

Дочерняя прокси-нода без сайта:

1. Устанавливает nginx, Go, Node.js (для sync-скриптов)
2. Собирает Caddy с NaiveProxy
3. Устанавливает sing-box
4. Генерирует Reality keypair
5. Настраивает nginx SNI router
6. Настраивает Caddy (redirect на main site domain)
7. Настраивает sing-box
8. Создаёт systemd-сервисы: sync (каждые 30с), heartbeat (каждые 60с), log-reporter (long-running)
9. Секреты хранятся в `/etc/qubite/proxy-node.env` (chmod 600)

### Systemd-сервисы

| Сервис | Тип | Назначение |
|--------|-----|-----------|
| `caddy-naive.service` | long-running | Caddy с NaiveProxy (порт 18443) |
| `singbox-reality.service` | long-running | sing-box VLESS+Reality (порт 18444+) |
| `qubite-proxy-sync.timer` | timer (30с) | Синхронизация credentials |
| `qubite-proxy-heartbeat.timer` | timer (60с) | Heartbeat метрики |
| `qubite-proxy-log-reporter.service` | long-running | Tail Caddy access log и отправка трафика |
| `qubite-tc-fair-share.service` | oneshot (optional) | TC CAKE fair-share bandwidth |

---

## Приватность и логирование

- Qubite **не делает MITM** HTTPS-трафика
- Телеметрия только на уровне домена: `destination_host`, `request_count`, `bytes_up/down`
- Полные URL, query strings, заголовки, cookies, тела запросов **не собираются**
- Owner может включить `proxy_no_logs` для пользователя — тогда proxy_events и proxy_traffic_logs не записываются
- Подписка может иметь `no_logs = 1` — аналогичный эффект
- Heartbeat серверных нод не привязан к browsing-данным пользователей

---

## Multi-server deployment

1. Owner добавляет прокси-ноду в UI-панели -> получает node token
2. На VPS запускается `setup-proxy-node.sh` с этим token
3. Нода каждые 30с синхронизирует credentials с мастера
4. Каждые 60с отправляет heartbeat с метриками здоровья
5. Caddy access log tail'ится и трафик отправляется на мастер
6. Клиентское приложение получает список серверов через `GET /api/proxy/servers`
7. Выбор сервера: prefer lower priority -> weight-based -> fallback при ошибке

---

## IPv4/IPv6

- Поддержка dual-stack: отдельные домены для IPv4 (`proxy4.*`) и IPv6 (`proxy6.*`)
- Стратегия клиента: Happy Eyeballs (попробовать лучшую family, быстрый fallback)
- Каталог разделяет варианты: `ru1` (default), `ru1-ip4`, `ru1-ip6`
- UFW настраивается с `IPV6=yes`, порты открываются для обоих семейств
