# Клиент Qubite 2.0 — UI-001/002

Новая React/TypeScript оболочка0.2.0. Не импортирует legacy или runtime дизайн-витрины. Главная/модули/входящие/профиль/настройки, отдельный owner entry в настройках; Command закреплён снизу. [Решение и границы](../../docs/architecture/decisions/0022-web-shell-and-command.md).

```sh
npm ci
npm run build
npm run build:demo
npm run format:check
npx playwright install chromium
npm test
```

`build` создаёт **dist — live**, `build:demo` — **dist-demo — вымышленные аккаунты и временный текстовый пример**. Выбор ветви выполняется при сборке; URL, cookies и localStorage не включают демо в live. Нельзя публиковать dist-demo как клиент рабочего API. Секретных env/build settings нет. Fonts локальные через Fontsource (OFL), другие зависимости зафиксированы package-lock.

`npm run dev` — live на127.0.0.1:4321. Для демо: `npm run dev -- --mode demo`. Собранное демо: `npx vite preview --host 127.0.0.1 --port 4321 --outDir dist-demo`. Для локального Chromium тестам можно указать `QUBITE_WEB_CHROMIUM=/usr/bin/chromium`. Playwright сам поднимает два отдельных preview сервера4321/4322; перед тестами оба порта свободны. CI устанавливает собственный Chromium.

Live читает existing same-origin `GET /api/v1/me` и `/api/v1/me/access` с cookies/no-store; API ingress ещё отдельная deploy задача, dev proxy отсутствует. Формы входа/регистрации — следующая AUTH-007. Ответы проверяются, права раздельны, stale owner очищается при повторной проверке/ошибке. Сервер остаётся authority; список карточек не выдаёт grants. Owner не обходит read/paid gates.

Каталог пока описывает будущие модули: granted → «готовится», ungranted live → hidden. Server filtered metadata и owner persistence hidden/locked — UI-003; demo controls меняют только память текущей страницы. Выбор аккаунта/перезагрузка очищает demo записи Command. Только cosmetic dark/quiet/strength/duration/lite preferences сохраняются в localStorage. Голосовой диалог не вызывает микрофон. Нет сервера входящих, AI, native/offline sync или автоматического подключения старых сервисов. Tournaments не встроен в каталог.

Тесты live используют HTTP fixtures существующих DTO, это не full-stack browser/backend acceptance. Остальной core проверяет отдельный disposable PostgreSQL harness. Emulated touch/visualViewport/узкий viewport не заменяют физическую клавиатуру телефона, browser zoom или screen reader. Следующая приёмка устройства проводится с владельцем.

Материал в `src/material/` выделен из готовой витрины: настоящие выбранные controls/physics, не новая стилизация. [Карта assets и адаптаций](../../docs/design/MATERIAL_PROVENANCE.md).100%/503мс по умолчанию, сохранённые sliders/quiet/lite в настройках; OS reduce/coarse pointer учитываются. Не создавать второй вариант controls для нового модуля. OFL шрифтов в public/licenses.
