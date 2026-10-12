# QUB-DESIGN-001 — Milo и живой материал интерфейса

12.10.2026. **Текущая итерация 2 — review/testing до приёмки новой механики.** Milo выбран владельцем как стилистическая основа; новая физика не выбрана автоматически. Skills, субагенты и quota reset не использовались.

## Новое решение и реализация

Владелец отверг первую трактовку: живым должен быть весь управляющий интерфейс, а не декоративная фигура. Реализованы пять вариантов Milo **Суфле/Поток/Ореол/Магнит/Лепестки**: разные spring/damping/drag bounds, геометрия, свет, возврат и переходы. [Полная спецификация](../design/MILO_MATERIAL_AND_COMPANIONS.md), [ADR-0011](../architecture/decisions/0011-milo-live-controls.md), [исходники](../../assets/design-lab/README.md).

- LivingButton по всей новой workspace/auth/landing сцене, bounded drag, подавление accidental click, cancel/lost capture и keyboard.
- Native range с физической головкой, switch с drag, shared moving selection между пунктами, navigation indicator и continuous section/auth transitions.
- Меню растёт из контейнера кнопки; native dialog из координат trigger и обратно, Escape/return focus.
- «Ощущения»: сила 0–100, quiet/system reduced motion, hints on/off, две темы и четыре device previews. Настройки только в памяти страницы.
- Четыре самостоятельных помощника: Луми/личная жизнь, Кип/проекты, Пип/заметки, Сэйдж/дневник с очками/блокнотом. Собственные idle движения, характеры/фразы и реакция на собственный промах. Scripted contextual hint с dismiss/таймером; реальных AI вызовов нет.
- Основной маршрут `/#/milo/v2/souffle/controls`, пустой hash также новая версия. Первая галерея сохранена по старым hash. Все данные синтетические/in-memory.
- Решения записаны в project memory/handoff/AGENTS/CLAUDE, реестр/карточки/roadmap. Добавлены **UI-002/PET-001/PET-002/PET-003** с dependencies, backlog; всего53, 3 done /1 review-testing /3 ready /46 backlog.

## Проверка итерации 2

**98/98 Playwright pass, 2.2 min, без retry/skip:** прежние47 + новые51. Chromium153.0.8010.52, Node22.22.2; TypeScript/build/Prettier проходят. Пять экранов × пять механик × 320/360/768/1440 и 844×390: no overflow/errors/external assets. Axe WCAG2A/AA/2.1AA обеих тем, открытые настройки и dialog. Drag submit не отправляет native form; обычное нажатие работает. Drag bounds/return/no accidental click/cancel, native slider extremes/keyboard, switch cancel, pill drag/keyboard, menu/dialog/Escape/focus, strength0/100/system quiet, сохранение заметки между разделами, inert cleanup/no duplicate IDs, разные персонажи/own error/hints off, соседний свет, touchscreen tap, no storage/cookies. После взаимодействия RAF прекращается (измерена стабильность счётчика callbacks), FPS/энергопотребление на физическом устройстве не измерены.

При проверке исправлены отмена жеста, которая могла запустить кнопку, reduced motion drag suppression, StrictMode cleanup RAF, container query name и контраст заголовка. Тесты различают текущий доступный контент и уходящий inert слой; rules доступности не отключались. Авторизация/финансовые/сервисные данные в test artifacts отсутствуют.

Bundle: JS310.69kB/gzip94.42kB, CSS106.80kB/gzip22.28kB, fonts120.62kB. Большая часть JS — React и обе сохранённые галереи. Это лаборатория, не установленный native client. Phone emulation/touch тесты не заменяют physical Safari/Android/performance acceptance.

Existing regression: **386/386 pass** (Node94/deploy18/Search95/Brief112/Kwork29/SiYuan5/core29 + harness4), native temp PG18.6, Python3.13.13, isolated source-copy, без production/external API. Итого **484 автоматические проверки**. check.py:53 tasks/46 docs/links/dependencies pass; git diff --check pass. Известное предупреждение Starlette/httpx остаётся. Main/publication/CI evidence ниже после успешного завершения.

## Приёмка

Milo base подтверждён. Податливость — настройка, не новый вопрос о фиксированном числе. Разные инициативные характеры подтверждены; имена/точные фразы/voice/cooldown/agent permissions уточняются отдельно. После просмотра новой версии владелец выбирает механику или конкретное сочетание движений. DESIGN-001 не done до этого; downstream product migration не началась. Separate demo publication не live Qubite deployment.

## Выпуск 2 — 13.10.2026 по времени владельца

[Открыть новую лабораторию](https://qubite-material-lab-kirill.kuzmichevkonstantin9.chatgpt.site/#/milo/v2/souffle/controls). Reuse private project `appgprj_6acd2105bee8819190dbdce429d5a541`; audience не менялась. Source **5c6fd389cf432cab56fd8fa7f57c698704cab707** committed/pushed, remote HEAD сверён. Saved **version2** `appgprj_6acd2105bee8819190dbdce429d5a541~appgver_2f208e24ad7c8191a0c346506f6a1a32`, source SHA проверен отдельным read API. Deployment `appgdep_6acd3047a53c8191bcde1e643dfe55be` **succeeded 2026-10-12T19:09:35 UTC** (13.10 00:09:35 Asia/Yekaterinburg).

Локальный архив build output приготовлен из pushed checkout, но его передача через file endpoint получила 403 Forbidden. Сохранённая version2 опубликована через remote build fallback из того же source SHA; локальный tar не выдан за загруженный. Токен краткоживущий, только process memory, не записан в Git/URL/файлы. Ни site, ни access gate, ни hostname не заменялись; CI без автопубликации.

Локальные visual/browser проверки подтверждают поведение исходника; внешний browser по-прежнему требует ChatGPT входа. Владелец подтвердил доступность первой версии сам; post-login/physical phone acceptance именно новой механики ждёт его оценки. Публикация подтверждена Sites, это отдельное статическое демо, не deploy работающего Qubite. Main implementation **2b10ba365f6035bdfb92cdbd34e56a6829095c5c** pushed/remote exact SHA verified. GitHub Actions [Material Lab38295994465](https://github.com/kirillkuz1122/qubite/actions/runs/38295994465) и [verification38295994336](https://github.com/kirillkuz1122/qubite/actions/runs/38295994336) **completed/success** для точного implementation SHA. Это подтверждает код этого выпуска; последующий docs-only evidence commit не меняет bundle.

## Первое исследование — история

12.10.2026. **Первая версия создана/опубликована; её механика не принята владельцем.** Прямой запрос: пять максимально разных оригинальных React-концепций, живой материал, landing/workspace/auth/mobile/animations и ссылка для телефона. Skills, субагенты и usage reset не использовались.

[Открыть демо](https://qubite-material-lab-kirill.kuzmichevkonstantin9.chatgpt.site). Приватный доступ через ChatGPT аккаунт владельца. [Исходники/запуск](../../assets/design-lab/README.md), [полная спецификация пяти направлений](../design/MATERIAL_DIRECTIONS.md), [Auth UX](../design/AUTH_UX.md), [ADR-0010](../architecture/decisions/0010-material-lab.md).

## Сделано

- **Nacre**: матовая керамика, свет/рельеф/податливые диски; тёплый спокойный interface.
- **Ferro**: магнитная масса/соединение капель/сигнал, графит и лайм; строгая плотная navigation.
- **Folio**: бумага/сгибы/чернила/закладка, Lora, редакционная composition.
- **Prism**: 38 световых нитей/натяжение/узлы, непрозрачные navy panels.
- **Milo**: собственные мягкие персонажи, gaze/privacy/spring/reaction, сирень/оранжевый/обводки.
- Пять отдельных landing React-компонентов; у каждого также Workspace/Auth/Material — 20 сцен, две темы, device preview на container queries, direct hash links, touch действия и спокойный режим.
- Working demo: quick capture+undo, tasks/progress, документы, synthetic Search, Writer fixed suggestion+safe undo, visual VPN connection, modules denied/uninstalled, Settings→Owner Console, grant при budget $0, synthetic load. AI/API/network requests отсутствуют.
- Login/register/reset минимальной формы, validation/consent/password privacy/loading/success/error/OAuth-unavailable, cancellation stale response. Никаких account code-entry/турнирных регистрационных полей/данных хранения.
- React19.3.0/TS5.9.3/Vite8.3.4, pinned lock, own CSS/SVG icons/materials, self-hosted Manrope/Lora/Space Grotesk+OFL, 47 Playwright tests и отдельный CI без автопубликации.
- Обновлены design spec, task registry/card, project context/handoff, README/AGENTS/CLAUDE/ADR и карта docs. Legacy runtime не редактировался.

## Реальная верификация

```sh
cd assets/design-lab
npm ci
npm run format:check
npm run build
QUBITE_LAB_CHROMIUM=/usr/bin/chromium npm test
```

**47/47 pass, 51.8 s**, retries/skips 0; Chromium153.0.8010.52, Node22.22.2. Все 20 сцен на 320/360/768/1440 и 844×390: no horizontal overflow/page errors/external requests. Scenarios capture/undo/tasks/search/Writer/VPN/modules/Console/role; auth validation/consent/privacy/stale cancellation/no storage/cookies/POST. Axe WCAG2A/AA/2.1AA для четырёх экранов × обеих тем × пяти направлений, keyboard skip и reduced motion. Синтетические screenshots 40 штук генерируются в ignored test-results, CI сохраняет их как временный artifact. Визуально просмотрены все направления в локальном browser, mobile auth и desktop compositions.

При разработке проверки выявили контраст muted labels в альтернативных темах, безымянные icon buttons Ferro и перекрытие checkbox декоративным элементом. Исправлены semantic colors/aria-labels/native input overlay; полный финальный прогон проходит без отключения axe rules. Первый typography/font import был исправлен на self-hosted subset font-face. Финальный lock audit: 0 vulnerabilities на момент установки, не гарантия будущей безопасности пакетов.

Bundle из опубликованного source SHA: JS276.54kB / gzip84.41kB, CSS78.07kB / gzip16.06kB; пять WOFF2 суммарно120.62kB. No WebGPU/external font/CDN/assets. Нет measured FPS/реального телефона/Android/Desktop application acceptance.

```sh
python3 scripts/engineering/verify.py --suite all --python /tmp/qubite-design-tests/bin/python --postgres-bin /tmp/qubite-design-postgres/usr/bin
python3 -m unittest discover -s tests/engineering
python3 scripts/engineering/check.py
git diff --check
```

Existing **386/386 pass**: Node94/deploy18/Search95/Brief112/Kwork29/SiYuan5/core29/harness4. Test Python3.13.13, PG18.6 temporary extracted Arch packages, SHA256 checked against local pacman repository metadata; no sudo/system PostgreSQL install/live DB. Source-copy, isolated HOME/SQLite/temp PG, no external API. Existing Starlette/httpx deprecation остаётся. Combined automated result **433 pass** (386+47); обязательные checks/docs/staged review отдельно.

## Публикация и границы

Separate Sites owner-private project `appgprj_6acd2105bee8819190dbdce429d5a541`, точный source push SHA **f5fa089bc899db5747b4ebfac40abd7d7afc2073**, remote SHA verified. Archive собран из этого committed checkout, содержит только hosting config/dist output. Saved version `appgprj_6acd2105bee8819190dbdce429d5a541~appgver_192d3a60fde481919e0960edd852d0c3`, deployment `appgdep_6acd22019c788191a4a1bd83abf4780a`, **succeeded 2026-10-12T18:08:19 UTC**. Token не сохранён в файлах/Git/URL. Source project/config сохраняется для следующих публикаций, второй site не создавать.

Внешняя ссылка открыла ChatGPT access gate; автоматический review ранее отклонил browser sign-in без подтверждения аккаунта. Владелец затем ответил «уже все посмотрел все работает»: доступность первой публикации подтверждена им самим. Не повторять вход/вопрос. Это не принятие дизайна: следующий feedback выбрал Milo base, но отверг механику первой версии. Локально тот же source/artifact проверен browser tests и визуально. Private audience сохранена; никакого production Qubite deploy/autodeploy нет.

Рабочие back/front/index/deploy/core DB/services, .env/keys, tournaments archive/tag и ShadeAI не менялись. Не подключены реальные Auth/search/writing/VPN/Telegram/AI. Role/grants/load — синтетические для UX, не authorization implementation. Известные AUTH-L01..03 из TEST-001 не исправлялись; backup/cutover остаются отдельными задачами.

## Следующий шаг после первой версии

Владелец выбрал Milo; дальнейшая итерация описана выше. Первоначальный план: владелец выбирает направление или сочетание деталей. После доработки фиксируются final tokens/motion и пользовательский acceptance; только затем DESIGN-001 done и downstream UI implementation. Пока **3 done /1 review-testing /3 ready /42 backlog**, 49 карточек. AUTH-008/DEPLOY-001/TG-001 доступны как отдельные bounded specifications, не начинались этим циклом.

Первая main версия: **0173d747b954c25ff48310a9b79ed8033918250a**, origin main подтверждён. GitHub Actions **Material Lab38289913101** и **verification38289913120** завершены success, проверены в текущем цикле.
