# Конфигурация и проверки

Только имена env из исходников; значения .env не извлекались. Динамические префиксы SEARCH_<TIER>_* и ключи через config могут не попасть в список.

| Имя | Источники |
|---|---|
| `ALLOWED_HOSTS` | `back/src/config.js` |
| `ALLOWED_ORIGINS` | `back/src/config.js` |
| `APP_BASE_URL` | `back/src/config.js`, `back/tests/auth-surface.test.js`, `back/tests/siyuan.test.js` |
| `AUTH_INVITE_ONLY` | `back/server.js` |
| `AUTH_PORT` | `back/src/config.js` |
| `BOT_TOKEN` | `services/specbot/config.py` |
| `CADDY_ACCESS_LOG` | `deploy/proxy/proxy-log-reporter.mjs` |
| `CADDY_FORWARDPROXY_CREDENTIALS` | `deploy/proxy/sync-caddy-credentials.mjs` |
| `CADDY_HTTPS_PORT` | `deploy/proxy/sync-caddy-credentials.mjs` |
| `CADDY_SNI_ROUTES_OUTPUT` | `deploy/proxy/sync-caddy-credentials.mjs` |
| `DAILY_BUDGET_USD` | `services/search/app.py`, `services/specbot/config.py` |
| `DATABASE_PATH` | `back/src/config.js`, `back/tests/services.test.js`, `back/tests/telegram-runtime.test.js`, `back/tests/telegram-services.test.js`, `back/tests/writing.test.js` |
| `DATA_DIR` | `services/search/app.py`, `services/specbot/config.py` |
| `DEFAULT_SPEED_LIMIT_MBPS` | `deploy/proxy/sync-caddy-credentials.mjs` |
| `EMAIL_DELIVERY_MODE` | `back/src/config.js` |
| `EMAIL_FROM` | `back/src/config.js` |
| `EMAIL_REPLY_TO` | `back/src/config.js` |
| `FLEX_TIMEOUT` | `services/specbot/config.py` |
| `GOOGLE_CALLBACK_URL` | `back/src/config.js` |
| `GOOGLE_CLIENT_ID` | `back/src/config.js` |
| `GOOGLE_CLIENT_SECRET` | `back/src/config.js` |
| `GUEST_DAILY_AI_LIMIT` | `services/search/app.py` |
| `GUEST_HOURLY_AI_LIMIT` | `services/search/app.py` |
| `HEADERS_TIMEOUT_MS` | `back/src/config.js` |
| `HEAVY_JSON_BODY_LIMIT` | `back/src/config.js` |
| `HOST` | `back/src/config.js` |
| `IMPORT_JSON_BODY_LIMIT` | `back/src/config.js` |
| `INITIAL_OWNER_EMAIL` | `back/scripts/invite-owner.js`, `back/src/config.js` |
| `JSON_BODY_LIMIT` | `back/src/config.js` |
| `KEEP_ALIVE_TIMEOUT_MS` | `back/src/config.js` |
| `KNOWLEDGE_MANAGEMENT_SOCKET` | `back/src/auth-surface.js`, `back/src/knowledge-enrollment.js`, `back/tests/knowledge-enrollment.test.js` |
| `KWORK_BOT_ROOT` | `integrations/kwork/kwork_bot.py`, `integrations/kwork/kwork_brief.py`, `integrations/kwork/kwork_parser.py` |
| `LANGUAGETOOL_URL` | `back/src/writing.js`, `back/tests/writing.test.js` |
| `MAX_REQUESTS_PER_SOCKET` | `back/src/config.js` |
| `NGINX_STREAM_CONF` | `deploy/proxy/sync-caddy-credentials.mjs` |
| `NODE_APP_INSTANCE` | `back/src/telegram-bot.js` |
| `NODE_ENV` | `back/src/config.js` |
| `OAUTH_GOOGLE_ENABLED` | `back/src/config.js` |
| `OAUTH_TELEGRAM_ENABLED` | `back/src/config.js` |
| `OAUTH_VK_ENABLED` | `back/src/config.js` |
| `OAUTH_YANDEX_ENABLED` | `back/src/config.js` |
| `OPENROUTER_API_KEY` | `services/search/app.py`, `services/specbot/config.py` |
| `OWNER_ID` | `services/specbot/config.py` |
| `OWNER_USER` | `services/search/app.py` |
| `PORT` | `back/src/config.js` |
| `PRIMARY_TIMEOUT` | `services/specbot/config.py` |
| `PROXY_CREDENTIAL_ENCRYPTION_KEY` | `back/src/config.js` |
| `PROXY_DEFAULT_REGION` | `back/src/config.js` |
| `PROXY_MAX_ACTIVE_DEVICES` | `back/src/config.js` |
| `PROXY_NODE_TOKEN` | `deploy/proxy/proxy-log-reporter.mjs`, `deploy/proxy/proxy-node-heartbeat.mjs` |
| `PROXY_PUBLIC_DOMAIN` | `back/src/config.js` |
| `PROXY_REFRESH_AFTER_MS` | `back/src/config.js` |
| `PROXY_SECRET` | `services/search/app.py` |
| `PROXY_SESSION_TTL_MS` | `back/src/config.js` |
| `PROXY_SYNC_TOKEN` | `back/src/config.js`, `deploy/proxy/proxy-log-reporter.mjs`, `deploy/proxy/proxy-node-heartbeat.mjs`, `deploy/proxy/sync-caddy-credentials.mjs` |
| `PUBLIC_HOST` | `back/src/config.js` |
| `QUBITE_EVENT_SOCKET_DIR` | `back/src/process-events.js`, `back/tests/process-events.test.js` |
| `QUBITE_HOST` | `services/search/app.py` |
| `QUBITE_INTERNAL_URL` | `services/search/app.py` |
| `QUBITE_PROCESS_ROLE` | `back/server.js`, `back/src/config.js`, `back/src/service-runtime.js`, `back/src/telegram/notifier.js` |
| `QUBITE_PROXY_HEARTBEAT_URL` | `deploy/proxy/proxy-node-heartbeat.mjs` |
| `QUBITE_PROXY_SYNC_STATE_DIR` | `deploy/proxy/sync-caddy-credentials.mjs` |
| `QUBITE_PROXY_SYNC_URL` | `deploy/proxy/sync-caddy-credentials.mjs` |
| `QUBITE_PUBLIC_URL` | `services/search/app.py` |
| `QUBITE_SEARCH_API_KEY` | `integrations/qubite-search/skills/qubite-search/scripts/qubite_api.py` |
| `QUBITE_SEARCH_API_URL` | `integrations/qubite-search/skills/qubite-search/scripts/qubite_api.py` |
| `QUBITE_SEARCH_CONFIG` | `integrations/qubite-search/skills/qubite-search/scripts/qubite_api.py` |
| `QUBITE_SEARCH_HOST_HEADER` | `integrations/qubite-search/skills/qubite-search/scripts/qubite_api.py` |
| `QUBITE_TRAFFIC_URL` | `deploy/proxy/proxy-log-reporter.mjs` |
| `QUBITE_USER` | `deploy/runtime-manager.py` |
| `REALITY_BASE_PORT` | `deploy/proxy/sync-caddy-credentials.mjs` |
| `REALITY_PRIVATE_KEY` | `deploy/proxy/sync-caddy-credentials.mjs` |
| `REALITY_PUBLIC_KEY` | `back/src/config.js`, `deploy/proxy/proxy-node-heartbeat.mjs` |
| `REALITY_SHORT_ID` | `back/src/config.js`, `deploy/proxy/proxy-node-heartbeat.mjs`, `deploy/proxy/sync-caddy-credentials.mjs` |
| `REALITY_TARGET_SNI` | `deploy/proxy/proxy-node-heartbeat.mjs` |
| `REPORT_INTERVAL_MS` | `deploy/proxy/proxy-log-reporter.mjs` |
| `REQUEST_TIMEOUT_MS` | `back/src/config.js` |
| `RESEND_API_KEY` | `back/src/config.js` |
| `RUNTIME_MANAGEMENT_SOCKET` | `back/src/service-runtime.js` |
| `SEARCH_DAILY_BUDGET_USD` | `back/src/services.js` |
| `SEARCH_FREE_FALLBACK_MODEL` | `services/search/app.py` |
| `SEARCH_FREE_FALLBACK_PROVIDERS` | `services/search/app.py` |
| `SEARCH_INTERNAL_URL` | `back/src/services.js` |
| `SEARCH_JEV_MODEL` | `services/search/app.py`, `services/search/grounding.py` |
| `SEARCH_PUBLIC_URL` | `services/search/app.py` |
| `SEARXNG_URL` | `services/search/app.py` |
| `SEED_DEMO_DATA` | `back/src/config.js` |
| `SEND_PDF_TO_CLIENT` | `services/specbot/config.py` |
| `SERVICES_INTERNAL_KEY` | `back/src/services.js`, `services/search/app.py` |
| `SERVICES_MEMOS_BASE_URL` | `back/src/knowledge-services.js` |
| `SERVICES_SEARCH_BASE_URL` | `back/src/service-api.js`, `back/src/services.js`, `back/tests/auth-surface.test.js` |
| `SERVICES_SIYUAN_BASE_URL` | `back/src/siyuan.js`, `back/tests/siyuan.test.js` |
| `SERVICES_VAULT_BASE_URL` | `back/src/services.js`, `back/src/vault-integration.js` |
| `SERVICES_VIKUNJA_BASE_URL` | `back/src/knowledge-services.js`, `back/tests/auth-surface.test.js` |
| `SERVICES_VPN_ENABLED` | `back/src/proxy/availability.js`, `back/src/proxy/routes.js`, `back/tests/services.test.js` |
| `SESSION_BUDGET_USD` | `services/specbot/config.py` |
| `SESSION_COOKIE_DOMAIN` | `back/server.js` |
| `SESSION_COOKIE_NAME` | `back/src/config.js` |
| `SESSION_TOUCH_INTERVAL_MS` | `back/src/config.js` |
| `SINGBOX_REALITY_CONFIG` | `deploy/proxy/sync-caddy-credentials.mjs` |
| `SIYUAN_PRIVATE_FILE` | `back/src/services.js`, `back/src/siyuan.js`, `back/tests/siyuan.test.js` |
| `SPECBOT_ENV` | `services/specbot/bot.py` |
| `SQLITE_BUSY_TIMEOUT_MS` | `back/src/config.js` |
| `STANDARD_TIMEOUT` | `services/specbot/config.py` |
| `STT_PYTHON` | `services/specbot/config.py` |
| `STT_SCRIPT` | `services/specbot/config.py` |
| `SUDO_USER` | `deploy/services/configure.py` |
| `TELEGRAM_BOT_TOKEN` | `back/src/config.js` |
| `TELEGRAM_ENABLED` | `back/src/config.js` |
| `TELEGRAM_MODERATOR_IDS` | `back/src/config.js` |
| `TELEGRAM_OWNER_ID` | `back/src/config.js` |
| `TRUST_PROXY` | `back/src/config.js` |
| `TURNSTILE_DEV_BYPASS` | `back/src/config.js` |
| `TURNSTILE_SECRET_KEY` | `back/src/config.js` |
| `TURNSTILE_SITE_KEY` | `back/src/config.js` |
| `TURNSTILE_VERIFY_URL` | `back/src/config.js` |
| `VAULT_MANAGEMENT_SOCKET` | `back/src/services.js`, `back/src/vault-integration.js` |
| `VAULT_ORIGIN_CA` | `back/src/vault-integration.js` |
| `VAULT_ORIGIN_PORT` | `back/src/vault-integration.js` |
| `VK_APP_ID` | `back/src/config.js` |
| `VK_CALLBACK_URL` | `back/src/config.js` |
| `VK_CLIENT_ID` | `back/src/config.js` |
| `VK_CLIENT_SECRET` | `back/src/config.js` |
| `VPN_APP_TOKEN` | `back/src/config.js` |
| `WAYLAND_DISPLAY` | `integrations/qubite-writing/linux.py` |
| `WRITING_DAILY_BUDGET_RUB` | `back/src/writing.js` |
| `WRITING_KEY_FILE` | `back/src/writing.js` |
| `WRITING_OPENROUTER_API_KEY` | `back/src/writing.js` |
| `WRITING_RATE_DATE` | `back/src/writing.js` |
| `WRITING_RUB_PER_USD` | `back/src/writing.js` |
| `YANDEX_CALLBACK_URL` | `back/src/config.js` |
| `YANDEX_CLIENT_ID` | `back/src/config.js` |
| `YANDEX_CLIENT_SECRET` | `back/src/config.js` |

## Файлы тестов

- `back/tests/auth-config.test.js`
- `back/tests/auth-http.test.js`
- `back/tests/auth-surface.test.js`
- `back/tests/knowledge-api.test.js`
- `back/tests/knowledge-enrollment.test.js`
- `back/tests/process-events.test.js`
- `back/tests/services.test.js`
- `back/tests/siyuan.test.js`
- `back/tests/telegram-runtime.test.js`
- `back/tests/telegram-services.test.js`
- `back/tests/writing-addon.test.js`
- `back/tests/writing.test.js`
- `deploy/services/tests/test_knowledge_manager.py`
- `deploy/services/tests/test_merge.py`
- `deploy/services/tests/test_runtime_manager.py`
- `integrations/kwork/tests/test_kwork_bot.py`
- `integrations/kwork/tests/test_kwork_brief.py`
- `integrations/kwork/tests/test_kwork_negotiation.py`
- `integrations/kwork/tests/test_kwork_notify.py`
- `integrations/kwork/tests/test_kwork_runner.py`
- `integrations/qubite-siyuan/tests/test_scope.py`
- `services/search/tests/test_engines.py`
- `services/search/tests/test_grounding.py`
- `services/search/tests/test_media.cjs`
- `services/search/tests/test_rules.py`
- `services/specbot/tests/test_bot.py`
- `services/specbot/tests/test_bridge.py`
- `services/specbot/tests/test_leads.py`
- `services/specbot/tests/test_negotiation.py`
