# Модель данных и invariants

CONFIRMED выбор storage 12.10.2026: новый core Postgres, legacy SQLite остаётся authority Tournaments/Auth в переходе. Target identity переносится отдельно в Postgres после compatibility/restore gates. Это logical schema; SQL миграции создаются небольшими approved задачами. Не одна гигантская JSON objects таблица.

## Связи MVP

| Таблица | Ключевые поля/связи | Ограничения/индексы |
|---|---|---|
| subjects | id UUID, legacy_instance/id, status | UNIQUE(instance,legacy_id); стабильная mapping, owner не role slug |
| platform_owner | singleton_id=1, subject_id | один active owner; change через особый verified процесс |
| workspaces/memberships | id, owner; workspace+subject, role | composite unique; роли scoped; revoked_at |
| modules | id, installed/version/state/config_version | installed/disabled/enabled, secret refs отдельно |
| entitlements | subject, module, action, scope, expiry, grant_version | уникальный effective grant key; deny overrides |
| objects | id/type/owner/workspace/visibility/revision/deleted_at | common envelope; tenant-aware indexes, type registry |
| documents/blocks | object_id; doc_id/block_id/order/type/payload_version | FK; validated AST schema, no arbitrary HTML/JS |
| revisions | object_id/revision, parent, snapshot_hash, actor, reason | UNIQUE(object,revision), immutable; restore → новая revision |
| relations | from/to/type/provenance/confidence/visibility | FK обоих концов, read ACL на оба; дедупликация |
| blobs/attachments | hash/size/mime/private_storage_key, object_id | hash verify; per-scope reference authorization; no global hash existence oracle |
| devices/changes | subject/device_id/seq/command_id/payload_hash | unique subject+command; idempotency binds payload+actor |
| event_log/outbox | event_id/aggregate/revision/type; delivery status | append-only meaningful events; atomic with domain write |
| jobs | id/type/status/lease_until/attempts/actor/policy_version | bounded retries, reacquire grant; no private payload in logs |
| budgets/buckets | subject/module/model/project/period, cap/reserved/spent | fixed integer micro-USD, nonnegative; unique scope+period |
| invocations/reservations | id/idempotency/price_version/worst_case/state/provider_request_id | unique initiator+key; model/output/token constraints |
| approvals/audit | actor/resource/action/payload_hash/revision/expiry | approval инвалидируется изменением ресурсов/гранта |
| search_documents | object/revision/index_generation/acl_version | derived projection, not authority; revoke filters before response |

Object 1:N blocks/revisions/attachments; Relation N:N objects; Subject N:M workspace через membership. Docs не хранит персональный vault plaintext. Deleted tombstones сохраняются по sync retention; GC только после device watermark/retention grace, с предупреждением для долго offline устройства.

## Расширения по модулям

Ink: Notebook→Page→Layer→Stroke; PointSeries хранится binary chunks с canonical координатами/time/pressure/tilt/schema checksum. HandwritingProfile — приватные согласованные samples, не серверное обучение по умолчанию. MediaAsset→Transcript→Segment/Speaker; AudioSession/ReplayTrack отдельны.

Planning: Project→Task→Dependency/Milestone; CalendarEvent/Recurrence/Reminder с timezone и локальной датой, recurrence DST test. Learning: Subject→Lesson/Homework→Source→Question/Attempt/Review; source locator page/block/time обязательный. Finance: Account→LedgerEntry←Transaction, сумма debit/credit равна, currencies не складываются; PriceQuote source/time. Life: encrypted JournalEntry/private collection + key envelopes; memory/embeddings исключены по умолчанию.

Agent: AgentProfile→Conversation/MemoryItem/SkillVersion/ToolInvocation; память содержит provenance, confidence, owner/scope, freshness/expiry, consent. Plugin/PluginGrant/ExternalAccount/ExternalMapping — отдельные scopes; импорт сохраняет external source ID.

## Legacy mapping

users integer ID → subjects UUID через явную таблицу; sessions/password salt/hash/OAuth sub остаются старому authority. Старые team_members — tournament team memberships, не новые workspace memberships. tournament_* и rating_changes остаются legacy, в core только module/resource references. service_access/writing_access/knowledge grants импортируются отдельно с provenance и effective-policy diff; paid/owner bypass не переносится.

## Миграции/retention

Каждая versioned migration: expand → backfill idempotent → validate counts/FK/hash/ACL/ledger → switch one writer → contract позже. Migrations версии/checksum фиксируются, нет авто destructive start-up. Согласовать retention audit/history/media/private deletions и RPO/RTO до live данных. Export JSON/Markdown/media manifest versioned; schema roundtrip tests и encrypted blob restore обязательны.
