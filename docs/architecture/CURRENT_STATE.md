# Текущее состояние (аудит на 17.10.2026)

Этот документ честно описывает, **что есть в репозитории прямо сейчас**. Пометки:

- **ПРОВЕРЕНО КОДОМ** — посмотрено в исходниках или подтверждено запуском тестов;
- **УКАЗАНО В DOCS** — написано в старой документации, в коде отдельно не проверялось;
- **ТРЕБУЕТ ПРОВЕРКИ НА СЕРВЕРЕ** — нельзя подтвердить локально (Raspberry Pi может отличаться от git);
- **ПРЕДЛОЖЕНИЕ** — что с этим делать.

## 1. Коротко

| Что | Состояние |
|---|---|
| Новый Qubite (Rust/React/Tauri/Kotlin) | **Кода нет.** Есть только эта документация. |
| Старый Qubite | Весь лежит в [`legacy/qubite-v1/`](../../legacy/qubite-v1/) одним деревом, код не менялся. ПРОВЕРЕНО КОДОМ |
| Тесты старого кода | **321 тест проходит** из нового места (17.10.2026). ПРОВЕРЕНО КОДОМ |
| Работа Codex (FastAPI-ядро, React-оболочка, 28 ADR) | В ветке `codex`, не используется ([D-001](../product/DECISIONS.md)) |
| Архив старой версии | Ветка `tournaments` и тег `qubite-v1.0` → коммит `96f0457` |
| Production | Старый Qubite работает на Raspberry Pi через Cloudflare Tunnel на `qubiteapp.online` ([D-009](../product/DECISIONS.md)). Какой коммит там развёрнут — ТРЕБУЕТ ПРОВЕРКИ НА СЕРВЕРЕ |

> ⚠️ **Важно для сервера.** Если на Raspberry Pi старый Qubite запущен из git-клона этого репозитория, **не делайте там `git pull` ветки `main`**: файлы переехали в `legacy/qubite-v1/`, и пути сервисов (systemd, PM2, Caddy) сломаются. На сервере оставьте ветку `tournaments` или тег `qubite-v1.0`, пока новый установщик не готов.

## 2. Структура репозитория сейчас

```text
qubite/
├── README.md, AGENTS.md, CLAUDE.md, SECURITY.md, .env.example   ← новые, про Qubite 2.0
├── docs/                    ← новая документация
│   └── context/             ← исходное видение и переписка с Codex (не редактируются)
├── legacy/
│   ├── README.md            ← карта старого кода и что с ним будет
│   └── qubite-v1/           ← весь старый проект, как был
│       ├── back/            Node.js + Express 5 + SQLite (сервер)
│       ├── front/           HTML/CSS/JS-клиент
│       ├── *.html           страницы (index, about, privacy, terms, 404 …)
│       ├── services/        search (FastAPI), specbot (Telegram-бот, Python)
│       ├── integrations/    kwork, qubite-search MCP, qubite-writing (Firefox), knowledge, siyuan
│       ├── deploy/          установщик, nginx, proxy/VPN, firewall, cloudflare
│       ├── app/qubite_vpn/  Flutter-клиент VPN
│       └── docs/            старая документация
└── assets/                  ← дизайн-лаборатория Codex (не в git, решение позже)
```

## 3. Старый сервер (`legacy/qubite-v1/back/`)

ПРОВЕРЕНО КОДОМ.

| Что | Факт |
|---|---|
| Стек | Node.js 22, Express 5, `sqlite3`, `xlsx`, CommonJS |
| Размер | `server.js` ≈ 9 900 строк, `src/db.js` ≈ 9 200 строк (монолиты) |
| HTTP-маршруты | ≥ 126 (`app.get/post/…`): admin 21, auth 20, support 8, team 7, organizer 6, tournaments 5, rating 4, profile 4, moderation 3 и др. + маршруты прокси/сервисов в отдельных модулях |
| Таблицы SQLite (34) | `users`, `sessions`, `auth_challenges`, `password_reset_tickets`, `oauth_states`, `blocked_emails`, `ip_blocklist`, `email_logs`, `audit_log`, `system_settings`, `system_stats_history`, `site_visits`, `tournaments`, `tournament_tasks`, `tournament_task_drafts`, `tournament_task_progress`, `tournament_entries`, `tournament_submissions`, `tournament_roster_entries`, `tournament_helper_codes`, `task_bank`, `teams`, `team_members`, `rating_changes`, `organizer_applications`, `support_chats`, `support_messages`, `telegram_access`, `proxy_servers`, `proxy_devices`, `proxy_sessions`, `proxy_subscriptions`, `proxy_sni_routes`, `proxy_events`, `proxy_traffic_logs` |
| Роли | `user`, `organizer`, `moderator`, `admin`, `owner` — **глобальные** (в новом Qubite так нельзя, см. [AUTH_AND_PERMISSIONS](AUTH_AND_PERMISSIONS.md)) |
| Тумблеры (`system_settings`) | `registration_enabled`, `maintenance_mode`, `email_enabled`, `oauth_google/yandex/vk/telegram_enabled`, `tournament_creation_enabled`, `tournament_participation_enabled`, `proxy_naive_enabled` |
| Вход | Пароль, коды на почту, OAuth Google/Яндекс/VK (PKCE)/Telegram, Turnstile CAPTCHA, `INITIAL_OWNER_EMAIL` для первого owner |
| Турниры | Задачи `single_choice`, `multiple_choice`, `short_text`, `number`; команды; рейтинг Elo (старт 1200, K = max(16, 48 − r/100), звания от «Новичка» до «Легенды»); импорт задач из Excel; витрина с `catalog_visible` |
| Процессы | `QUBITE_PROCESS_ROLE`: platform / auth; отдельный `telegram-worker.js`; Unix-сокеты событий между процессами |
| Telegram-бот | Owner + модераторы: настройки, аналитика, модерация, админка, доступы, сервисы, runtime, VPN, поддержка |
| Сервисы через ядро | Гранты на Search/Writing/VPN/Vault/Memos/Vikunja/SiYuan, приглашения на сервисы, API-ключи поиска |
| Переменные окружения | ≈ 90 (только названия): `HOST`, `PORT`, `DATABASE_PATH`, `APP_BASE_URL`, `SESSION_COOKIE_*`, `TURNSTILE_*`, `GOOGLE_*`, `YANDEX_*`, `VK_*`, `TELEGRAM_*`, `OAUTH_*_ENABLED`, `PROXY_*`, `REALITY_*`, `WRITING_*`, `SEARCH_*`, `SERVICES_*`, `VAULT_*`, `RESEND_API_KEY`, `EMAIL_*` и др. |

## 4. Старые сервисы

| Сервис | Где | Стек | Тесты (17.10.2026) | Что будет |
|---|---|---|---|---|
| Search | `services/search/` | Python FastAPI + SQLite + SearXNG; веб-интерфейс; API-ключи; grounding (Jev), аналитика | 95 ✓ | Переписать на Rust как модуль `search` ([D-005](../product/DECISIONS.md)) |
| Search MCP/skill | `integrations/qubite-search/` | Python MCP | — | Войдёт в общий MCP Qubite |
| Writing | `back/src/writing.js`, `back/public/writing.*`, `integrations/qubite-writing/` (расширение Firefox) | Node + LanguageTool + OpenRouter (Haiku) | входит в Node-тесты | Переписать как модуль `writer` |
| Specbot | `services/specbot/` | Python Telegram-бот: интервью → PDF-ТЗ, лиды, переговоры | 112 ✓ (с `PYTHONPATH` к kwork) | Переписать как часть модуля `kwork` |
| Kwork | `integrations/kwork/` | Python парсер, бот, brief, переговоры, лиды; Telethon | 29 ✓ | Переписать как модуль `kwork` |
| VPN/Proxy | `back/src/proxy/`, `deploy/proxy/` | sing-box Reality, NaiveProxy/Caddy, ноды с heartbeat | входит в Node-тесты | Переписать как модуль `vpn` |
| VPN-клиент | `app/qubite_vpn/` | Flutter (Android/Linux/Windows/macOS) | не запускались | Образец; клиент VPN войдёт в новое приложение ([D-103](../product/DECISIONS.md)) |
| Vault | `back/src/vault-integration.js`, `deploy/vault-manager.py` | AliasVault + root-менеджер | входит в Node/Python-тесты | Модуль `vault`, P3 |
| Knowledge | `back/src/knowledge-*.js`, `integrations/qubite-knowledge/` | Memos + Vikunja | входит в Node-тесты | Не переносится ([D-100](../product/DECISIONS.md)) |
| SiYuan | `back/src/siyuan.js`, `integrations/qubite-siyuan/` | SiYuan | 5 ✓ | Не переносится ([D-102](../product/DECISIONS.md)) |
| Установщик сервисов | `deploy/services/` | Python | 18 ✓ | Новый установщик пишется с нуля |

### Как запускались тесты (для повторения)

```bash
cd legacy/qubite-v1
(cd back && npm ci) && node --test back/tests/*.test.js            # 62
python3 -m unittest discover -s deploy/services/tests                # 18
(cd services/search && uv run --no-project --with pytest --with-requirements requirements.txt python -m pytest -q)   # 95
(cd services/specbot && PYTHONPATH=../../integrations/kwork uv run --no-project --with pytest --with requests --with telethon --with pypdf --with-requirements requirements.txt python -m pytest -q)  # 112
(cd integrations/kwork && uv run --no-project --with pytest --with httpx --with requests --with telethon --with pypdf python -m pytest -q)  # 29
(cd integrations/qubite-siyuan && uv run --no-project --with pytest --with httpx python -m pytest -q)  # 5
```

## 5. Развёртывание старого Qubite

УКАЗАНО В DOCS + частично ПРОВЕРЕНО КОДОМ (`legacy/qubite-v1/deploy/`):

- Raspberry Pi, Node под PM2/systemd, Nginx или Caddy, Cloudflare Tunnel; установщик `deploy/install.sh` находит корень репозитория относительно себя, поэтому работает и из `legacy/qubite-v1/`.
- Отдельные Unix-сокеты для root-менеджеров (runtime, vault, knowledge).
- Прокси-ноды VPN: `deploy/proxy/setup-proxy-node.sh`, heartbeat на мастер.
- Firewall (nftables/UFW), sysctl-ужесточение.

ТРЕБУЕТ ПРОВЕРКИ НА СЕРВЕРЕ: модель и RAM Raspberry Pi, какой коммит развёрнут, какие сервисы реально запущены, где бэкапы.

## 6. Расхождения и долги

| Проблема | Где | Что делаем |
|---|---|---|
| Глобальные турнирные роли (`organizer`, `moderator`, `admin`) смешаны с владельцем платформы | `back/` | В новом Qubite турнирные роли — только внутри модуля |
| Огромные файлы `server.js`, `db.js`, `app.js` (≈ 17 500 строк) | `back/`, `front/` | Не рефакторим: переписываем модулями |
| Тесты Specbot требуют `PYTHONPATH` к Kwork | `services/specbot` | Учесть при переписывании (общая библиотека) |
| `npm test` не запускает тесты | `back/package.json` | Не трогаем legacy; в новом проекте единая команда тестов |
| Бюджеты AI раздельные и в разных валютах (`SEARCH_DAILY_BUDGET_USD`, `WRITING_DAILY_BUDGET_RUB`) | `back/`, `services/search` | В новом Qubite — единый AI-шлюз в USD ([D-071](../product/DECISIONS.md)) |

## 7. ShadeAI (соседний проект, только чтение)

`~/programing/ShadeAI/` — ПРОВЕРЕНО КОДОМ (структура и README, без изменений):

- Локальный AI для умного дома на Raspberry Pi 5 (4 ГБ), «zero-cloud».
- `core/` — Python FastAPI (Shade Core), `android/` — Kotlin/Compose, `web/` — TypeScript, `docs/` — API-спецификация.
- REST API v0.1: `GET /health`, `POST/GET /notifications`, временный `POST /ha/action`; в планах `/devices`, `/habits`, `/automations`, `/events`, `/config`, `/voice`.
- Состояние: скелет, из 27 задач его плана выполнены 2; LLM и аналитика — заглушки.
- Будущее: Shade AI войдёт в модуль **Qubite Home** (Home Assistant + Shade AI, Qubite как интерфейс и источник данных) — [QUBITE_HOME.md](../product/QUBITE_HOME.md). Код ShadeAI из Qubite не импортируем; дорабатывается в своём репозитории.
