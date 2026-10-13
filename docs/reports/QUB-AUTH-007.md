# AUTH-007 — Новый Qubite Auth, 13–14.10.2026

Статус: done в согласованных границах, Git/CI/private demo подтверждены. [ADR-0024](../architecture/decisions/0024-public-landing-and-qubite-auth.md).

## Согласованные решения и результат

Три вопроса заданы до задачи, владелец ответил: без сессии сайт показывает лендинг → отдельный Qubite Auth → обычная главная; Android открывает системный браузер (native completion отдельно); подготовить новые условия/приватность/cookies/data consent; приглашение и по ссылке, и вручную. Не повторять approval loop. Дополнительный legal вопрос: оператор/статус/контакт/страны; ответа ещё нет.

apps/web0.3.0: общий useAppearance и существующий src/material, выбранные Поток/Игрушечная/Лента/Unbounded/Manrope100/503. Phone/landscape/desktop, themes/reduced/user quiet, stable fields, native Enter/show-hide/autocomplete, доступные labels/status/alerts/skip links. Landing отдельно от authenticated Command shell. Secret forms не копируются в outgoing MorphContent snapshots; quiet buttons сохраняют явный type, consent switch disabled при отправке. Исправлены structural position material password toggle/skip link.

Live формы использовали **existing** FastAPI API: fresh CSRF перед каждым submit, single-use preauth, HttpOnly cookies/no-store/redirect guards, generic bounded errors, timeout10s/dedup/Abort/stale cancellation. После login настоящий новый GET me/access, сервер единственный authority. Registration/public/invite/disabled/technical consent version из API; новый account pending, verify explicitPOST→явный вход; reset explicitPOST→все сессии revoked→новый вход. Нет module/AI/owner grants от регистрации.

Invite typed token или same-origin fragment link, duplicate/unknown params/foreign origin rejected. Proof UUID/token в email fragment до первого render/API очищается из URL, в transient input state; после завершения clear, props очищаются, при новой ссылке той же route формы сбрасываются. GET не подтверждает данные и не выполняет reset. Старого account code-entry нет.

Профиль: настоящие own session list/current/last activity/revoke, logout, explicit own-password reauth/logout-all, explicit provider link/unlink с own password. OAuth кнопки только server availability, HTTPS exact endpoint allowlist. Core callback для browser navigate+AcceptHTML fixed303 completion/linked/errorallowlist без proofs/returntarget; JSON behaviour сохранён и OpenAPI303 отражён. Unknown identity не auto-enroll/link-by-email. После callback fresh server profile/access. Core schema0007/runtime0.6.0 unchanged, новые native/SMTP/provider keys не включены.

## Документы и границы

[Четыре полных новых legal документа](../legal/README.md), единый UI JSON/Markdown mirror/hash. Два независимых unchecked choices в форме: условия/отдельное data consent. AUTH-006 API сохраняет technical package bool/version/time/source; он не доказывает будущие независимые purpose consents. QUB-LEGAL-001 до публичного deploy: фактические реквизиты/страны/право/подрядчики/сроки/evidence, без выдуманного compliance. Current publication_ready=false, прочитать без входа можно. No ad/analytics scripts; technical cookie inventory и cosmetic storage описаны отдельно, хостинг демо учитывается отдельно.

Auth — сейчас **экран same-origin**, поддомен пока не выбран/не настроен. Native browser PKCE/verified return/secure storage — AUTH-012 и native POC, domain routing/brokers/TLS — deploy; ChatGPT AUTH-016 отдельно, без чужих tokens/обхода eligibility. Настоящих SMTP/provider logins не выполняли. Design-lab/legacy/filledenv/данные/ShadeAI не изменены. Static private demo не сервер Qubite.

## Проверки

Локальный финальный полный web run:71passed1.1m,18desktop+19phone+23live fixtures+11browser/core. В auth-core реальный Chromium→Uvicorn→новый PostgreSQL на loopback: password fail/fresh CSRF/Enter/HttpOnly, registration/оба invites/verify/manual/used proof, disabled mode/mail503, reset/revoke across browsers/logout-all/default no grants, reflow360/640/844landscape/1440, light+dark axe всех auth/legal screens. SQL/почта и bootstrap только synthetic fixtures, никакого существующего runtime/env. Оба demo no-submit сценария прошли targeted и в финальном полном run.

HTTP fixtures: csrf fail/fresh retry,429/503 no auto-replay, abort/stale response/password storage/ghost, provider URL/javascript/spoofed hostname denies, consent mismatch, malicious error code generic, duplicatefragment/returntarget reject. Demo tests доказывают отсутствие POST/credential storage/fake success.

Core/legacy regression975+harness11=986pass. Core groups208/175/202 (27.38/54.07/91.47s),10new OAuth browser callback tests signed MockTransport, JSON contract still valid. Node99/deploy18/Search95/Brief112/Kwork29/SiYuan5/identity32. Python3.13.13/Node22.22.2/PostgreSQL18.6/systemChromium. No failed/skipped final suites; intermediate fixture/UI bugs corrected, их runs не acceptance. Format/typecheck/live+demo builds прошли; snapshots phone/desktop light/dark inspected после structural fixes; статические toy tiles получили свой цвет, RAF indicator ожидался до settle. Physical phone/FPS/keyboard/screenreader/native/SMTP/provider/TLS ingress/legal publication acceptance остаются открытыми.

## Git, CI, публикация и следующий шаг

Base4239201de7c957f7b95a67cf316bc54fe7b7e636. Unrelated .antigravitycli deletion excluded. После staged review/test evidence: русский commit, немедленный push main; web.yml и engineering.yml exact codeSHA. Existing owner-private shell site обновляется, прежний material-lab не меняется. Результаты в completion evidence.

Следующая согласуемая задача — UI-003 server module catalog/owner hidden-vs-locked, затем Owner Console AUTH-004. Перед ней новые вопросы и ответы. AUTH-007 разрешение не распространяется на эти slices. QUB-LEGAL-001 отдельный production gate; runtime SMTP/native/deployment не объявлены завершёнными.

## Подтверждённое завершение, 14.10.2026 местное время

Implementation **ac2c8ef4e895ed690e5f545e0b5f8b82cb6b0950**: русский commit, немедленный push origin main, remote SHA подтверждён. Перед commit/staged review без чужого .antigravitycli удаления, секретов/DB/build/browser state. origin/tournaments и tagqubite-v1.0 повторно проверены96f0457a523b6b79f21c4092056d8fa8fa69a680, без изменения архива.

Exact-SHA [web CI](https://github.com/kirillkuz1122/qubite/actions/runs/38451493363) completed/success2026-10-13T19:03:38Z:71passed1.1m, independent npmci/typecheck/live+demo builds; [engineering CI](https://github.com/kirillkuz1122/qubite/actions/runs/38451493360) completed/success19:06:53Z:975+harness11=986pass. CI PostgreSQL16.15, core groups208/175/202 (48.55/86.46/122.92s). Итого1057 проверок локально и1057 в CI. Expected dependency/action deprecation annotations не ошибки тестов. Это CI implementation SHA; последующий completion docs commit отдельный, не выдаётся за проверенный новым web run.

Existing [private demo](https://qubite-app-shell-kirill.kuzmichevkonstantin9.chatgpt.site) **version3**, source**9c0707a40dc3c504747d4543eab4a3c55e19fb76** из git archive implementation/apps/web. Исходник pushed в прежний Sites Git, compiled demo mode in dist, archive только .openai/hosting.json+dist. Локальный gzip sha256976872be2dd9cf86cb248127650f74e55ea61c794c528eb77917a466f4ffea6c; server-normalized tar content sha2561a0abc8a8fa05a5ca0b42e5dec7a8626c7c7ae28a1d2532ac1912825803d21d1,15files/686080bytes. Saved versionappgprj_6ace5114ca9c8191adc1bd33365fc909~appgver_27af424a26c08191ad220f6e699d0f65; deploymentappgdep_6ace8192efb08191ae7bb0ca82a71245 **succeeded2026-10-13T19:08:19.269750+00:00**. get_site после публикации подтверждает version3/owner/custom/один owner viewer/0groups. Runtime env revision0, filledenv/core/PG не публиковались. Старый material-lab unchanged.

Для телефона: [лендинг](https://qubite-app-shell-kirill.kuzmichevkonstantin9.chatgpt.site/#/welcome), [Auth](https://qubite-app-shell-kirill.kuzmichevkonstantin9.chatgpt.site/#/auth/login); defaultURL по-прежнему fictional shell. Формы просмотра не посылают credentials/POST и прямо объясняют отсутствие real account/email. Реальные API flow проверены отдельным loopback browser/core fixture, не через внешний хостинг.

69tasks:16done/4ready/49backlog. Следующий **UI-003** сначала обсудить; AUTH-007 approval исчерпан этим slice. Operator legal question pending, public launch не выполнен, return-to-native и real mail/provider/ingress отдельно.
