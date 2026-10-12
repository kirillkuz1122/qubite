# Qubite · Material Lab

Пять самостоятельных React/TypeScript концепций для выбора нового дизайна Qubite. Это отдельный статический прототип, без подключения к core, legacy, авторизации, AI, Telegram или VPN. Все данные синтетические, изменения живут в памяти страницы. Ввод в форму не отправляется и не сохраняется.

## Смотреть

Верхняя панель: **Nacre / Ferro / Folio / Prism / Milo**. У каждой концепции четыре экрана: **Лендинг / Интерфейс / Вход / Материал**. Доступны телефон, планшет, горизонтальный телефон, автоматический размер, две темы и спокойный режим. Системное уменьшение движения имеет приоритет.

Прямые маршруты: `/#/nacre/landing`, `/#/ferro/workspace`, `/#/folio/auth`, `/#/prism/material`, `/#/milo/auth`. Hash-маршруты не требуют серверного SPA fallback. Экран «Материал» показывает палитру, шрифты, восемь реакций и силу движения. На сенсорном экране реакции доступны через касания и действия; курсор не обязателен.

В интерфейсе работают примеры capture/undo, задач, редактирования, Search/Writer/VPN, состояний модулей и Owner Console из настроек. Нулевая квота AI не позволяет запускать запрос даже владельцу. Переключатель роли предназначен только для исследования макета; это не механизм авторизации.

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

При уже установленном Chromium: `QUBITE_LAB_CHROMIUM=/usr/bin/chromium npm test`. В Linux CI установка зависимостей браузера: `npx playwright install --with-deps chromium`. 47 браузерных тестов: пять размеров × четыре экрана × пять концепций, сценарии, формы, отсутствие API/storage/cookies, отмена устаревшего ответа, keyboard/reduced motion и axe WCAG для обеих тем. Это автоматическая проверка, а не сертификат доступности или проверка настоящего телефона.

## Код

- `src/pages/` — пять отдельных landing-композиций.
- `src/Materials.tsx` — пять собственных CSS/SVG материалов.
- `src/styles.css` — визуальные системы, отдельные реакции и responsive container queries.
- `src/Workspace.tsx`, `Auth.tsx`, `Playground.tsx` — общие тестовые сценарии в каждом визуальном языке.
- `src/concepts.ts`, `fonts.css` — палитры, описание и self-hosted variable fonts.
- `tests/gallery.spec.ts` — браузерная верификация; `.github/workflows/design-lab.yml` в корне репозитория — CI без автопубликации.

Manrope и Lora имеют кириллицу; Space Grotesk используется для латиницы с Manrope fallback. Лицензии OFL сохранены в `public/licenses/`. Нет скопированного SDK Liquid Glass, WebGPU, внешних fonts/CDN, аналитики или сохранения browser state. Материалы декоративные и исключены из accessibility tree; текст остаётся на непрозрачных поверхностях.

## Публикация

Отдельный Sites project указан в `.openai/hosting.json`, static.directory = `dist`. Создавать второй site вместо этого project нельзя. Следующий выпуск: проверка → push точного исходника в source repository этого site → build этого SHA → tar с `.openai/hosting.json` и `dist` → save/deploy → terminal status и browser verification. Токен source repository только краткоживущий в памяти процесса, никогда в файлах/URLs/Git. Аудитория по умолчанию private; сохранять её без отдельного запроса владельца.

Финальный стиль ещё не выбран. [Спецификация направлений](../../docs/design/MATERIAL_DIRECTIONS.md), [auth UX](../../docs/design/AUTH_UX.md), [отчёт задачи](../../docs/reports/QUB-DESIGN-001.md). Следующие product UI/Auth задачи требуют отдельного цикла по harness; демо не переносит аккаунты или данные.
