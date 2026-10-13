# Qubite · Поток / дизайн-система

**Поток выбран владельцем как основа внутри Milo (13.10.2026).** Изолированный React/TypeScript/Vite прототип компонентов/состояний/сочетаний. Окончательное расположение product экранов не выбрано. Нет реальных core/legacy/API/AI/Telegram/VPN вызовов, cookies или storage. Reload очищает настройки и синтетические данные.

## Смотреть

[Поток / витрина 04](https://qubite-material-lab-kirill.kuzmichevkonstantin9.chatgpt.site/#/flux/appearance), доступ через ChatGPT владельца. Разделы **Материал / Образ / Знаки / Помощники / Пример / Вход**. На «Образ»: пять новых наборов цветного пластика (Игрушечная/Аква/Поп/Лимон/Блоки) с ролью цветов и живым примером; пять прежних спокойных схем раскрываются отдельно, пять heading и пять body шрифтов отдельно, податливость 0–100, время перетекания 250–900 мс, лёгкий рендеринг, quiet и hints. Настройки действуют на все разделы, живут в памяти просмотра, system reduced motion приоритетен. На телефоне lightweight по умолчанию.

На «Знаки»: Лента/Орбита/Зерно/Связи/Портал, 12 назначений ×5 семейств, wordmark/app icon/inverse/16–32px/матрица. На «Помощники»: четыре уточнённых силуэта, mouse/touch gaze, восемь состояний, три манеры общения. Реплики сценарные. Появление/уход из края — будущие product сценарии в спецификации, а не готовый dispatcher.

Пустой hash открывает **FluxStudio**. Текущие маршруты `/#/flux/{components|appearance|marks|pets|workspace|auth}`. История: `/#/milo/v2/{material}/{screen}`, первая галерея `/#/{concept}/{view}`. Оригинальные 20 сцен и 25 вариантов Milo сохранены. Их тесты продолжаются по явным историческим маршрутам.

Native controls с bounded drag/cancel/keyboard/no accidental submit; единый sleeping scheduler, непрерывное timed selection с движением по двум осям, menu/dialog/section/auth transitions. Библиотека 22 UI icons, action busy/complete/disabled и field. Workspace сохраняет capture/undo/tasks/Search/Writer/VPN/modules/Settings→Owner Console примеры; role selector не авторизация, quota не вызывает AI.

[Контракт Потока](../../docs/design/FLUX_DESIGN_SYSTEM.md), [персоны/будущие AI границы](../../docs/design/MILO_MATERIAL_AND_COMPANIONS.md), [ADR-0012](../../docs/architecture/decisions/0012-flux-design-system.md), [отчёт](../../docs/reports/QUB-DESIGN-001.md). Выбор владельца после просмотра версии4: **Поток, Игрушечная, Лента, Unbounded/Manrope**, ритм100/503; DESIGN-001 принят и завершён. Эти значения уже defaults опубликованного UI. Проверки производственного UI/целевых устройств относятся к UI-002. [Правила пластика](../../docs/design/COLOR_PLASTIC.md).

## Запуск

Node 22.22+ и npm, из этой папки:

```sh
npm ci
npm run dev
```

Адрес `http://127.0.0.1:4317`. Production bundle: `npm run build`; посмотреть его: `npm run preview`. Разработка не меняет работающие Qubite services.

## Проверки

```sh
npm run format:check
npm run build
npx playwright install chromium
npm test
```

При уже установленном Chromium: `QUBITE_LAB_CHROMIUM=/usr/bin/chromium npm test`. В Linux CI установка зависимостей браузера: `npx playwright install --with-deps chromium`. 133 браузерных теста (47 первоначальных + 51 Milo 02 + 22 Flux 03 + 13 Plastic04): пять размеров × четыре экрана × пять концепций, сценарии, формы, отсутствие API/storage/cookies, отмена устаревшего ответа, keyboard/reduced motion и axe WCAG для обеих тем. Это автоматическая проверка, а не сертификат доступности или проверка настоящего телефона.

## Код

- `src/flux/` — единая витрина, палитры/шрифтовые пары, SVG families, UI atoms, speech examples.
- `src/milo/` — профили, shared RAF/spring/timed solver, controls, переходы и refined персонажи.
- `src/Root.tsx` — новая версия по умолчанию и старые hash-маршруты.
- `src/pages/` — пять отдельных landing-композиций.
- `src/Materials.tsx` — пять собственных CSS/SVG материалов.
- `src/styles.css` — визуальные системы, отдельные реакции и responsive container queries.
- `src/Workspace.tsx`, `Auth.tsx`, `Playground.tsx` — общие тестовые сценарии в каждом визуальном языке.
- `src/concepts.ts`, `fonts.css` — палитры, описание и self-hosted variable fonts.
- `tests/gallery.spec.ts`, `tests/milo.spec.ts`, `tests/flux.spec.ts`, `tests/plastic.spec.ts` — браузерная верификация; `.github/workflows/design-lab.yml` в корне репозитория — CI без автопубликации.

Manrope и Lora имеют кириллицу; Space Grotesk используется для латиницы с Manrope fallback. Лицензии OFL сохранены в `public/licenses/`. Нет скопированного SDK Liquid Glass, WebGPU, внешних fonts/CDN, аналитики или сохранения browser state. Материалы декоративные и исключены из accessibility tree; текст остаётся на непрозрачных поверхностях.

## Публикация

Отдельный Sites project указан в `.openai/hosting.json`, static.directory = `dist`. Создавать второй site вместо этого project нельзя. Следующий выпуск: проверка → push точного исходника в source repository этого site → build этого SHA → tar с `.openai/hosting.json` и `dist` → save/deploy → terminal status и browser verification. Токен source repository только краткоживущий в памяти процесса, никогда в файлах/URLs/Git. Аудитория по умолчанию private; сохранять её без отдельного запроса владельца.

Milo выбран как стилистическая основа. Финальная механика ещё не принята. [Спецификация направлений](../../docs/design/MATERIAL_DIRECTIONS.md), [auth UX](../../docs/design/AUTH_UX.md), [отчёт задачи](../../docs/reports/QUB-DESIGN-001.md). Следующие product UI/Auth задачи требуют отдельного цикла по harness; демо не переносит аккаунты или данные.
