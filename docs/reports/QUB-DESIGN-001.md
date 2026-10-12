# QUB-DESIGN-001 — пять концепций живого интерфейса

12.10.2026. **Артефакт создан и опубликован; задача review/testing до выбора стиля владельцем.** Прямой запрос: пять максимально разных оригинальных React-концепций, живой материал, landing/workspace/auth/mobile/animations и ссылка для телефона. Skills, субагенты и usage reset не использовались.

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

Внешняя ссылка в браузере действительно открыла ChatGPT access gate. Вход для post-login проверки отклонён automatic approval review из-за отсутствия подтверждения intended account; пользователю отправлен отдельный вопрос. Publication success подтверждён connector; post-login UI на внешнем host и физическом телефоне ещё acceptance. Локально тот же source/artifact проверен browser tests и визуально. Private audience сохранена; никакого production Qubite deploy/autodeploy нет.

Рабочие back/front/index/deploy/core DB/services, .env/keys, tournaments archive/tag и ShadeAI не менялись. Не подключены реальные Auth/search/writing/VPN/Telegram/AI. Role/grants/load — синтетические для UX, не authorization implementation. Известные AUTH-L01..03 из TEST-001 не исправлялись; backup/cutover остаются отдельными задачами.

## Следующий шаг

Владелец выбирает направление или сочетание конкретных деталей и даёт правки. После доработки фиксируются final tokens/motion и пользовательский acceptance; только затем DESIGN-001 done и downstream UI implementation. Пока **3 done /1 review-testing /3 ready /42 backlog**, 49 карточек. AUTH-008/DEPLOY-001/TG-001 доступны как отдельные bounded specifications, не начинались этим циклом.

Implementation/main commit и CI evidence добавляются после commit/push отдельным docs follow-up без self-hash цикла.
