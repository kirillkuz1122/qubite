# ADR-0019 — вход аккаунта и отдельные кодовые протоколы

13.10.2026, CONFIRMED границы AUTH-005: владелец ответил «Да, закрываем AUTH-005 по этим границам» после вопроса о контракте и проверках нового API без старого code-entry. Registration/UI/Search/Writing/VPN — отдельные задачи, без автоматического старта.

Engineering decision внутри этого slice: использовать существующий Web Auth AUTH-009, зафиксировать его strict email/password DTO и отсутствие старых URL отдельным проверяемым подмножеством identity-v2. Не создавать дублирующий login handler, менять schema или делать массовый рефакторинг. `contracts/auth-v1.json` не заменяет фактический OpenAPI.

| Вариант | Решение и причина |
|---|---|
| Переписать работающий FastAPI login заново | Не выбран: требуемая семантика уже реализована; нужны явные acceptance и регрессии |
| Запретить любое поле/строку code глобально | Не выбран: OAuth, email proofs, tournament invitations и будущий native PKCE — отдельные протоколы |
| Удалить весь legacy code-entry сейчас | Не выбран для этой задачи: новые account routes его не используют; старый optional module и потребители переносятся отдельно |
| Contract + actual HTTP/PG/SQLite boundary tests | Выбран: закрепляет требуемое поведение без нового identity authority и разрушительных изменений |

Старые account URL и их v1 aliases в core404. Login требует только email/password и CSRF; код не обходит active status, не заменяет пароль/сессию и не выдаёт grants. Tournament join сохраняет shared/personal invitation после обычного module authentication; его SQLite fixture не считается будущим core adapter. Email verify/reset не создают web login; OAuth code допустим только внутри отдельного state/PKCE/provider flow. Email-2FA/native/registration invitation пока не runtime.

Будущий ingress не должен fallback-ить из нового account namespace в Node. Это staging/deploy gate, не настроенное AUTH-005 маршрутизирование. Результаты fixtures не являются server acceptance. Обратимость: снять contract/tests/docs последующим commit, сохранять новые PostgreSQL identity данные; архив tournaments/qubite-v1.0 не меняется. [Подробный контракт](../ACCOUNT_LOGIN.md), [отчёт](../../reports/QUB-AUTH-005.md), [fresh identity ADR-0013](0013-fresh-identity-and-unified-login.md).
