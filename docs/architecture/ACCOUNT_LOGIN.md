# Единый вход без кода аккаунта — AUTH-005

13.10.2026 владелец подтвердил границы: закрепить контракт и проверить существующий новый API; регистрация, React-экраны и подключение Search/Writing/VPN выполняются отдельно. Используется [Web Auth AUTH-009](WEB_AUTH.md), самостоятельный второй Auth не создаётся. Текущий core0.5.0/schema0006_policy не требует нового SQL или изменения HTTP handlers.

[auth-v1.json](../../contracts/auth-v1.json) — проверяемая граница account login, подмножество [identity-v2](../../contracts/identity-v2.json). Фактические DTO/маршруты по-прежнему задаёт [core OpenAPI](../../contracts/core-v1.json). Новый контракт не объявляет будущие native/registration/2FA сценарии работающими.

## Обычный вход

1. Клиент получает одноразовый anonymous CSRF challenge через `GET /api/v1/auth/csrf`.
2. Передаёт JSON только `email` и `password` на `POST /api/v1/auth/session` с exact configured Origin, X-CSRF-Token и preauth cookie. С уже действующей сессией применяется её связанная CSRF proof.
3. Core проверяет активный UUID subject, точный Argon2id password и текущую версию credentials; cookie выдаётся только после успешной транзакции.
4. Ответ содержит собственный профиль и metadata сессии. Пароль и raw session token в JSON отсутствуют. Вход не назначает owner, не выдаёт module/model grants или бюджет.

Обязательного legacy login alias нет. `code`, `accessCode`, `access_code`, `account_code`, `invite_code`, `token`, `mode` и `grant_type` не являются полями Login DTO; даже с правильным email/password дополнительное поле даёт `400 invalid_request`. Отсутствующие поля также не заменяются кодом. Ошибки не повторяют присланные секреты. Неверный пароль даёт общий `401 invalid_credentials`.

## Старые маршруты

В новом core `GET` и `POST` следующих URL возвращают `404`, без redirect, создания или замены сессии:

| Известный legacy маршрут | Проверяемое отсутствие нового alias |
|---|---|
| `/api/auth/code-entry` | `/api/v1/auth/code-entry` |
| `/api/auth/code-entry/inspect` | `/api/v1/auth/code-entry/inspect` |
| `/api/auth/login` | `/api/v1/auth/login` |

Проверки выполняются anonymous и с действующей сессией; существующий аккаунт и cookie сохраняются, pending/blocked account не активируется. Это гарантия **нового FastAPI API**, а не утверждение об удалении всех старых исходников. В `back/server.js` прежний самостоятельный code-entry/guest flow ещё существует; legacy Search/Writing/VPN также пока используют свои старые consumers. Их перенос — отдельные задачи.

Для будущего ingress пространство нового account Auth направляется исключительно в core, **без fallback к Node при 404 или недоступности core**. Старый tournament guest flow не публикуется как альтернативный вход новой платформы. Проверить фактическое маршрутизирование в staging до деплоя; AUTH-005 не меняет сервер/Nginx и не проверяет production. Недоступная identity закрывает доступ.

## Разные значения «кода»

| Сценарий | Authority и назначение | Создаёт вход в новый core? |
|---|---|---|
| Старый account code-entry | Отсутствует в новом API | Нет |
| Shared tournament invitation | Node/SQLite `POST /api/tournaments/{id}/join`, после participant login и verified email | Нет, только запись в турнир |
| Personal tournament invitation | Тот же module join, код связан с участником roster | Нет; чужой код/чужой roster отвергаются |
| Подтверждение email | Existing UUID, one-use proof `qbt_ev_`, отдельные request/confirm API | Нет; требуется обычный вход после подтверждения |
| Восстановление пароля | Existing verified UUID, `qbt_er_`, новый пароль и atomic session revoke | Нет; после reset требуется обычный вход |
| OAuth provider code | Configured provider identity, browser state и PKCE; отдельный callback | Может завершить согласованный OAuth flow; произвольный account code не подходит |
| Native authorization code + PKCE | План AUTH-012 | Ещё не реализован |
| Email-2FA challenge | Только protocol contract AUTH-011 | Runtime ещё отсутствует |
| Приглашение для регистрации | План AUTH-006, отдельная enrollment policy | Ещё не реализовано |

Нельзя вводить глобальный запрет поля/строки `code`: это сломает OAuth и будущий native PKCE. Нельзя использовать email proof как пароль, session cookie или bearer: проверяется тип credential, а proof остаётся применим только в своём confirm протоколе. Email verification/reset и OAuth продолжают проверяться отдельными полными suites с памятью/mock transport, без внешних запросов.

Турнирные HTTP tests используют **старую** изолированную SQLite identity для проверки сохранности прежнего модуля. Они не доказывают готовность adapter core UUID→Tournaments: такой adapter ещё предстоит реализовать. В production старую SQLite identity не импортируем и её сессии новым core не принимаем.

## Проверки и восстановление

- `core/tests/test_account_login.py`: actual OpenAPI/subset contract, old-route HTTP matrix, strict DTO, positive owner/member login без module grants, pending/blocked и разделение email proofs/password/session/bearer на disposable PostgreSQL.
- `back/tests/auth-legacy-baseline.test.js`: общие и персональные tournament invitations, чужой roster/неверный код, anonymous/unverified deny, отсутствие новых аккаунтов/сессий при module join. Test preload сначала запускает auth-only copy без workers, затем разрешает workspace только в disposable fixture; настоящие HTTP handlers и middleware не подменены.
- Полный isolated harness запускает также AUTH-009/010/011/003 и существующие сервисные регрессии. Commands/фактические результаты в [отчёте](../reports/QUB-AUTH-005.md).

Нет schema/data migration, удаления старого runtime или deploy. Для снятия артефактов можно отменить этот task commit обычным последующим commit, сохранив UUID, passwords, sessions, grants и audit; возвращать code-entry в новый Auth или восстанавливать старую SQLite identity поверх PostgreSQL нельзя. Следующая согласовываемая задача — AUTH-006 минимальная регистрация; вопросы/ответы владельца обязательны до её реализации.
