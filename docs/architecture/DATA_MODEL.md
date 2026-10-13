# Модель данных и invariants

0004 фактически добавляет oauth_providers(enabled/version), oauth_identities(unique provider/issuer/subject + own provider), oauth_states(hash-only browser-bound one-use context), oauth_audit(minimal security metadata), sessions.password_proven. [Поля/constraints/privileges](OAUTH_IDENTITY.md). Логические domain таблицы ниже ещё backlog.

**Актуальное AUTH-01013.10.2026:** core0.3.0/current0004_oauth, [OAuth adapters/explicit link/unlink](OAUTH_IDENTITY.md), [report](../reports/QUB-AUTH-010.md). Identity-v2 partial runtime AUTH-009/010, текущих core tables10, metadata readonly readiness/old password sessions проверяются. Реальные provider keys/network/deploy/UI не использованы; снимки AUTH-002/009 и legacy audit ниже исторические. Policy/native/registration/reset/keys/services ещё отдельные задачи.

**AUTH-00913.10.2026:** кроме subjects/owner реализованы password_credentials, sessions(web), auth_preauth и auth_rate_limits в0003_auth. [Поля/индексы/invariants](WEB_AUTH.md). Прочие domain/native/keys/permissions таблицы ниже logical backlog.

**Реализовано AUTH-00213.10.2026:** subjects/platform_owner в0002_identity, UUID/canonical email/status/version и local owner bootstrap. [Фактические поля/FK/индексы](IDENTITY_SCHEMA.md). Остальные таблицы ниже logical backlog, password/session позже AUTH-009; technical namespace0001 не является текущей полной schema.

CONFIRMED storage: новый core Postgres, SQLite турниров. **ADR-0013/13.10.2026:** fresh core identity, новые UUID/accounts без legacy mapping/import; у владельца нет действующих аккаунтов/деплоя по его сообщению. Legacy SQLite Auth больше не целевой authority. [Identity schema/credentials/invariants](../migration/IDENTITY_CUTOVER.md). Это logical schema; SQL миграции создаются небольшими approved задачами. Не одна гигантская JSON objects таблица.

## Связи MVP

| Таблица | Ключевые поля/связи | Ограничения/индексы |
|---|---|---|
| subjects | id UUID, canonical_email, status, auth_version | UNIQUE canonical_email; UUID не меняется при смене почты, owner не role slug |
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

## Identity и legacy references

AUTH-002 добавляет subjects и singleton platform_owner, explicit local bootstrap без public endpoint. AUTH-009 отдельно добавляет Argon2id credentials/web sessions; AUTH-012 native authorization codes/device token families; AUTH-013 scoped API keys. Hashes/expiry/status/version/revocation сохраняются в Postgres; plaintext токены и пароли не сохраняются. Конкретные SQL constraints создаются и проверяются в соответствующей задаче; текущая migration0001 их не содержит.

Турниры/team_members/rating_changes остаются optional Node/SQLite. Новые core subjects не импортируются в старую users глобальную модель ролей; будущий явный adapter хранит ссылки core UUID и tournament-scoped membership. Выбор переноса обнаруженных tournament/history/ledger/attachments данных отдельной задачей, не уничтожать локальные артефакты. service_access/writing_access grants не импортируются автоматически, owner явно выдаёт новый доступ.

## Миграции/retention

Каждая versioned migration: expand → backfill idempotent → validate counts/FK/hash/ACL/ledger → switch one writer → contract позже. Migrations версии/checksum фиксируются, нет авто destructive start-up. Согласовать retention audit/history/media/private deletions и RPO/RTO до live данных. Export JSON/Markdown/media manifest versioned; schema roundtrip tests и encrypted blob restore обязательны.

## Реализованная technical schema — CORE-001

В `qubite_meta.schema_migrations` version PK, SHA256 checksum hex CHECK, created_at/updated_at timestamptz NOT NULL; applied history проверяется на exact shipped prefix. Migration 0001 создаёт пустой namespace qubite_core, без subjects/grants/domain tables. FK отсутствуют, PK index достаточен для маленького ledger. [ERD/transaction/recovery boundaries](CORE_FOUNDATION.md). Не считать logical MVP таблицы выше реализованными.
