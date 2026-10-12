# ADR-0005: Auth, минимальная регистрация и новый дизайн

Решение 12.10.2026 принято агентом по прямому поручению владельца «сам реши отчитайся»: переиспользовать работающий серверный Auth в переходе; построить новые экраны React и собственную дизайн-систему. SQLite сама по себе не мешает безопасному входу. На этом этапе ничего в runtime не изменено.

Причина: старый Auth обслуживает OAuth, cookie SSO и нативные сервисы. Одномоментная замена создаёт риск блокировки пользователей/сервисов. Серверные guards, password verification, OAuth linking, reset, revoke и подтверждение почты сохраняются и покрываются HTTP characterization. Legacy интерфейс/стили в новый UI не копируются.

Вход по коду: убрать обычный account flow /api/auth/code-entry и /api/auth/code-entry/inspect из нового UI и закрыть выдачу сессий этим способом после проверки потребителей. Это не запрет tournament join codes, owner invitations, email verification/reset или 2FA codes. Перед удалением endpoint тестировать оставшиеся URLs/приложения; не удалять связанные учётные записи/историю.

Минимальная регистрация: email, password и необходимые согласия; повтор password допустим как UI-проверка. Обязательный legacy login заменить внутренним совместимым уникальным alias или обеспечить совместимость DTO без нового обязательного поля. Display name необязателен после входа. Школа/класс/ФИО и прочие турнирные данные запрашиваются только модулем по необходимости. Данные прежних аккаунтов не удалять. Email/password — базовый способ; действующие OAuth способы сохранить при configured grants/kill switches. Owner-controlled invite/public registration policy сохраняется.

Целевой identity store нового core — PostgreSQL. Перенос password verifiers/OAuth subject/session authority отдельной задачей после cross-runtime vectors, стабильного UUID mapping, revoke/logout/SSO/device compatibility и проверенного backup/restore. Ровно один writer/authority в каждый момент. Старый Auth выключать только после миграции всех его потребителей; до этого bridge fail-closed и никакого импорта legacy global roles как platform permissions.

Откат: новая UI route выключается; старый Auth и данные сохраняются. После identity cutover сохранять новые записи и reconciliation plan, не восстанавливать старый snapshot поверх них. Каждый slice сообщает, что переиспользовано, что создано и какие проверки реально выполнены.
