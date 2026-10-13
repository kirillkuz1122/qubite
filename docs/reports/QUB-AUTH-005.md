# QUB-AUTH-005 — вход без account code-entry

13.10.2026. Статус: **done**; local+CI898pass, implementation commit/push/remote exact и CI success подтверждены. Scope подтверждён ответом владельца до реализации. До изменений main/origin **d6c15e16b8f6505715f17914c966dc528485fff5**, checkout чистый; remote archive tournaments/qubite-v1.0 **96f0457a523b6b79f21c4092056d8fa8fa69a680** подтверждён. Постоянный аккаунт/пароль владельца не создаётся.

## Что сделано

Переиспользован существующий FastAPI/PostgreSQL Web Auth AUTH-009. Кодовый вход уже отсутствовал, поэтому новый второй login handler не написан. Core остаётся **0.5.0/schema0006_policy**, все SQL migrations и HTTP runtime без изменений.

Созданы [machine contract auth-v1](../../contracts/auth-v1.json), [описание account login](../architecture/ACCOUNT_LOGIN.md), [ADR-0019](../architecture/decisions/0019-account-login-boundary.md), actual HTTP/PostgreSQL `test_account_login.py` и три SQLite/server.js tournament join регрессии. Обновлены registry/handoff/проектный контекст и связанные инструкции/документы. Auth-v1 проверяется против actual OpenAPI и ссылается на identity-v2, не вводит самостоятельный protocol authority.

## Acceptance и evidence

| Требование | Проверка |
|---|---|
| Нет old code-entry/account session grant URL | GET/POST шести old/v1 URL, anonymous и signed-in:404, без redirect/Set-Cookie, аккаунты/сессии/credentials/grants не изменены |
| Только email/password, без account code и alias | 11 payloads ×2 browser states:400, включая правильный password с лишним code/token/mode; generic error без input |
| Обычный вход остаётся работоспособным | Owner/member login200, own UUID/profile, cookie secret отсутствует в JSON, module grants пустые |
| Код не активирует pending/blocked | Strict DTO400, account metadata unchanged; password login401 |
| Email proof не становится password/session/bearer | Verify/reset ×3 placements:401, proof не consumed; отдельное confirm204 без login, затем обычный password login200 |
| Турнирные приглашения сохранены | Shared/personal join200 для правильного участника; wrong code/foreign roster403; anonymous401/unverified403; module join не создаёт аккаунт или новую сессию |
| OAuth/email не сломаны общим запретом code | Existing полные OAuth100/email65 suites, signed fixtures/mock-only; никаких real provider запросов |

Турнирный fixture использует прежнюю isolated SQLite identity, а не пока отсутствующий core adapter. Legacy `back/server.js` code-entry/guest flow в исходниках остаётся; никакой опубликованный product ingress этим slice не создаётся. Будущий ingress обязан направлять account Auth только в core, без fallback Node; фактическое staging/production маршрутизирование отдельно.

## Проверки

Команды: `python3 scripts/engineering/verify.py --suite all --python /tmp/qubite-design-tests/bin/python --postgres-bin /tmp/qubite-design-postgres/usr/bin`, `python3 -m unittest discover -s tests/engineering`, `python3 scripts/engineering/check.py`, `git diff --check`.

Первый all остановился на трёх новых tournament tests:503 от workspace gate в **auth-only test fixture**, ещё до join guards. Исправлена только fixture configuration: после безопасного auth-only startup включается test-only workspace role в guarded source copy. Actual middleware/handlers, proxy/bot/daily workers не подменяются и не запускаются. Это не product defect и не скрытый skip. Второй all: Node97 уже pass; новые core tests выявили две неверные проверки: OAuth query code разбирается вручную и отсутствует в generated OpenAPI parameters, а bearer с оставшимся preauth cookie получает корректный mixed-credential400. Уточнены test assertions и очистка cookie перед отдельной bearer проверкой; runtime/защитные проверки не ослаблены. Финальный all выполняется после этих двух bounded repair batches, без skips.

## Границы и дальнейший порядок

Без runtime/schema/deploy/secrets/.env/реальных provider/mail/bot запросов. Existing accounts импортировать не требуется по ADR-0013; найденные старые данные/файлы не удалены. Standalone Search/Writing/VPN/native ещё не используют единый core в production. Public registration/email-2FA/native/React/Owner Console UI и реальные пользователи — следующие отдельные slices.

Rollback: снять артефакты обычным commit, сохранить PostgreSQL UUID/credentials/sessions/grants/audit и immutable архив. Не включать account code-entry, не restore legacy password/session snapshot поверх core. Next **AUTH-006**, прежде вопросы/ответы о регистрации и приглашениях, затем реализация; текущий ответ не является blanket approval следующей задачи.

## Финальная локальная проверка

Полный изолированный all завершился exit0: **892 passed** = Node97/deploy18/Search95/Brief112/Kwork29/SiYuan5/identity32/core504. Core504 = foundation29+identity59+Web Auth120+OAuth100+email65+policy86+account-login45; три группы208/24.97s +165/46.59s +131/52.79s, сумма124.35s, лимит180s каждой сохранён. Engineering unittest6pass, всего **898 проверок**. No failures/skips/cancelled в финальном запуске; Starlette TestClient warning advisory. Python3.13.13, PostgreSQL18.6, Node22.22.2 проверены локально.

check.py56tasks/63docs и git diff --check pass. Git diff подтвердил отсутствие изменений core/qubite, core/identity OpenAPI, identity-v2, SQL и root master/access. Sources/services/секреты/демо/удалённые серверы не менялись. Только48 новых security/module regression cases плюс contract/docs; реальные provider/mail calls0. После этого изменялась только docs/evidence metadata; runtime suites без новых code changes повторно не требуются.

## GitHub и статус

Implementation **cf302d9e05579f417886a8ee87136352a3f53fa0** commit/push и remote main exact подтверждены. Remote tournaments/qubite-v1.0 immutable96f0457a523b6b79f21c4092056d8fa8fa69a680. [CI38385240872](https://github.com/kirillkuz1122/qubite/actions/runs/38385240872) для exact SHA завершился completed/success **13.10.2026 10:47:23UTC** (job completed10:47:22UTC), task done. Registry56:11done/4ready/41backlog. AUTH-006 остаётся backlog/approvalfalse, сначала вопросы и ответы, никакой автоматической следующей реализации.

CI подтвердил **892 all +6 engineering =898pass**, те же suites/числа, без failures/skips. Фактические Python3.14.8/PostgreSQL16.15/Node22.23.3; core208/44.33s +165/77.02s +131/84.32s, сумма205.67s, каждый subprocess укладывается в180s. Никакого увеличения timeout/снятия проверок. Starlette TestClient и GitHub Actions Node20 deprecation — advisory, не failures; обновление action runtime не часть AUTH-005.

Завершение: docs-only evidence commit/push сохраняет актуальные task status, report, project memory/handoff, AGENTS/CLAUDE. Для этих metadata проверены check.py/harness/diff; application/test/contract files остаются точной версией успешного implementation CI. Новые ready задачи не начинались. Следующая AUTH-006 требует отдельного обсуждения и ответов владельца.
