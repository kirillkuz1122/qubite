# Глобальные переключатели Owner Console — AUTH-015

**Пожелание владельца13.10.2026, backlog; не реализовано этим документом.** AUTH-006 реализует backend режимы регистрации, React Console пока отсутствует. Перед AUTH-015 нужны вопросы о поведении существующих сессий, технических работах и восстановлении доступа владельца.

## Аудит старого источника

В `back/src/db.js` defaults system_settings: maintenance_mode, registration_enabled, email_enabled, OAuth Google/Yandex/VK/Telegram, tournament_creation_enabled/participation_enabled и proxy_naive_enabled. `back/server.js` применяет maintenance middleware, register guard и tournament controls; `back/src/telegram/handlers/settings.js` меняет значения. У старого maintenance есть bypass_token в URL/cookie — это исторический факт, **не целевой механизм нового core**. Отдельный глобальный login_enabled этим просмотром не подтверждён; новый запрет входа — запрос владельца. OAuth provider disable уже существует в новом AUTH-010 через trusted operator, общий Console API и UI отдельно.

## Целевой набор

| Переключатель | Семантика / статус |
|---|---|
| Регистрация | disabled/invite/public, runtime AUTH-006; UI AUTH-004 |
| Вход | отдельно от регистрации; password/OAuth/native/keys и уже активные sessions нужно согласовать AUTH-015 |
| Техработы | readable status/safe503, whitelist health/recovery/owner Console; поведение jobs/WS/бота уточнить |
| OAuth providers | включать/выключать каждый, current config/version recheck callback; real configs/keys gated |
| Email transport | kill-switch с сохранением pending accounts/proofs/outbox; retry без повторных отправок, SMTP отдельно |
| Модули/интеграции | AUTH-003 independent installed/enabled/entitlements; не смешивать grant и runtime control |
| Турнирные создание/участие/рейтинг | только Qubite Tournaments → Настройки; без глобальных прав |
| VPN ноды/протоколы | управление модулем VPN; выключение пользовательского протокола не выключает management API нод |

Trusted owner recovery нужен до появления toggle, способного заблокировать owner. URL-секреты и public owner bypass не использовать. Серверный deny должен работать в REST/callback/session issuance/native/keys/WS/jobs, а не только скрывать кнопки. Mutations versioned/reauthed/CSRF/idempotency/audited с показом diff. Telegram вызывает те же scoped команды; live deploy не следует из переключения UI/commit.

Требование записано в tasks.json/AUTH-004. До согласования конкретных semantics не менять глобальный AuthGuard и не считать legacy settings новым policy authority.
