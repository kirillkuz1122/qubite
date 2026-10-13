# AUTH-007 — фактический интерфейс нового Qubite Auth

13.10.2026, apps/web0.3.0. Ответы владельца получены до реализации: website landing → отдельный Auth → home, Android системный browser target, новые legal, invite link+manual. [ADR-0024](../architecture/decisions/0024-public-landing-and-qubite-auth.md). Историческая спецификация прототипа ниже не текущий статус.

Live: /#/ без сессии — landing; /#/auth/login, register, reset, verify-request, verify, reset-confirm — отдельные формы. После успешного POST session — свежие GET me/access, обычная главная. Только API subject/grants, no owner/module/paid bypass; no legacy auth. Hash router сохраняет фиксированную форму, даже при повторном proof для того же пути сбрасывает прежнее состояние.

Для приглашений /#/auth/register?invite=qbt_ri_… (параметр внутри fragment) или ручная вставка typed token/той же same-origin ссылки. Verify/reset ссылки содержат challenge_id и token в fragment. До первого React/API URL очищается; private proof остаётся только в памяти формы. GET ничего не подтверждает; явный POST, затем новый вход. Duplicate params/return_to/чужой origin/type не используются. Ссылка не становится login credential.

CSRF GET перед каждым намеренным POST/DELETE, cookie HttpOnly/Origin exact/no-store/redirect error, strict DTO and bounded errors, 10s timeout, dedup busy/Abort/generation на выходе. Не повторять мутации автоматически. Generic recovery/enrollment responses не утверждают наличие аккаунта или доставку. Mail503 — честный недоступный transport. Подтверждение/пароль не копируются в departing MorphContent; clearSecrets при завершении, unmount при смене формы.

Provider buttons — server availability; fixed HTTPS authorize endpoint allowlist. Explicit own-password reauth/link/unlink в профиле; совпадение email не объединяет identities. Browser callback fixed303 completion, свежий GET identity/grants; JSON contract unchanged. ChatGPT не выдуман как доступный provider: AUTH-016 отдельно.

Профиль: list sessions с реальной current меткой/датой, revoke own other/current, logout, logout-all только после явного password reauth. Изменение пароля отзывает все сессии и не автоматически входит. Native/browser return ещё AUTH-012/Android POC; public auth поддомен/TLS/broker ещё deploy. Same-origin screen уже есть, не domain-wide shared cookie.

UI использует существующий src/material и shared appearance100/503; selected Toy/Ribbon/fonts, stable fields, плавные tabs/scenes, native Enter/show-hide/autocomplete, focus/skip links, responsive phone/landscape/desktop, OS reduce/user quiet/lite. Sign-in не открывает Command до сессии. Landing/main final product contents могут уточняться, no fake domain writes.

[Legal пакет](../legal/README.md) доступен без входа; условия и data consent отдельно, оба unchecked. Consent_version сверяется с API; mismatch blocks registration. Текущий DB evidence технический пакет, не granular consents; публичная готовность QUB-LEGAL-001. Никакой регистрации всех AI/marketing/tracking целей одним checkbox.

Compile-time demo: /#/welcome, auth и legal для визуального просмотра, без credential POST/cookies/token storage/fake email. В live URL/localStorage не включает demo actor. Chromium→реальный FastAPI/disposable PostgreSQL/in-memory mail отдельно от fixture tests; actual phone/SMTP/provider/TLS acceptance отдельно.

---

# Новый Auth UX — reviewable спецификация

**API уточнение AUTH-01013.10.2026:** [фактический OAuth](../architecture/OAUTH_IDENTITY.md) в core0.3.0: GET provider availability, POST same-origin start (anonymous login либо own-password link), внешняя browser navigation/fixed callback. Неизвестная provider identity требует сначала account Qubite, email не объединяет accounts. Будущий UI должен отдельно показывать unavailable/unlinked/conflict, own link/unlink и повторный password login после unlink; формы/demo ниже остаются specimen, не API integration. Не добавлять старый login-by-code.

12.10.2026, QUB-DESIGN-001. [Пять рабочих React-макетов](../../assets/design-lab/README.md), [выбор материалов](MATERIAL_DIRECTIONS.md). Target backend — FastAPI/Postgres; никакие identity endpoints этой задачей не реализованы и не мигрированы. Уточнение13.10.2026 [ADR-0013](../architecture/decisions/0013-fresh-identity-and-unified-login.md): аккаунтов/текущего деплоя нет по сообщению владельца; новый единый core Auth создаётся с нуля. Legacy password/session import/bridge/login alias не нужен. [Контракт](../migration/IDENTITY_CUTOVER.md).

## Потоки

| Экран | Ввод и действие | Состояния макета | Требование будущего production flow |
|---|---|---|---|
| Login | Email, пароль, show/hide, «Войти» | Empty, invalid email, short password, loading, success; private материал при показе пароля | Server-side validation, generic invalid credentials, session/CSRF/rate protection; не принимать данные из декоративного состояния |
| Register | Email, пароль, согласие; «Создать пространство» | Required consent, invalid, loading, success | Политика/условия с действующими ссылками и версиями; email verification; никакого implicit module/model доступа |
| Reset | Email, «Отправить ссылку» | Invalid, loading, одинаковое подтверждение | Одинаковый ответ для существующего/несуществующего адреса, одноразовый token/TTL и revoke, без account enumeration |
| OAuth | Кнопки Google/Yandex/Telegram как визуальный пример | Отдельное сообщение unavailable, внешние запросы отсутствуют | Список из enabled provider configuration; preserve нужные legacy providers, включая VK, после проверки configured provider contract; state/PKCE/callback kill-switch и explicit verified linking |

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

Итоговый Поток/Игрушечная/Лента/Unbounded/Manrope принят13.10.2026, strength100/duration503; прежние Milo review — история. [Flux contract](FLUX_DESIGN_SYSTEM.md). Pending: final product layout/device performance; реальные provider/state/redirect/API/session contracts; screen reader, password manager, device/zoom проверки; fresh-install/backup новых данных и negative linking matrix. **AUTH-L01..03 остаются известными legacy дефектами** из [TEST-001](../reports/QUB-TEST-001.md); unverified linking — P0 gate, нельзя перенести как compatibility requirement. [AUTH-008/009/010 и остальные карточки](../plan/TASKS.md) задают последовательность, DESIGN review не снимает dependencies.
