# ADR-0016 — явные OAuth identities и одноразовый web flow

13.10.2026. Engineering decision внутри approved AUTH-010 после done AUTH-009; прямое поручение владельца «Делай след задачу». [ADR-0013](0013-fresh-identity-and-unified-login.md), [runtime](../OAUTH_IDENTITY.md).

Provider+issuer+stable subject — единственная OAuth identity authority. Automatic matching даже verified email и implicit provider signup исключены: сначала account Qubite, затем явный link с реальным собственным паролем. Это устраняет legacy AUTH-L03 без импорта чужих identities. Owner остаётся singleton core UUID; Telegram OIDC не даёт прав бота/модуля/AI. Удобство one-click signup отложено до registration/verification и отдельного решения; email из provider не подтверждает email core.

Google/Telegram проверяются как RS256 OIDC по fixed JWKS/issuer/audience/nonce/time. Yandex/VK — по confidential/PKCE code exchange и bound server userinfo, без выдуманной JWT-сигнатуры их profile JSON. Telegram использует актуальный OIDC, legacy widget/direct bot login не перенесён. Минимальные scopes, no persisted access/refresh tokens. Official contracts сверены, live exchanges не выполнялись; ключи и реальная настройка приложений отдельно.

State/browser hashes, TTL300s, browser-cookie derived PKCE/nonce, one-use reserve before network, current provider version/config fingerprint before/after exchange. Disable/re-enable/rotation инвалидируют старый flow. Возврат только на fixed web origin/provider callback; клиентский redirect запрещён, native flow остаётся AUTH-012. Один текущий browser flow: parallel tabs намеренно не поддержаны в этом slice.

Explicit0004 добавляет provider/binding/state/audit и sessions.password_proven; старые password sessions сохраняются. Unlink own password/CSRF и all-own-session revoke; provider disable только останавливает новый вход, отдельный revoke для существующих sessions. DB row locks без удержания во время network; shared PG limits и bounded4 exchange semaphore. Restricted runtime role не переключает enabled и не меняет owner/status/hash.

Network false и четыре disabled rows по умолчанию, trusted local CLI с confirmation вместо ещё не созданной Owner Console. Runtime settings/operator provisioning/TLS/access-log redaction/capacity/backup — separate deployment. Real account/keys/private .env не читались; legacy/дизайн/native/services/bot/production не переключались. Rollback forward compatible сохраняет0004/data, old binary fail closed; никаких destructive down миграций.
