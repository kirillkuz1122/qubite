# SmartCaptcha Theme Map

Этот файл больше не стоит читать как описание текущей production-капчи.

## Текущее состояние

В текущем коде Qubite используется `Cloudflare Turnstile`:

- серверная часть: `back/src/turnstile.js`
- env-конфиг: `.env.example`, `back/src/config.js`
- клиентская интеграция: `front/js/app.js`

## Зачем тогда нужен этот файл

Потому что у проекта есть практический roadmap:

- перейти с `Cloudflare Turnstile` на `Yandex SmartCaptcha`;
- сделать это для российского пользовательского контура, где Cloudflare может быть нестабильным или блокируемым;
- заранее сохранить theme mapping под будущую миграцию.

Именно в этом статусе файл и нужно воспринимать: как заметку о планируемой миграции CAPTCHA-слоя.

## Планируемое направление

- текущая реализация: `Turnstile`
- целевое направление: `Yandex SmartCaptcha`
- причина: более реалистичный сценарий для RU-аудитории

## Theme map для потенциальной SmartCaptcha-миграции

Основа берётся из существующих токенов темы и оформления проекта:

- `--bg-*`, `--fg*`, `--border`, `--accent-*`, `--danger` из `front/css/styles.css`
- оболочка текущей капчи `.turnstile-shell`
- поля `.input`
- CTA-кнопки `.btn--accent`

Важно:

- основной CTA проекта построен на градиенте `#f43f5e -> #f59e0b`;
- если SmartCaptcha требует один базовый акцент, разумно брать `#f43f5e`;
- для фокуса и glow можно использовать `#f59e0b`.

## Таблица

| Поле в SmartCaptcha | Светлая тема | Тёмная тема | Откуда / логика |
| --- | --- | --- | --- |
| Цвет текста -> Главный | `#0b1220` | `#e2e8f0` | `--fg` |
| Цвет фокуса | `#f59e0b` | `#f59e0b` | `--accent-to` |
| Цвет фона | `#f6f7fb` | `#0b1220` | `--bg-1`, фон оболочки капчи |
| Граница -> Радиус доп. задания | `16px` | `16px` | `.turnstile-shell` |
| Граница -> Стиль | `1px solid rgba(0, 0, 0, 0.10)` | `1px solid rgba(255, 255, 255, 0.10)` | `--border` |
| Checkbox -> checked background | `#f43f5e` | `#f43f5e` | `--accent-from` |
| Checkbox -> checkmark | `#ffffff` | `#ffffff` | читаемость |
| Spinner | `#f43f5e` | `#f43f5e` | акцент |
| Input background | `rgba(255, 255, 255, 0.78)` | `rgba(255, 255, 255, 0.06)` | `.input` |
| Input focus border | `2px solid rgba(245, 158, 11, 0.45)` | `2px solid rgba(245, 158, 11, 0.55)` | акцентный фокус |
| Submit button background | `#f43f5e` | `#f43f5e` | свёрнутый CTA |
| Submit hover | `#fb7185` | `#fb7185` | осветлённый акцент |
| Error color | `#b91c1c` | `#fecaca` | danger/error palette |

## Что нужно сделать при реальной миграции

- заменить клиентскую интеграцию в `front/js/app.js`;
- заменить серверную валидацию в `back/src/turnstile.js` на новый модуль;
- обновить `.env.example` и deploy docs;
- обновить `README.md`, `SECURITY.md`, `TODO.md`, `AGENTS.md`;
- после миграции переписать или удалить этот файл как transitional note.

## Источники в коде

- `front/css/styles.css`
- `front/js/app.js`
- `back/src/config.js`
- `back/src/turnstile.js`
- `TODO.md`
