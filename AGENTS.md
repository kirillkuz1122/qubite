# Qubite — правила для AI-агентов

Этот файл читают Claude, Codex и любые другие агенты и новые разработчики. Он короткий: подробности лежат в `docs/`.

## Что это за репозиторий

**Qubite 2.0** — универсальная личная (потом командная) цифровая среда: Command + Inbox, Planner, Docs, Ink, учёба, агенты и др. Проект **перезапущен 17.10.2026** на новом стеке. Старый Qubite (платформа турниров) лежит в `legacy/qubite-v1/` и **не является** текущим продуктом.

## Стек (решён владельцем)

- Сервер — **Rust** (axum, sqlx), модульный монолит, один бинарник `qubite`.
- БД — **PostgreSQL + pgvector** на сервере, **SQLite** на устройствах.
- Web — **React + TypeScript**; desktop — **Tauri 2**; Android — общий React-интерфейс + **нативный Ink на Kotlin**.
- Не использовать FastAPI-код из ветки `codex` — это архив ([D-001](docs/product/DECISIONS.md)).

## Порядок чтения при старте

`DECISIONS.md` — индекс по строке на решение, полный текст — `docs/product/decisions/NN.md`; искать grep-ом по номеру (`grep -rn "D-585" docs/product/`). Задачи — GitHub Issues, статус — метка ([TASKS.md](docs/plan/TASKS.md)). Архивы в `archive/` целиком не читать (D-583, D-624).

1. Управляющая сессия — `docs/harness/OWNER.md` и `docs/harness/MANAGER.md`.
2. Сессия задачи — свой issue (или задание от менеджера) и решения, на которые он ссылается.
3. `docs/engineering/AGENT_WORKFLOW.md` — цикл задачи и Definition of Done.

## Обязательные правила

- **Владельца спрашивать только** про Raspberry Pi и сеть, удаление данных и крупное направление продукта; остальное решать самому и записывать «решил так, можно откатить» (D-585). Вопросы — одним блоком, с рекомендацией.
- **Объяснять простыми словами**, что делаешь и зачем. Владелец общается голосом, по-русски.
- Одна основная задача за цикл. Новое — отдельным issue (см. `docs/plan/TASKS.md`).
- Новый код **никогда** не импортирует ничего из `legacy/`. Ничего из `legacy/` не удалять без решения владельца.
- Платный AI — только через AI-шлюз с бюджетом. В тестах — только mock-провайдеры, реальных ключей нет.
- Все проверки прав — на сервере; по умолчанию запрещено.
- **UI — только по [DESIGN_SYSTEM.md §0](docs/design/DESIGN_SYSTEM.md)**: общие компоненты `packages/ui`, отступы и токены оттуда, анимации только через `transform`/`opacity`; **чек-лист §0.5 перед каждым коммитом UI обязателен** (скриншоты ПК + телефон 360 px). UI-задача не готова без приёмки владельцем.
- Если docs расходятся с кодом — верить коду и исправить docs. Если с `DECISIONS.md` — верить DECISIONS.

## Git

- Коммиты на **русском**, без префиксов `feat:`/`fix:`. В конце — строка соавторства агента, если её требует среда; строки `Generated with [Devin]` / `Co-Authored-By: Devin` не добавлять.
- После коммита — `git push origin main` ([D-008](docs/product/DECISIONS.md)). Не пушить красный CI.
- Перед коммитом — `git status --short`; не коммитить `.env`, базы, `assets/`, посторонние изменения.
- Запрещено: `push --force`, `reset --hard`, удаление веток/тегов `codex`, `tournaments`, `qubite-v1.0`.

## Сервер

- Qubite 2.0 работает на Raspberry Pi (`qubiteapp.online`), сам обновляется из зелёного `main` (OPS-005). Сервисы владельца на Pi, VPN и сеть не трогать без вопроса (D-620). `git push` в `main` = деплой: не пушить красное.

## Где что лежит

| Путь | Что |
|---|---|
| `docs/` | Вся документация, карта — `docs/README.md` |
| `docs/context/` | Исходное видение и переписка с Codex (не редактировать) |
| `crates/`, `apps/`, `packages/`, `deploy/` | Новый код (появится в задачах FND-*) |
| `legacy/qubite-v1/` | Старый Qubite целиком; карта — `legacy/README.md` |
| `assets/` | Дизайн-лаборатория Codex, не в git, не использовать без решения владельца |

## Проверки

Быстро и коротко: `scripts/check.sh` (то, что задето; `--quick` без тестов, `--all` — всё; D-626). Всё сразу: `just check` (список команд — `just`). По отдельности — сервер: `scripts/dev-db.sh up`, `eval "$(scripts/dev-db.sh env)"`, `cargo fmt --all --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace`. Web: `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm e2e`; после изменения API сервера — `pnpm gen:api`. TypeScript закреплён на 6.0 (7.0 пока не поддерживается инструментами). Подробно — `docs/engineering/DEVELOPMENT.md`. Тесты старого кода (321) — `legacy/README.md`. В sqlx 0.9 динамический SQL требует `sqlx::AssertSqlSafe` — использовать только для строк без внешнего ввода.
