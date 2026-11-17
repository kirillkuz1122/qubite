# Пульт — макеты (HAR-002, этап AOS-0)

Макеты модуля «Пульт» для [AGENTIC_OS.md §5](../architecture/AGENTIC_OS.md), задача #245. Нарисованы 17.11.2026 в [Figma](https://www.figma.com/design/UZ5s8bNDVUfqK2yy80DAWR), страница «Новые модули», ниже «Турниров». Решения — D-951…D-961 в [decisions/95.md](../product/decisions/95.md). Кода нет: сначала владелец говорит «так» (D-932).

Тёмная тема — все экраны; светлая — Светофор (проверка, что токены работают). ПК 1440, телефон 390 (D-951). Данные выдуманы, но из нашей жизни: DS-013, ENG-008/009, land-pr, лимиты; без настоящих ключей, почты и адресов. Справа от кадров — заметки «как работает» и описание движения.

## 1. Кадры

| Экран | ПК | Телефон | Заметка |
|---|---|---|---|
| Нижняя панель: «Пульт» вместо «Входящих» (D-945) | — | [Главная с Пультом](https://www.figma.com/design/UZ5s8bNDVUfqK2yy80DAWR?node-id=53-5907), [лист «Ещё» с Входящими](https://www.figma.com/design/UZ5s8bNDVUfqK2yy80DAWR?node-id=53-5942) | точка на значке, когда что-то ждёт |
| **Светофор** — главный экран (D-940) | [тёмная](https://www.figma.com/design/UZ5s8bNDVUfqK2yy80DAWR?node-id=43-5070), [светлая](https://www.figma.com/design/UZ5s8bNDVUfqK2yy80DAWR?node-id=43-5922) | [тёмная](https://www.figma.com/design/UZ5s8bNDVUfqK2yy80DAWR?node-id=43-5362), [светлая](https://www.figma.com/design/UZ5s8bNDVUfqK2yy80DAWR?node-id=43-6214) | — |
| «Ждёт тебя» и карточка агента с историей (D-941) | [Агенты + карточка](https://www.figma.com/design/UZ5s8bNDVUfqK2yy80DAWR?node-id=44-4976) | [Ждёт тебя](https://www.figma.com/design/UZ5s8bNDVUfqK2yy80DAWR?node-id=44-5065), [карточка агента](https://www.figma.com/design/UZ5s8bNDVUfqK2yy80DAWR?node-id=44-5222) | [как работает](https://www.figma.com/design/UZ5s8bNDVUfqK2yy80DAWR?node-id=44-5277) |
| Карта 3D / 2D (D-940) | [сфера 3D](https://www.figma.com/design/UZ5s8bNDVUfqK2yy80DAWR?node-id=46-5941) | [граф 2D](https://www.figma.com/design/UZ5s8bNDVUfqK2yy80DAWR?node-id=46-6074) | [движение](https://www.figma.com/design/UZ5s8bNDVUfqK2yy80DAWR?node-id=45-6005) |
| Recos по ARMS + джокеры, корзина (D-939) | [Recos](https://www.figma.com/design/UZ5s8bNDVUfqK2yy80DAWR?node-id=47-5376) | [Recos](https://www.figma.com/design/UZ5s8bNDVUfqK2yy80DAWR?node-id=47-5496) | [как работает](https://www.figma.com/design/UZ5s8bNDVUfqK2yy80DAWR?node-id=47-5565) |
| Задачи по расписанию | [таблица](https://www.figma.com/design/UZ5s8bNDVUfqK2yy80DAWR?node-id=48-6170) | [карточки](https://www.figma.com/design/UZ5s8bNDVUfqK2yy80DAWR?node-id=48-6450) | [правила](https://www.figma.com/design/UZ5s8bNDVUfqK2yy80DAWR?node-id=48-6511) |
| Колода навыков и «модель × усилие» | [колода + окно](https://www.figma.com/design/UZ5s8bNDVUfqK2yy80DAWR?node-id=49-5566) | [колода](https://www.figma.com/design/UZ5s8bNDVUfqK2yy80DAWR?node-id=49-5912), [окно](https://www.figma.com/design/UZ5s8bNDVUfqK2yy80DAWR?node-id=49-6049) | [как работает](https://www.figma.com/design/UZ5s8bNDVUfqK2yy80DAWR?node-id=49-6055) |
| Память: `/calibrate` на «да», каталог, профиль | [три колонки](https://www.figma.com/design/UZ5s8bNDVUfqK2yy80DAWR?node-id=50-5734) | [на «да»](https://www.figma.com/design/UZ5s8bNDVUfqK2yy80DAWR?node-id=50-5829), [каталог](https://www.figma.com/design/UZ5s8bNDVUfqK2yy80DAWR?node-id=50-5967) | — |
| Command — мысль / вопрос / поручение / голос (D-942…D-946) | [диспетчер](https://www.figma.com/design/UZ5s8bNDVUfqK2yy80DAWR?node-id=52-5868), [поиск артефактов](https://www.figma.com/design/UZ5s8bNDVUfqK2yy80DAWR?node-id=52-6182) | [мысль](https://www.figma.com/design/UZ5s8bNDVUfqK2yy80DAWR?node-id=51-5617), [вопрос](https://www.figma.com/design/UZ5s8bNDVUfqK2yy80DAWR?node-id=51-5686), [поручение](https://www.figma.com/design/UZ5s8bNDVUfqK2yy80DAWR?node-id=51-5771), [голос](https://www.figma.com/design/UZ5s8bNDVUfqK2yy80DAWR?node-id=51-5851) | [как устроено](https://www.figma.com/design/UZ5s8bNDVUfqK2yy80DAWR?node-id=52-6211) |
| Telegram — тот же диспетчер (D-950) | — | [чат](https://www.figma.com/design/UZ5s8bNDVUfqK2yy80DAWR?node-id=53-6141) | [заметка](https://www.figma.com/design/UZ5s8bNDVUfqK2yy80DAWR?node-id=53-6147) |

## 2. Что добавлено в библиотеку

- Значок `icon/pult` — страница «Значки» ([ячейка](https://www.figma.com/design/UZ5s8bNDVUfqK2yy80DAWR?node-id=39-66)), 12 точек: шкала и стрелка. Координаты — в `data:icons` на `_lib`.
- Компонент `Dock · Пульт` — страница «Компоненты», рядом с `Dock` ([набор](https://www.figma.com/design/UZ5s8bNDVUfqK2yy80DAWR?node-id=39-331)), варианты: Главная, Сегодня, Пульт, Planner, Ещё. Старый `Dock` не трогал: экраны других модулей пока со старой панелью, менять — в задаче кода (D-952).
- `part:pult` на `_lib` (скрытый слой, грузится вместе с `core`): `Q.P.meter` (лимит точками), `Q.P.num` (счётчик), `Q.P.agent` (строка сессии: модель, контекст, цена, кэш), `Q.P.wait` (карточка «ждёт тебя»), `Q.P.pill`, `Q.P.scale`, `Q.P.note`, `Q.P.mkPC` / `Q.P.mkPhone` (кадры с панелью Пульта), `Q.P.place` (ряд на странице). Пример: `const Q = await (new Function('return ' + core.characters))()(figma, core); Q.P.mkPhone('Пульт · …', () => [Q.P.meter('5 часов', 62, 'сброс в 19:40')])`.

## 3. Что решено (кратко, подробно — D-951…D-961)

- Светофор читается сверху вниз за 2–5 секунд: **сколько осталось** (две шкалы, LOW ниже 15%) → **три цифры** (работает · ждёт тебя · готово) → **что ждёт тебя** → расход за неделю.
- «Ждёт тебя» — только решения владельца, 0–3 карточки с кнопками прямо в строке; пусто — Прото «Ничего не ждёт тебя».
- В карточке агента — задача, модель, контекст шкалой, цена, кэш тёплый/холодный, PR и история событий, которую пишет код (0 токенов).
- Крупные числа — текстом «Число 32», точки — для шкал, графиков и заголовков (D-954).
- Дорогое везде выглядит одинаково: оранжевая рамка, «≈ N% недельного лимита», «Да / Нет / дешевле» — в Пульте, Command и Telegram (D-944).
- Под каждым ответом диспетчера — «не то? это вопрос / это мысль» и какая модель ответила за сколько (D-960).

## 4. Под вопросом (решает владелец)

> **Ответы 17.11:** 1 — лимиты сверху (D-962); 2 — % лимита главным, $ мелко (D-963); 3 — переключатель 2D/3D, начинаем с 2D везде (D-964); 5 — 5% недельного лимита (D-965); 4 — Command растёт по ходу разговора (D-966).

1. **Что на телефоне сверху:** лимиты (как нарисовано) или «ждёт тебя», а лимиты — одной строкой? Рекомендую лимиты: без них нельзя решить, что запускать.
2. **В чём считать расход:** ≈ $ по ценам API (нарисовано), % недельного лимита или ₽? На подписке доллары — оценка; % лимита честнее, но не видно «дорого/дёшево» между неделями. Рекомендую % лимита главным, $ — мелко.
3. **Карта на ПК:** сфера с орбитами (нарисовано) или только кольца без сферы? Сфера красивее, кольца в 2–3 раза проще в коде. Рекомендую начать с колец, сферу — вторым шагом.
4. **Command на телефоне:** чат на весь экран (нарисовано) или маленький лист снизу, как сейчас? Весь экран — видно ответ и план; лист — быстрее «записал и ушёл». Рекомендую весь экран только для вопроса и поручения, мысль — тостом без открытия.
5. **Порог «дорогого»:**  за запуск (нарисовано), 5% недельного лимита или «всё на Fable/Opus»? Рекомендую 5% недельного лимита — понятно без пересчёта.

Технические мелочи (агент решил сам): телефон 390 px (D-951), старый `Dock` заменить в коде, светлая тема нарисована только для Светофора.
