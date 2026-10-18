# Модель данных

> **Реализовано (FND-004, 17.10.2026):** таблицы `objects`, `relations`, `events`, `audit_log`, `file_blobs`, `attachments`, `jobs` — миграция [`0002_core_objects.sql`](../../crates/qubite-db/migrations/0002_core_objects.sql), код — crate'ы [`qubite-objects`](../../crates/qubite-objects/) и [`qubite-jobs`](../../crates/qubite-jobs/). `events` и `audit_log` защищены триггером: изменить или удалить запись нельзя. Остальное в этом документе — план.
>
> **Реализовано (AUTH-001, 18.10.2026):** `accounts`, `platform_owner`, `credentials_password`, `sessions`, `login_attempts` — миграция [`0004_auth.sql`](../../crates/qubite-db/migrations/0004_auth.sql), код — [`qubite-auth`](../../crates/qubite-auth/). Ключи `owner_id`/`created_by` на `accounts` пока не добавлены — появятся в ACC-001/CMD-001 ([D-171](../product/DECISIONS.md)).

Основа — [MC §19.2–19.3](../context/QUBITE_MASTER_CONTEXT.md). Принцип: **общий конверт + типизированные таблицы модулей**. Нет одной таблицы `objects` с бесконтрольным JSON, и данные модулей не обязаны выглядеть одинаково.

## 1. Конверт объекта

Каждый пользовательский объект (задача, документ, тетрадь, элемент Inbox, проект…) имеет запись в `objects`:

| Поле | Тип | Смысл |
|---|---|---|
| `id` | UUIDv7 | Глобальный ID; сортируется по времени, создаётся и на устройстве офлайн |
| `type` | text | `inbox.item`, `planner.task`, `planner.project`, `docs.document`, `ink.notebook`, … |
| `module_id` | text | Модуль-владелец данных |
| `owner_id` | uuid | Аккаунт-владелец |
| `workspace_id` | uuid | Пространство (у каждого пользователя есть личное) |
| `visibility` | enum | `private` / `workspace` / `shared_link` / `vault` |
| `title` | text | Короткое имя для поиска, Command и связей (может быть скрыто правами) |
| `revision` | bigint | Номер версии для оптимистичной конкуренции |
| `created_at/by`, `updated_at/by`, `deleted_at` | | Мягкое удаление |
| `source_refs` | jsonb | Откуда пришло: Telegram-сообщение, Command, импорт |

Данные конкретного типа — в таблице модуля (`mod_planner_tasks(object_id pk fk → objects.id, status, due_at, …)`).

## 2. Связи

```text
relations(id, from_id → objects, to_id → objects, type, created_by, source manual|ai|import, confidence, visibility, created_at)
```

Типы: `related_to`, `part_of`, `blocks`, `mentions`, `derived_from` (например, задача создана из элемента Inbox), `scheduled_for`, … Чтение связи проверяет права **на оба конца**: если доступа к одному концу нет, связь не видна и заголовок не раскрывается.

## 3. Домены (развивается по модулям)

| Класс | Сущности | Модуль | Этап |
|---|---|---|---|
| Identity | Account, Session, Device, Invitation, OAuthIdentity, ApiKey | auth | MVP |
| Access | PlatformSetting, Module, ModuleGrant, Workspace, Membership, Acl | policy/owner | MVP |
| AI | Provider, Model, Limit, UsageCounter, Call | ai | MVP |
| Capture | InboxItem (текст/голос/файл/ссылка, статус `new/triaged/archived`), Suggestion (предложение AI или правила) | inbox/command | MVP |
| Planning | Project, Task, Milestone, Reminder, RecurrenceRule, Dependency, CalendarEvent | planner | MVP → P2 |
| Documents | Document, Block (через CRDT-состояние), Revision, Template, Attachment | docs | MVP |
| Ink | Notebook, Page, Layer, StrokeChunk (бинарный), ToolPreset | ink | MVP |
| Infrastructure | Event, AuditEntry, FileBlob, Job, SyncCursor | core | MVP |
| Notify | Notification, Channel, Preference | notify | MVP |
| Learning | Subject, Lesson, Homework, Card, ReviewLog, Quiz, Attempt, Tournament… | learn/tournaments | P2–P3 |
| Knowledge | Embedding, SearchIndexVersion, Citation | atlas | P2 |
| Agent | AgentProfile, MemoryItem, MemoryProposal, Skill, SkillVersion, ToolInvocation, Approval | agents | P2 |
| Automation | Trigger, Workflow, WorkflowRun | pulse | P2 |
| Personal | JournalEntry (шифр.), Goal | life | P3 |
| Finance | Account, LedgerEntry, Category, Budget | finance | P3 |
| Collaboration | SharedLink, Comment, Presence, Poll | teams | P3 |

## 4. Файлы

`file_blobs(sha256 pk, size, mime, storage_path, created_at)` + `attachments(object_id, blob_sha256, name)`. Файлы лежат на диске по хешу (`data/blobs/ab/cd/abcd…`). Одинаковый файл хранится один раз. Удаление — сборщиком мусора, когда ссылок нет и истёк срок хранения.

## 5. Документы и штрихи

- Документ хранится как **CRDT-состояние** (yrs или Loro, выбор в DOC-001) + периодические снимки-ревизии для истории и поиска. Плоский текст и заголовки извлекаются в индекс.
- Рукописные штрихи **не** кладутся в JSON документа: бинарные блоки (`stroke_chunks(notebook_id, page_id, seq, bytes)`) с дельтами координат, временем и давлением (см. [SYNC_AND_HISTORY](SYNC_AND_HISTORY.md)).
- HTML/SVG от пользователя или AI не исполняется и санитизируется; AI генерирует структуру через JSON-команды, а не через код.

## 6. Устройства

На устройстве `qubite-local` хранит в SQLite **те же** объекты (подмножество, доступное пользователю), очередь исходящих изменений, курсоры синхронизации и FTS5-индекс. Секреты (токен устройства) — в системном хранилище ключей (Keystore/Secret Service), не в SQLite.

## 7. Правила миграций

- Миграции только вперёд, каждая с описанием отката (скрипт или процедура восстановления из бэкапа).
- Перед миграцией на сервере — автоматический бэкап.
- Модули мигрируют только свои таблицы `mod_<id>_*`.
- Тест: миграции применяются на пустую БД и на БД предыдущей версии с данными.
