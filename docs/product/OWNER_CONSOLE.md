# Owner Console: спецификация первого среза

**AUTH-00313.10.2026 — review/testing:** core0.5.0/schema0006_policy; раздельные ручные module/action grants, workspace/resource intersection, owner-only metadata commands с If-Match/idempotency/reauth/audit. Общий REST/job/tool/WS gate, live revoke/session/expiry/version; paid AI закрыт до AI-001/002. [Контракт](../architecture/POLICY_GATE.md), [отчёт](../reports/QUB-AUTH-003.md). Только аккаунт до grants подтверждено владельцем; перед каждой будущей задачей сначала вопросы и ответы. UI/registration/real modules/installer/native/provider/deploy отдельно. Final local all844+harness6=850pass, implementation/push/CI ещё проверяются; точные evidence в tasks.json/LAST_HANDOFF. Прежние snapshots ниже исторические.

CONFIRMED: Настройки → Управление Qubite, только verified platform_owner. Главная owner — обычный Today. Скрытие ссылки дополняет API authorization, не заменяет её. На старте без глобальной hierarchy/admin помощников и без оплаты/тарифов.

Экраны и команды:

| Раздел | Операции | Acceptance |
|---|---|---|
| Users | поиск, manual create/invite, block/activate, revoke sessions, deletion preview | account creation не выдаёт модули/AI; owner защищён от обычного deletion/role edit |
| Modules | installed/version/config, enabled toggle, user grants/expiry/revoke | installed disabled не доступен даже granted user; absent service не ломает shell |
| AI | provider secret ref, model/action allowlist, quotas/budgets user/module/project, usage/unknown | owner self budgets управляет явно; 0/unknown block до paid call |
| Integrations | independent connector grants, config/status/revoke | token masked, server-side secret, no cross-service privilege |
| Audit | actor/reason/diff/time; policy changes/denials/spend | не полный текст private запросов, export scoped |

User settings показывают свои grants/limits без mutation других пользователей. Tournaments management внутри Tournaments: users/teams/results/tasks турнира; global grants/budgets туда не попадают. Runtime/deploy capability отдельно от обычного модульного toggle: production deployment остаётся отдельной процедурой с разрешением, не автоматическая кнопка arbitrary shell.

QUB-AUTH-001 — umbrella acceptance scenario, разбит на AUTH-002/003/004 и AI-001/002: owner normal home → console → test user → Docs only → Search/Tournaments/AI denied → mock allowance → cap exhausted → revoke. Негативные API вызовы + UI owner/nonowner. Все critical mutations используют versioned config/If-Match, audit и idempotency; no secrets in list/export. Confirmation только для фактических sensitive операций с конкретным diff.

## Telegram, аналитика и сервер (уточнение 12.10.2026)

Control bot обязателен и перерабатывается полностью. Общие Users/Grants/AI/Audit/Platform analytics/Infrastructure находятся в Console; bot вызывает те же scoped API. Metrics/история нагрузки/сервисные статусы сохраняются с корректными единицами и collector scopes. Все tournament switches, organizer applications/task moderation/team/results/rating/турнирная аналитика — управление/настройки Qubite Tournaments, без global account capabilities модератору. Support самостоятельный scoped контур. [Полная матрица функций и нюансы](../architecture/TELEGRAM_AND_OBSERVABILITY.md). Режимы подтверждены 12.10.2026: automatic text/voice capture, guest support + independent staff grants, critical alerts + daily digest и ссылки в Qubite. Shared capabilities реализуются на FastAPI; tournament engine сохраняется отдельно.
