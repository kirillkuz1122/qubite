<div align="center">

# Qubite

### Личная цифровая среда для учёбы, работы и мыслей — связанная, офлайн и на своём сервере

**Мысли и Входящие · Задачи · Документы · Рукописные конспекты · AI-помощник под бюджетом · Self-hosted**

![Status](https://img.shields.io/badge/статус-ранняя_разработка-ffe163?style=for-the-badge)
![Rust](https://img.shields.io/badge/Rust-сервер-1d1b19?style=for-the-badge&logo=rust&logoColor=white)
![React](https://img.shields.io/badge/React_+_TS-интерфейс-71cfff?style=for-the-badge&logo=react&logoColor=1d1b19)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-+_pgvector-71cfff?style=for-the-badge&logo=postgresql&logoColor=1d1b19)

</div>

> **In short (English):** Qubite is a self-hosted, local-first personal workspace — inbox for quick thoughts, tasks, docs and handwritten notes, all linked together, with an optional AI assistant that can never spend money without an explicit budget. Server in Rust (axum + sqlx + PostgreSQL), UI in React + TypeScript, desktop via Tauri, Android with a native Kotlin pen engine. Early development; documentation is in Russian.

## Что это

Qubite — одно приложение вместо десятка: быстрые мысли, задачи и проекты, документы, рукописные конспекты на планшете. Всё лежит в одном месте и **связано между собой**: заметка знает свою задачу, задача — свой проект.

- **Local-first.** Мысли и задачи записываются без интернета и синхронизируются потом.
- **AI — помощник, а не посредник.** Всё можно сделать руками. Платный AI не включается сам: только по разрешению владельца и в пределах бюджета, расход резервируется заранее.
- **По умолчанию запрещено.** Новый пользователь не получает ни модулей, ни AI — доступ выдаёт владелец сервера. Все проверки на сервере.
- **Свой сервер.** Один бинарник на Rust + PostgreSQL; работает на VPS или Raspberry Pi.

## Что уже работает

| Часть | Состояние |
|---|---|
| Сервер: база, миграции, объекты, очередь задач, синхронизация | ✅ |
| Аккаунты: owner через CLI, пароли (Argon2id), сессии, CSRF, почта, регистрация по приглашениям, CAPTCHA | ✅ |
| Вход через Яндекс ID, VK ID, Google, Telegram; вход приложений (PKCE) | ✅ |
| Права на модули (Policy Gate), тумблеры платформы | ✅ |
| AI-шлюз: OpenRouter, лимиты и резерв бюджета, защита от prompt injection | ✅ |
| Входящие: захват мыслей офлайн, Telegram-бот | ✅ / на приёмке |
| Web-интерфейс (лендинг, оболочка приложения, «Входящие») | на приёмке |
| Planner, Docs, Ink, desktop и Android | ⏳ дальше |

Актуальное состояние — [docs/project/STATUS.md](docs/project/STATUS.md), план — [docs/plan/ROADMAP.md](docs/plan/ROADMAP.md) и [docs/plan/TASKS.md](docs/plan/TASKS.md).

## Стек

```mermaid
flowchart LR
    subgraph Clients["Клиенты"]
        WEB["Web — React + TS"]
        DESK["Desktop — Tauri"]
        AND["Android — React + Kotlin (перо)"]
        TG["Telegram-бот"]
    end
    SRV["qubite (Rust)<br/>API · права · бюджеты AI · синхронизация · фоновые задачи"]
    DB[("PostgreSQL + pgvector")]
    AI["AI-провайдеры<br/>(через бюджет)"]
    Clients --> SRV --> DB
    SRV --> AI
```

- **Сервер** — модульный монолит на Rust (axum, sqlx, tokio); каждая часть — отдельный crate в [`crates/`](crates/).
- **Интерфейс** — React + TypeScript (Vite) в [`apps/web`](apps/web); общие пакеты (дизайн-система, движение, клиент API, офлайн-синхронизация) — в [`packages/`](packages/).
- **Данные** — PostgreSQL 18 + pgvector на сервере, офлайн-очередь на устройствах.

## Как запустить

Нужны Rust (через rustup), Node.js 22+, pnpm, Docker и [`just`](https://github.com/casey/just).

```bash
just setup   # зависимости, браузеры для тестов, PostgreSQL + pgvector в Docker (порт 55432)
just dev     # сервер (:8080) и сайт: http://localhost:5173
just check   # все проверки, как в CI
```

Первый владелец сервера создаётся командой (пароль спросит без отображения):

```bash
DATABASE_URL=postgres://qubite:qubite@127.0.0.1:55432/postgres \
  cargo run --bin qubite -- owner create --email you@example.com
```

Настройки — в [`.env.example`](.env.example) (скопируйте в `.env`). Подробно — [docs/engineering/DEVELOPMENT.md](docs/engineering/DEVELOPMENT.md), установка на сервер — [docs/engineering/DEPLOYMENT.md](docs/engineering/DEPLOYMENT.md). Готовые архивы под x86_64 и aarch64 собирает CI (`just release` — то же локально).

## Документация

| | |
|---|---|
| [Видение продукта](docs/product/VISION.md) | Что такое Qubite и что входит в MVP |
| [Решения](docs/product/DECISIONS.md) | Журнал принятых решений |
| [Архитектура](docs/architecture/OVERVIEW.md) | Как устроено |
| [Права и вход](docs/architecture/AUTH_AND_PERMISSIONS.md) · [Контроль расходов AI](docs/architecture/AI_COST_GUARD.md) | Безопасность и деньги |
| [Дизайн-система](docs/design/DESIGN_SYSTEM.md) | Как выглядит и ощущается |
| [Вся документация](docs/README.md) | Карта документов |

## Старый Qubite

До перезапуска в октябре 2026 Qubite был платформой учебных турниров (Node.js + SQLite). Этот код лежит в [`legacy/qubite-v1/`](legacy/) только для справки и постепенно переписывается модулями нового Qubite.

## Безопасность

Нашли уязвимость — не открывайте публичный issue, см. [SECURITY.md](SECURITY.md).
