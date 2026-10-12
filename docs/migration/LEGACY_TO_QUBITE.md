# План миграции и отката

CONFIRMED: archive origin/tournaments + qubite-v1.0 = 96f0457. Не коммитить туда, не force-push/delete. main — новый проект; task branches допустимы с последующим tested merge. Архив — код, не полный production backup. Исходные QUBITE документы добавляются только main.

## Этапы и контрольные точки

Локальная foundation разработка после согласования стека не ждёт серверных этапов M1. Перед live переносом M1 обязателен.

M0: Git archive подтверждён. M1: read-only production inventory/drift + encrypted backup и restore drill. M2: critical legacy characterization/HTTP regression, staging fixture. M3: отдельный policy/owner/mock cost core, authority остаётся legacy Auth. M4: opt-in new shell, old URL продолжают работать. M5: Docs local-first vertical slice. M6: Tournaments navigation isolation/role adapter по частям. M7: возможный identity authority cutover и SQLite→Postgres отдельных доменов — отдельное approval, не следствие установки core.

Каждый этап: explicit migration ID/checksum, source/target writer, invariant report, compatibility tests, data backup reference, approval, feature routing switch, rollback script/manual recipe, stop conditions. Без dual writes одной сущности между SQLite/Postgres. Outbox/reconciliation только после выделенного POC.

| Legacy feature/data | Новый модуль / действие | Критерий switch | Rollback |
|---|---|---|---|
| users/passwords/sessions/OAuth challenges | Identity bridge, сохранить authority | login/logout/revoke/link/reset regression, stable UUID mapping, owner verified | отключить new core routes, legacy Auth не изменён |
| role organizer/moderator/admin | Tournaments scoped roles | permission matrix diff zero unintended additions; direct API negative tests | legacy role column не удалять до cutoff, restore adapter config |
| owner | platform singleton + отдельные self grants | owner console normal home + no-paid-bypass | выключить new policy surface, preserve legacy own role |
| tournaments/tasks/roster/helper/runtime/results/rating | Qubite Tournaments, сохранить Node writer | ended catalog, hidden roster, join/submit/penalty/teams/rating fixture passed | прежняя shell/routes; данные не переписывались |
| service_access/invites/api keys | independent entitlements/adapters | effective policy diff, revoke/expiry, keys scopes negative tests | original tables/hashed keys сохраняются |
| Search history/ciphertext/query logs/ledger | Search adapter + Cost Center reporting | accounts/opt-in/protected logs/unknown spend retained; no double billing | old Search URL/core gate disabled, preserve source history |
| Writing keys/access/usage/addon | Writer adapter | grammar+AI gating+UTF16+cancel regression | old /writing and addon assets |
| proxy subscriptions/device/node credentials | VPN module | heartbeat/profile/catalog/sync/rotate compatibility | old node routes/credential keys; не менять network |
| AliasVault | Vault service | public gate/native enrollment verified, no master secret transfer | original container/DB, old grant |
| Memos/Vikunja/SiYuan | legacy knowledge adapters; later import selected data | source IDs/count/attachments/ownership roundtrip | native originals remain, import mappings removable |
| control/support/events | notifications/runtime adapters | one polling, support delivery/critical audit, pause-safe auth | old units/IPC route map; no second bot |
| Kwork/Brief/leads/negotiations | Projects/Inbox adapters later | source hashes, outbox/idempotency, no unknown resend, actual server hooks diff | original listener/State DB, no extra session |
| Flutter VPN client | keep separate app/API compatibility | build/device/network test matrix | old API version/artifacts |
| ShadeAI | future connector only | local allowlist + explicit consent + mock actions | disable connector, independent Shade unchanged |

## Контроль данных

Перед любой DB migration: SQLite backup API или остановленный согласованный snapshot + attachments/config key references, encrypted off-host копия; PRAGMA integrity_check/FK/count/hash в disposable восстановлении. WAL-live файл нельзя просто cp без согласования. Target import в новую БД, никогда поверх оригинала. Per-user/membership/grants/result/rating/usage/attachment count + content hashes и orphan check; команды/tests используют синтетические IDs, отчёт без private текста.

Identity migration позже: password algorithm/salt не перехешировать без логина; перенос verifier только после cross-runtime test vectors, либо staged reauthentication. OAuth sub уникальность, session TTL/revocation, cookie domain и native token binding сохраняются/мэпятся явным образом. Нельзя отключить старый Auth пока Search/Vault/native apps проверяют его.

Rollback после новых записей: routing rollback не означает стереть новую БД. Сохраняем new writes и export/reconcile plan; users могут временно видеть read-only новых документов. Для irreversible внешних sends нет DB rollback. Любые drop/cleanup old columns после retention + verified export + отдельного согласования.

Stop: counts/FK/hash/policy discrepancy, unknown expenses, failed login, missing attachments, duplicate polling, unverified backup, memory pressure, unexpected public endpoint. Деплой не был выполнен. Подробности [backup/runbook](../engineering/DEPLOYMENT_AND_BACKUPS.md).

Уточнение 12.10.2026: старый control bot полностью переделывается с сохранением необходимых capabilities; целевой отдельный worker/API adapters. Нельзя одновременно запускать два consumer одного token. Турнирные controls/аналитика переходят в настройки/управление модуля; platform/AI analytics и инфраструктура — Owner Console; Support отдельный scope. Сохранять history/source IDs/notification outcomes. [Parity matrix](../architecture/TELEGRAM_AND_OBSERVABILITY.md).
