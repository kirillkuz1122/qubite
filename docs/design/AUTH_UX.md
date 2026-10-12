# Новый Auth UX — reviewable спецификация

12.10.2026, QUB-DESIGN-001. [Пять рабочих React-макетов](../../assets/design-lab/README.md), [выбор материалов](MATERIAL_DIRECTIONS.md). Target backend — FastAPI/Postgres; никакие identity endpoints этой задачей не реализованы и не мигрированы. Старый Auth продолжает обслуживать свои consumers до verified cutover.

## Потоки

| Экран | Ввод и действие | Состояния макета | Требование будущего production flow |
|---|---|---|---|
| Login | Email, пароль, show/hide, «Войти» | Empty, invalid email, short password, loading, success; private материал при показе пароля | Server-side validation, generic invalid credentials, session/CSRF/rate protection; не принимать данные из декоративного состояния |
| Register | Email, пароль, согласие; «Создать пространство» | Required consent, invalid, loading, success | Политика/условия с действующими ссылками и версиями; email verification; никакого implicit module/model доступа |
| Reset | Email, «Отправить ссылку» | Invalid, loading, одинаковое подтверждение | Одинаковый ответ для существующего/несуществующего адреса, одноразовый token/TTL и revoke, без account enumeration |
| OAuth | Кнопки Google/Yandex/Telegram как визуальный пример | Отдельное сообщение unavailable, внешние запросы отсутствуют | Список из enabled provider configuration; preserve нужные legacy providers, включая VK, после compatibility audit; state/PKCE/callback kill-switch и explicit verified linking |

Согласие в демо означает понимание тестового режима и не является заключением договора. Demo success сообщает, что аккаунт не создан/письмо не отправлено; синтетический таймер не имитирует подтверждение сервера. При смене режима/выходе timer отменяется; устаревший ответ не переключает другую форму. Пока форма busy повторная отправка блокируется.

Минимальная регистрация без обязательных ФИО/школы/класса/турнирной роли. Display name предлагается опционально после verified входа в будущей отдельной реализации. **Account code-entry отсутствует.** Турнирные join codes, email verification, reset/2FA — отдельные механизмы и не отменены этим решением.

## Поведение и доступность

- У каждого поля label, корректные email/password/reset autocomplete, ошибка в role=alert, прогресс/результат в status; фон непрозрачный.
- Пароль скрыт изначально. Toggle имеет доступное имя; материал реагирует `private` при открытом пароле. Персонажи Milo отворачиваются. Это декоративная реакция, не защита секрета; серверная/auth security отдельная.
- Enter отправляет текущую форму, кнопки доступны клавиатурой. Skip link фокусирует концепцию, сохраняя hash route. Не двигать поле во время ввода и не превращать анимацию в условие прохождения.
- Phone — одна колонка, полноразмерные поля/кнопки; desktop — форма и материал; landscape скроллируемый. Две темы, reduced motion и labelled OAuth controls.
- Демо не хранит input, не отправляет POST, не создаёт cookies/localStorage/sessionStorage. Reload очищает форму. Не вводить production credentials для проверки макета.

## Навигация и политика продукта

После реального входа владелец получает обычный home; управляющая Console находится в Settings и показана в макете только для owner. Модули имеют enabled/uninstalled/denied состояния, AI budget $0 предотвращает вызов даже при owner grant. UI не заменяет backend enforcement. Tournament роли не превращаются в global platform staff.

После выбора материала auth компоненты получают его tokens/motion, но формы сохраняют стабильные размеры. Реальный failed/timeout/offline/rate-limited/provider-disabled/expired-link/invalid-token flow ещё требует backend contract и расширенной UI задачи. Нельзя подключить prototype fake success к реальным endpoints как готовую авторизацию.

## Acceptance и следующие зависимости

47 Playwright tests прототипа включают login/register/reset rendering, validation/consent/password state/OAuth unavailable/loading, cancel stale response, отсутствие storage/cookies/внешних POST; полный four-view/two-theme axe и keyboard/reduced motion. Browser tests — synthetic Chromium, не live OAuth/email/device acceptance.

Pending: выбор направления владельцем; реальные provider/state/redirect/API/session contracts; screen reader, password manager, device/zoom проверки; migration/backup/restore и negative linking matrix. **AUTH-L01..03 остаются известными legacy дефектами** из [TEST-001](../reports/QUB-TEST-001.md); unverified linking — P0 gate, нельзя перенести как compatibility requirement. [AUTH-008/009/010 и остальные карточки](../plan/TASKS.md) задают последовательность, DESIGN review не снимает dependencies.
