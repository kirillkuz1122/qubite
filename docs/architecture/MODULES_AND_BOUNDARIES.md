# Модули и контракты

RECOMMENDED: логические модули, а не процесс на каждый. Публичный контракт не разрешает читать соседнюю БД. Identity/policy доступны всем модулям через typed API; доменные данные принадлежат ровно одному writer. Контракты версии v1 фиксируются JSON Schema/OpenAPI после approval.

| Модуль | Данные | Публичные операции | Граница |
|---|---|---|---|
| Identity/Core | Subject, workspace, device, session bridge | authorize(subject, action, resource); session introspection | legacy Auth сначала, policy нового core |
| Owner Console | module/grant/config/budget metadata | owner-only management commands + audit | не меняет личные данные автоматически |
| Docs | Document, Block, Revision, Template | create/read/update(expected_revision)/export/restore | structured AST, не HTML authority |
| Ink | Notebook, Page, Stroke chunks, Profile | chunk ingest/viewer/replay/export | Android local input; PDF/media separate |
| Planner/Projects/Calendar | Project, Task, dependencies, CalendarEvent | task CRUD/schedule proposal/occurrences | одна модель для Kanban/Gantt/calendar |
| School/Homework | Subject, Lesson, Homework, official source | import/manual; link lesson/homework | локальный прогресс отдельно от official |
| Learn | Attempt, Question, Review, skill evidence | quiz/review/feedback/source citation | не LLM-суждение о навыке |
| Knowledge/Atlas | Relations, citations, index generations | authorized search/graph edges | ACL обоих концов; не authority контента |
| Command/Inbox/Notifications/Today | Capture item, Notification, widgets | manual capture, commands, dedupe, read-state | Inbox материалы, Notifications сигналы |
| Teams | Membership, invitation, shared links, comments | invite/revoke/share/presence | shared scopes не personal |
| Life | encrypted JournalEntry, key metadata | local encrypt/sync ciphertext/export | ключ не у team/server AI |
| Finance | accounts/transactions/ledger/quotes | post balanced entries/compensate/import | AI предлагает, не переводит деньги |
| Focus/Guardian | sessions, consent, scoped guardian invites | start/stop/request exception/emergency exit | добровольный, capabilities устройства проверяются |
| Studio | drawing/frames/brush assets | render/export/storyboard | отдельный поздний performance релиз |
| AI/Memory/Skills | memory proposals, profiles, invocation/approval | context resolver/tool runtime/cost reserve | общий gate, Hermes необязательный |
| Pulse | workflow definition/run/job/outbox | simulate/approve/run/cancel | bounded deterministic steps, reauthorize |
| Plugins/MCP | manifest/grants/token/capsules | resources/tools/commands via core API | нет SQL/filesystem universal access |
| Tournaments | legacy tables/runtime/rating/team roles | compatibility adapter to existing API | пока один writer legacy Node |
| Search/Writer/VPN/Vault/Brief/Kwork/native knowledge | existing service data/credentials | scoped adapters with status + provenance | каждый сохраняет данные/URL, независимую auth где нужно |

Общий command envelope: command_id/idempotency_key, actor_subject, workspace_id, resource_id, expected_revision, payload_schema_version, trace_id. Server не принимает actor/owner привилегии из client payload: связывает с текущей сессией. Response: result/current_revision или typed error (denied/conflict/unavailable/budget_exhausted). Event envelope: event_id, type/version, actor, object, revision, timestamp, provenance; потребитель повторно проверяет права на payload.

Для каждого модуля: installed/enabled/configured — глобальное состояние, granted/revoked — пользовательское. Command и Today не рендерят недоступный ресурс в title/snippet/count. Модули не публикуют secret payload в event bus. Search внешний web research отделён от внутреннего поиска объектов.

Спецификации поздних модулей: Life требует key recovery до хранения реальных записей; Finance balances/compensation до импорта денег; School адаптер manual-first; Studio после Ink benchmark; Teams после ACL revocation tests; Pulse после durable jobs. Подробности сохранены в master и requirement source map; API этих поздних модулей не объявляется уже стабильным.

Telegram control bot — отдельный process adapter Core/Owner/Support/module commands, без собственного permission/budget engine. Platform Analytics/Infrastructure — Owner Console, tournament analytics/settings/moderation — Tournaments. Support roles отделены от турниров. Существующие функции и split матрица: [Telegram и наблюдаемость](TELEGRAM_AND_OBSERVABILITY.md).
