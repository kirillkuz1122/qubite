# Identity и permissions

CONFIRMED: только один platform_owner на старте, owner status не переключаемый role slug. Global organizer/moderator/admin отсутствуют. Последнее решение 12.10.2026: новые платформенные Auth APIs создаются на FastAPI/Postgres, минимальная регистрация без account code-entry и новый React UI. Старый Auth authoritative только для ещё не migrated consumers до отдельного verified identity cutover ([ADR-0005](decisions/0005-identity-transition.md)); trusted internal introspection с timeout, audience, revoke/status проверкой; нельзя доверять forwarded user header из интернета. Bridge failure → deny.

Authorization цепочка: authenticated active subject → global module installed/enabled → explicit module entitlement → action capability → workspace membership + object ACL + explicit deny → tool/provider/model allowlist → quotas/reserved budget. Все REST/WS/jobs/MCP/plugins проходят её. Роли workspace editor/viewer и tournament organizer не дают platform capabilities.

| Субъект | Профиль/свои сессии | Owner Console | Docs ресурс | Tournaments | Paid AI |
|---|---|---|---|---|---|
| Новый account | да | нет | только explicit grant + ACL | explicit grant + scoped role | нет |
| Docs granted | да | нет | свой/разрешённый | нет без grant | нет без model/budget |
| Tournament organizer/admin | да | нет | нет без grant/ACL | scoped только | нет без grant |
| Platform owner | да | management privileges | self grants + resource policy | self grant/explicit tournament access | self model grant + nonzero budget |
| Guest/shared link | scoped view | нет | только разрешённое представление | нет автоматически | нет автоматически |
| MCP/plugin/agent | intersection initiator/token/tool scopes | нет по умолчанию | subset ACL | subset | отдельный budget gate |

Не добавлять owner plaintext read bypass Private Vault. Для управления владельцем — separate reauth/offline recovery/one active owner invariant; этот flow не входит в обычный user edit. Источник нынешнего owner удостоверить по active DB на сервере, не угадывать email/ID. Telegram owner whitelist отдельно сопоставляется с subject, не автоматически выдаёт core owner любому tg moderator.

Registration mode owner-controlled: invite/manual first, public separately. Default-deny новых аккаунтов: вход/профиль/sessions/пустая оболочка. Публичная ссылка, team membership, подтверждённая почта не выдают модули/деньги. Module revoked → deny следующего API/tool/job, stop subscriptions, invalidate caches/search projection authorization, retain data до retention решения. Нельзя обещать удалить уже скачанную offline копию с чужого устройства: encrypt local store/short-lived session и честные ограничения.

## Migration mapping

users.role=user → subject, grants по audited legacy services. organizer/moderator/admin → tournament-scoped membership/capability, никаких users.manage/modules.manage. owner → verified singleton platform_owner; собственные module/model grants устанавливает owner явно, legacy auto-paid не наследуется. Role preview actual_role никогда не authority. Старые admin endpoint'ы остаются legacy surface, routing не делает их core management API. Новые global privileges включаются только после отрицательной compatibility матрицы.

Тесты: все 10 кейсов access document; anonymous/blocked/revoked session, cross workspace, owner без budget, hidden UI + прямой URL/API, WS reuse после revoke, grant изменён во время job, model allowed but action denied, cache title/count/edge leakage. Проверять provider call counter==0 на deny. Public share создаёт view capability с resource/expiry, не обычную paid session.

Support grants отдельно support.read/reply/manage, owner выдаёт выбранным сотрудникам, не global/tournament moderator role. Linked Telegram capture reauthorizes each action/model/budget; guest сообщения лишь Support. Никакого автоматического Docs/AI grant из факта сообщения боту.
