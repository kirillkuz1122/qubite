# Qubite · Milo Material Lab

Milo выбран владельцем как стилистическая основа. Новое исследование показывает **пять механик самих элементов управления**; персонажи находятся на отдельном экране. Изолированный React/TypeScript/Vite прототип, синтетические данные, нет core/legacy/API/AI/Telegram/VPN, cookies или storage. Reload очищает состояние.

## Смотреть

[Открыть Milo 02](https://qubite-material-lab-kirill.kuzmichevkonstantin9.chatgpt.site/#/milo/v2/souffle/controls), доступ через ChatGPT владельца. Пять вариантов: **Суфле / Поток / Ореол / Магнит / Лепестки**. В каждом экраны **Потрогать / Интерфейс / Вход / Лендинг / Помощники**. Начни с перетягивания большой кнопки, ползунков, выбора между пунктами и раскрытия меню. Под «Ощущения» — податливость **0–100**, спокойный режим и подсказки. Настройки в памяти этого просмотра; system reduced motion имеет приоритет. Две темы, phone/tablet/landscape preview и адаптация к настоящей ширине браузера.

Маршрут `/#/milo/v2/{material}/{screen}`, например `/#/milo/v2/flux/workspace`. Пустой hash открывает новый Milo. Первая галерея Nacre/Ferro/Folio/Prism/Milo сохранена по прежним `/#/{concept}/{view}`; ссылка «Первое исследование» ведёт туда. Это история, не текущий выбор из пяти несвязанных стилей.

Живые buttons/slider/switch/tabs/navigation, ограниченное движение/cancel, continuous section/auth transitions, меню из кнопки, окно из точки нажатия и возврат фокуса. Точные значения не зависят от задержки декоративной головки. Scripted помощники Луми/Кип/Пип/Сэйдж имеют разные idle жесты и реакции на события/собственный промах. Это не подключённые AI-агенты. В Workspace сохраняются capture/undo/tasks/Search/Writer/VPN/modules/Settings→Owner Console примеры; нулевая квота AI не запускает запрос. Role selector не авторизация.

[Спецификация Milo/характеров](../../docs/design/MILO_MATERIAL_AND_COMPANIONS.md), [ADR-0011](../../docs/architecture/decisions/0011-milo-live-controls.md), [отчёт](../../docs/reports/QUB-DESIGN-001.md).

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

При уже установленном Chromium: `QUBITE_LAB_CHROMIUM=/usr/bin/chromium npm test`. В Linux CI установка зависимостей браузера: `npx playwright install --with-deps chromium`. 98 браузерных тестов (47 прежних + 51 Milo 02): пять размеров × четыре экрана × пять концепций, сценарии, формы, отсутствие API/storage/cookies, отмена устаревшего ответа, keyboard/reduced motion и axe WCAG для обеих тем. Это автоматическая проверка, а не сертификат доступности или проверка настоящего телефона.

## Код

- `src/milo/` — профили, spring solver, настоящие controls, переходы, персонажи и новый главный экран.
- `src/Root.tsx` — новая версия по умолчанию и старые hash-маршруты.
- `src/pages/` — пять отдельных landing-композиций.
- `src/Materials.tsx` — пять собственных CSS/SVG материалов.
- `src/styles.css` — визуальные системы, отдельные реакции и responsive container queries.
- `src/Workspace.tsx`, `Auth.tsx`, `Playground.tsx` — общие тестовые сценарии в каждом визуальном языке.
- `src/concepts.ts`, `fonts.css` — палитры, описание и self-hosted variable fonts.
- `tests/gallery.spec.ts`, `tests/milo.spec.ts` — браузерная верификация; `.github/workflows/design-lab.yml` в корне репозитория — CI без автопубликации.

Manrope и Lora имеют кириллицу; Space Grotesk используется для латиницы с Manrope fallback. Лицензии OFL сохранены в `public/licenses/`. Нет скопированного SDK Liquid Glass, WebGPU, внешних fonts/CDN, аналитики или сохранения browser state. Материалы декоративные и исключены из accessibility tree; текст остаётся на непрозрачных поверхностях.

## Публикация

Отдельный Sites project указан в `.openai/hosting.json`, static.directory = `dist`. Создавать второй site вместо этого project нельзя. Следующий выпуск: проверка → push точного исходника в source repository этого site → build этого SHA → tar с `.openai/hosting.json` и `dist` → save/deploy → terminal status и browser verification. Токен source repository только краткоживущий в памяти процесса, никогда в файлах/URLs/Git. Аудитория по умолчанию private; сохранять её без отдельного запроса владельца.

Milo выбран как стилистическая основа. Финальная механика ещё не принята. [Спецификация направлений](../../docs/design/MATERIAL_DIRECTIONS.md), [auth UX](../../docs/design/AUTH_UX.md), [отчёт задачи](../../docs/reports/QUB-DESIGN-001.md). Следующие product UI/Auth задачи требуют отдельного цикла по harness; демо не переносит аккаунты или данные.
