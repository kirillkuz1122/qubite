# legacy — старый Qubite

Здесь лежит **старый код**. Новый Qubite его **не импортирует** и не зависит от него ([ADR-0002](../docs/architecture/decisions/0002-legacy-freeze-and-repo-layout.md)). Код нужен как образец при переписывании модулей и чтобы старую версию можно было запустить.

## Что внутри

`qubite-v1/` — весь прежний репозиторий, перенесённый **одним деревом без изменений кода** 17.10.2026 (коммит переноса — «Старый Qubite перенесён в legacy/qubite-v1»). Относительные пути, установщик и тесты работают из этой папки.

| Часть | Путь | Что это | Судьба в новом Qubite |
|---|---|---|---|
| Сайт и турниры | `qubite-v1/back/`, `front/`, `index.html` | Node.js + Express + SQLite: турниры, команды, рейтинг, админка, бот | Модуль `tournaments` — переписать (P3, [D-006](../docs/product/DECISIONS.md)) |
| Страницы | `qubite-v1/*.html` | about, privacy, terms, security, acceptable-use, support, 404, maintenance | Новые юридические страницы пишутся заново (AUTH-005) |
| Search | `qubite-v1/services/search/`, `integrations/qubite-search/` | FastAPI + SearXNG, MCP | EPIC-SEARCH — переписать на Rust |
| Writing | `qubite-v1/back/src/writing.js`, `integrations/qubite-writing/` | LanguageTool + AI, расширение Firefox | EPIC-WRITER — переписать |
| Specbot, Kwork | `qubite-v1/services/specbot/`, `integrations/kwork/` | Telegram-боты, брифы, лиды, переговоры | EPIC-KWORK — переписать |
| VPN | `qubite-v1/back/src/proxy/`, `deploy/proxy/`, `app/qubite_vpn/` (Flutter) | Ноды, подписки, клиент | EPIC-VPN — переписать |
| Vault | `qubite-v1/back/src/vault-integration.js`, `deploy/vault-manager.py` | AliasVault | EPIC-VAULT (P3) |
| Telegram-бот платформы | `qubite-v1/back/src/telegram/` | Управление, уведомления, поддержка | CMD-006 + эпики |
| Knowledge | `qubite-v1/back/src/knowledge-*.js`, `integrations/qubite-knowledge/` | Memos + Vikunja | **Не переносится** ([D-100](../docs/product/DECISIONS.md)) |
| SiYuan | `qubite-v1/back/src/siyuan.js`, `integrations/qubite-siyuan/` | — | **Не переносится** ([D-102](../docs/product/DECISIONS.md)) |
| Деплой | `qubite-v1/deploy/` | install.sh, nginx, Caddy, proxy, firewall, Cloudflare | Новый установщик пишется с нуля (OPS-001) |
| Документация | `qubite-v1/docs/`, `AGENTS.md`, `README.md`, `SECURITY.md`, `TODO.md` | Старые описания | Справка |

Заполненные `.env` (не в git): `qubite-v1/.env`, `qubite-v1/deploy/.env`.

## ⚠️ Сервер

Если старый Qubite на Raspberry Pi запущен из git-клона, **не делайте там `git pull` ветки `main`**: пути изменились. Сервер должен оставаться на ветке `tournaments` или теге `qubite-v1.0` до перехода на новый Qubite ([DEPLOYMENT](../docs/engineering/DEPLOYMENT.md)).

## Запуск тестов старого кода

```bash
cd legacy/qubite-v1
(cd back && npm ci) && node --test back/tests/*.test.js                  # 62
python3 -m unittest discover -s deploy/services/tests                    # 18
(cd services/search && uv run --no-project --with pytest --with-requirements requirements.txt python -m pytest -q)   # 95
(cd services/specbot && PYTHONPATH=../../integrations/kwork uv run --no-project --with pytest --with requests --with telethon --with pypdf --with-requirements requirements.txt python -m pytest -q)  # 112
(cd integrations/kwork && uv run --no-project --with pytest --with httpx --with requests --with telethon --with pypdf python -m pytest -q)  # 29
(cd integrations/qubite-siyuan && uv run --no-project --with pytest --with httpx python -m pytest -q)  # 5
```

Итого 321 тест, все проходили 17.10.2026 после переноса.

## Когда часть legacy заменена

Когда новый модуль полностью заменил старую функцию и владелец это подтвердил, в таблице выше ставится пометка «заменено модулем X (дата)». Удалять старый код можно только отдельным решением владельца.
