# Передача следующей сессии —13.10.2026 / AUTH-002

**AUTH-002 реализована, review/testing: финальные477 локальных проверок passed; Git/CI evidence продолжаются.** Новые PostgreSQL subjects/platform_owner, explicit local owner CLI, canonical email и default pending accounts. Источник решения: user «Делай след задачу», ADR-0013 fresh identity без существующих аккаунтов/деплоя по сообщению владельца; не remote server verification.

[Schema/CLI/privileges/rollback](../architecture/IDENTITY_SCHEMA.md), [ADR-0014](../architecture/decisions/0014-fresh-accounts-and-owner-bootstrap.md), [report](../reports/QUB-AUTH-002.md), [tasks](../plan/tasks.json), [core запуск](../../core/README.md). **Настоящий owner постоянной среды не создавался**, только disposable accounts. Password/login/session API ещё не реализованы.

## Реальный код и инварианты

- Explicit0002_identity после неизменной0001; runtime version health API остаётся прежней/core-v1 OpenAPI unchanged. Current schema0002, history/checksum gate и required actual subjects/platform_owner tables; missing→not_ready/refuse, no auto repair/startup DDL. Catalog existence/type check не полный semantic schema fingerprint.
- UUID4/email original+canonical/status pending/active/blocked/version/timestamps, optional name/unverified. No role/password/session/grant/budget/login alias/legacy integer import. Parameterized SQL, DTO repr без email/name, safe errors.
- Platform owner singleton CHECK1 + composite FK к active subject, RESTRICT status/delete; repeat/bootstrap existing email не upsert/не promotion. Owner created by trusted local operator CLI с email из stdin и CREATE OWNER, одна transaction/advisory lock с миграциями; stdout UUID. No API bootstrap. Failure after first insert rolls back; failed commit не объявляется success, retries не автоматические.
- idna3.20 уже pinned в lock, теперь explicit direct requirement. IDNA2008/UTS46 nontransitional domain +local casefold, no dot/plus merging. Не full RFC parser/mailbox proof. Password/local credential setup следующая AUTH-009, owner email NULL verified timestamp.
- Limited DB role fixture: account writer без INSERT platform_owner создаёт pending member, bootstrap denies/no orphan. Installer operator/runtime/migration roles ещё не provisioned; future API role не superuser/без owner writes. No paid/module grants даже owner.

## Проверки и следующий шаг

Финальный core88 (29foundation+59identity) passed на native PG18.6: real CLI subprocess, actual concurrent DB connections, SQL constraints/direct invalid binding, owner deactivation/deletion, canonical duplicate, pending/drift/missing gates, partial bootstrap/DDL rollback и role restrictions. All473 +harness4 =477 passed, без ошибок/пропусков, Python3.13. Exact-SHA CI/commit в report после подтверждения. Source-copy без .env/real HOME/DB, external network denied; 133 browser tests прежнего дизайна не повторялись, UI untouched. Known FastAPI/httpx deprecation warning не повод менять lock.

**Next AUTH-009:** Argon2id credentials +local owner password setup, actual web login/session/revoke/CSRF/logout/reset security gates на disposable PG. AUTH-003 ждёт AUTH-009; native/keys/introspection AUTH-012/013/014 отдельно, service adapters позже. Одна bounded задача/cycle, не начинать всю платформу или второй slice автоматически. DEPLOY-001/TG-001 дополнительные specification tracks; live deploy отдельно.

## Сохранённые решения и evidence

- AUTH-008 done a48685c5a68cf8ca8973d6561f44b491157a9f1a /CI38344387215 success13.10 04:01:52UTC,418 checks local+CI Python3.14.8/PG16.15. Контракт identity-v2 всё ещё planned/runtime_implemented=false именно для Auth HTTP routes; существующее новое storage не означает сессии/интроспекцию. [Report](../reports/QUB-AUTH-008.md).
- DESIGN-001 **done**: Поток/Игрушечная/Лента/Unbounded/Manrope,100/503, версия4 принята владельцем. [Демо](https://qubite-material-lab-kirill.kuzmichevkonstantin9.chatgpt.site/#/flux/appearance), [Color Plastic](../design/COLOR_PLASTIC.md)/[Flux](../design/FLUX_DESIGN_SYSTEM.md),133 browser/519 total в прежнем cycle. Final layout/device/PET-* отдельно; hidden/edge peek/contextual entry/retreat сохранены; помощники scripted, real agents нет.
- Demo owner-private, exact hosting.json project_id reuse, source8e8aba31/version4/deploymentappgdep_6acd9fa05db08191b83a91968a2a70e6 succeeded03:04:14UTC. No autopublish/нового login gate для агента; владелец сам посмотрел.
- Owner normal home, separate Console, manual module/model grants/budgets, tournament scoped roles. Shared APIs FastAPI/own React UI; optional Tournaments Node/SQLite/Vanilla. TG automatic text/voice capture/support/staff/events/deep links/metrics, tournament settings module-local. Web/Android/Linux desktop/installer обязательны; hosting/Pi/VPS отложены.
- Main at start93bca8edca89a0f694c1644790494c2884194de4; origin/tournaments +tagqubite-v1.0 immutable96f0457a523b6b79f21c4092056d8fa8fa69a680, refs проверены перед задачей. Russian commit→immediate push, push не deploy. Existing local files/data не удалять, rollback сохраняет new UUID/data; schema0001 binary не ready с0002ledger.
- TEST-0016952277/CI38207835631 фиксирует L01cookie500/L02Googlekill/L03unverifiedlink — legacy defects остаются, no accepted new behavior. CORE-001a85f047/CI38211426535 и audit ae3f71e/CI38197926998 historical; новые результаты этой задачи отдельно.
- Legacy back/front/index/services/deploy/env/ShadeAI не менялись; ShadeAI read-only future connector; root V2 filename отсутствует. Skills/reset/subagents не использовать. Master/access source неизменны/all48 ideas preserved; no secrets/private DB/message/browser/session artifacts в Git. Production install/migration/actual owner bootstrap и paid/provider/device acceptance не выполнялись.
