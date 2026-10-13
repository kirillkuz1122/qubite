# Identity и permissions

**AUTH-005, 13.10.2026 — done:** согласованная проверка существующего входа email/password без account code-entry. [Границы API](../architecture/ACCOUNT_LOGIN.md), [отчёт](../reports/QUB-AUTH-005.md), [ADR-0019](../architecture/decisions/0019-account-login-boundary.md). Core0.5.0/schema0006_policy и runtime без изменений; old routes404/strict DTO, email proofs отдельно, shared/personal tournament join сохранён. Local+CI all892+harness6=898pass; implementationcf302d9 / CI38385240872 completed-success10:47:23UTC. Далее AUTH-006 минимальная регистрация; сначала вопросы и ответы владельца. Предыдущие milestones ниже исторические, актуальный статус в tasks.json/LAST_HANDOFF.

**AUTH-00313.10.2026 — done:** core0.5.0/schema0006_policy; раздельные ручные module/action grants, workspace/resource intersection, owner-only metadata commands с If-Match/idempotency/reauth/audit. Общий REST/job/tool/WS gate, live revoke/session/expiry/version; paid AI закрыт до AI-001/002. [Контракт](POLICY_GATE.md), [отчёт](../reports/QUB-AUTH-003.md). Только аккаунт до grants подтверждено владельцем; перед каждой будущей задачей сначала вопросы и ответы. UI/registration/real modules/installer/native/provider/deploy отдельно. Final local+CI all844+harness6=850pass; implementationd4c813e/CI38381905595 completed-success10:17:52UTC. Registry56:10done/4ready/42backlog, evidence в tasks.json/LAST_HANDOFF. Прежние snapshots ниже исторические.

**Актуальное AUTH-01013.10.2026:** core0.3.0/current0004_oauth, [OAuth adapters/explicit link/unlink](OAUTH_IDENTITY.md), [report](../reports/QUB-AUTH-010.md). Identity-v2 partial runtime AUTH-009/010, текущих core tables10, metadata readonly readiness/old password sessions проверяются. Реальные provider keys/network/deploy/UI не использованы; снимки AUTH-002/009 и legacy audit ниже исторические. Policy/native/registration/reset/keys/services ещё отдельные задачи.

**AUTH-00913.10.2026:** фактические password/CSRF/session/reauth/revoke API реализованы; [контракт/границы](WEB_AUTH.md). Identity возвращает только own profile/session metadata, platform_owner не module/AI grant. Policy/Console/OAuth/native/keys остаются отдельными задачами; прежние статусы реализации ниже исторические.

**AUTH-00213.10.2026:** [account storage/local bootstrap](IDENTITY_SCHEMA.md) реализованы; owner active singleton ограничен БД, новая ordinary account pending/unverified. Пароли/сессии/public Auth/entitlements/budgets ещё не реализованы, никакого paid bypass/grant bootstrap не назначает.

CONFIRMED: только один platform_owner на старте, owner status не переключаемый role slug. Global organizer/moderator/admin отсутствуют. Последнее решение 12.10.2026: новые платформенные Auth APIs создаются на FastAPI/Postgres, минимальная регистрация без account code-entry и новый React UI. **13.10.2026:** fresh core identity без старых аккаунтов/bridge по [ADR-0013](decisions/0013-fresh-identity-and-unified-login.md). [Контракт](../migration/IDENTITY_CUTOVER.md): новые UUID, explicit local owner bootstrap, единый браузерный вход, native PKCE и scoped API keys. Отдельные движки проверяют credentials через private core introspection с timeout/audience/revoke/status; нельзя доверять forwarded user header из интернета. Identity unavailable → deny, stale positive cache отсутствует. Это specification, не существующий Auth runtime.

Authorization цепочка: authenticated active subject → global module installed/enabled → explicit module entitlement → action capability → workspace membership + object ACL + explicit deny → tool/provider/model allowlist → quotas/reserved budget. Все REST/WS/jobs/MCP/plugins проходят её. Роли workspace editor/viewer и tournament organizer не дают platform capabilities.

| Субъект | Профиль/свои сессии | Owner Console | Docs ресурс | Tournaments | Paid AI |
|---|---|---|---|---|---|
| Новый account | да | нет | только explicit grant + ACL | explicit grant + scoped role | нет |
| Docs granted | да | нет | свой/разрешённый | нет без grant | нет без model/budget |
| Tournament organizer/admin | да | нет | нет без grant/ACL | scoped только | нет без grant |
| Platform owner | да | management privileges | self grants + resource policy | self grant/explicit tournament access | self model grant + nonzero budget |
| Guest/shared link | scoped view | нет | только разрешённое представление | нет автоматически | нет автоматически |
| MCP/plugin/agent | intersection initiator/token/tool scopes | нет по умолчанию | subset ACL | subset | отдельный budget gate |

Не добавлять owner plaintext read bypass Private Vault. Для управления владельцем — separate reauth/offline recovery/one active owner invariant; этот flow не входит в обычный user edit. Существующего owner не ищем на сервере: владелец разрешил создать заново. Явный local bootstrap атомарно назначает singleton owner; публичная регистрация/email/role/header не назначают его. Telegram owner whitelist отдельно сопоставляется с subject, не автоматически выдаёт core owner любому tg moderator.

Registration mode owner-controlled: invite/manual first, public separately. Default-deny новых аккаунтов: вход/профиль/sessions/пустая оболочка. Публичная ссылка, team membership, подтверждённая почта не выдают модули/деньги. Module revoked → deny следующего API/tool/job, stop subscriptions, invalidate caches/search projection authorization, retain data до retention решения. Нельзя обещать удалить уже скачанную offline копию с чужого устройства: encrypt local store/short-lived session и честные ограничения.

## Новая identity и scoped permissions

Новый subject UUID/email/status/auth_version, singleton platform_owner; нет импорта legacy roles/grants/паролей/сессий или mapping integer→UUID. Registration не выдаёт модулей/денег. Optional Tournaments хранит только scoped роли и собственные tournament data; core subject — явный reference, старый users.role не становится platform capability. API principal подтверждает идентичность/audience/scopes, но не заменяет resource ACL или atomic budget reserve. Role preview actual_role никогда не authority. AUTH-002 schema/bootstrap → AUTH-009 password/sessions → AUTH-003 policy. AUTH-012/013/014 отдельно обеспечивают native/keys/service-engine flow.

Тесты: все 10 кейсов access document; anonymous/blocked/revoked session, cross workspace, owner без budget, hidden UI + прямой URL/API, WS reuse после revoke, grant изменён во время job, model allowed but action denied, cache title/count/edge leakage. Проверять provider call counter==0 на deny. Public share создаёт view capability с resource/expiry, не обычную paid session.

Support grants отдельно support.read/reply/manage, owner выдаёт выбранным сотрудникам, не global/tournament moderator role. Linked Telegram capture reauthorizes each action/model/budget; guest сообщения лишь Support. Никакого автоматического Docs/AI grant из факта сообщения боту.

## Проверенный legacy baseline — 12.10.2026

[QUB-TEST-001](../reports/QUB-TEST-001.md) проверяет 25 сценариев настоящего server.js в disposable fixtures. После ADR-0013 перенос legacy subjects/сессий не нужен; characterization сохраняет знания о дефектах: malformed cookie безопасно отклонять, runtime OAuth switch перепроверять в callback, email-only account linking с `email_verified=false` запрещать. AUTH-L03 — P0 gate identity cutover/account linking; реальная эксплуатация provider не проверялась. Эти negative requirements относятся к QUB-AUTH-008/009/010, без изменения действующего runtime в baseline задаче.
