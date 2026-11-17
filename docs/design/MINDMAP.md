# Mind map — макеты (DOC-006)

Макеты вида «Mind map» в Docs для задачи [#49](https://github.com/kirillkuz1122/qubite/issues/49). Нарисованы 17.11.2026 в [Figma](https://www.figma.com/design/UZ5s8bNDVUfqK2yy80DAWR), страница «Экраны», **справа от рядов Docs и Документ** (x = 4320). ПК 1440 и телефон 360, тёмная и светлая темы. Решения — D-1000…D-1008 в [decisions/97.md](../product/decisions/97.md). Данные — шаблон из задания: «Collocations: information», ветки noun+, adjective+, verb+ и examples со ссылкой @ на урок.

## 1. Кадры

| Состояние | ПК тёмная | Телефон тёмная | ПК светлая | Телефон светлая |
|---|---|---|---|---|
| Обзор: выделение узла, свёрнутая ветка «+5», узел-ссылка @, масштаб | [70-4839](https://www.figma.com/design/UZ5s8bNDVUfqK2yy80DAWR?node-id=70-4839) | [70-4955](https://www.figma.com/design/UZ5s8bNDVUfqK2yy80DAWR?node-id=70-4955) | [70-5219](https://www.figma.com/design/UZ5s8bNDVUfqK2yy80DAWR?node-id=70-5219) | [70-5335](https://www.figma.com/design/UZ5s8bNDVUfqK2yy80DAWR?node-id=70-5335) |
| Пусто: новая карта, центр в правке, подсказка клавиш, шаблон | [71-4839](https://www.figma.com/design/UZ5s8bNDVUfqK2yy80DAWR?node-id=71-4839) | [71-4924](https://www.figma.com/design/UZ5s8bNDVUfqK2yy80DAWR?node-id=71-4924) | [71-5145](https://www.figma.com/design/UZ5s8bNDVUfqK2yy80DAWR?node-id=71-5145) | [71-5230](https://www.figma.com/design/UZ5s8bNDVUfqK2yy80DAWR?node-id=71-5230) |
| Правка узла: новый узел с кареткой, подсказка Enter/Tab/Esc | [71-5452](https://www.figma.com/design/UZ5s8bNDVUfqK2yy80DAWR?node-id=71-5452) | [71-5586](https://www.figma.com/design/UZ5s8bNDVUfqK2yy80DAWR?node-id=71-5586) | [71-5855](https://www.figma.com/design/UZ5s8bNDVUfqK2yy80DAWR?node-id=71-5855) | [71-5989](https://www.figma.com/design/UZ5s8bNDVUfqK2yy80DAWR?node-id=71-5989) |
| Меню узла (ПК — меню у узла, телефон — лист) | [71-7182](https://www.figma.com/design/UZ5s8bNDVUfqK2yy80DAWR?node-id=71-7182) | [71-7350](https://www.figma.com/design/UZ5s8bNDVUfqK2yy80DAWR?node-id=71-7350) | [71-7642](https://www.figma.com/design/UZ5s8bNDVUfqK2yy80DAWR?node-id=71-7642) | [71-7810](https://www.figma.com/design/UZ5s8bNDVUfqK2yy80DAWR?node-id=71-7810) |
| Создать: меню «Ещё» в списке Docs | [72-5384](https://www.figma.com/design/UZ5s8bNDVUfqK2yy80DAWR?node-id=72-5384) | [72-5563](https://www.figma.com/design/UZ5s8bNDVUfqK2yy80DAWR?node-id=72-5563) | [72-5653](https://www.figma.com/design/UZ5s8bNDVUfqK2yy80DAWR?node-id=72-5653) | [72-5832](https://www.figma.com/design/UZ5s8bNDVUfqK2yy80DAWR?node-id=72-5832) |

Заметка «как работает» (клавиши, жесты, движение, данные) — [72-5955](https://www.figma.com/design/UZ5s8bNDVUfqK2yy80DAWR?node-id=72-5955).

## 2. Как устроен экран

- **Шапка** как у документа: «Docs» (назад), «Сохранено», кнопки-значки «Списком» (вложенный список), «История», «Скачать» (.md / PNG / SVG), «Ещё»; название — «Документ 24».
- **Холст** на всю ширину под шапкой, до низа экрана; фон — точечная сетка `faint` шагом 24. Command (ПК) и нижняя панель (телефон) лежат поверх холста.
- **Узлы:** центр — карточка с оранжевой рамкой 2 px, «Окно 16»; ветка 1-го уровня — карточка `panel` с точкой цвета ветки, «Интерфейс 14 · средний»; глубже — текст «Интерфейс 14» на фоне `bg`. Линии — кривые цвета ветки: 3 px от центра, дальше 2 px.
- **Состояния узла:** выделен — рамка `sky` 2 px и `panel-2`; правка — то же и оранжевая каретка; свёрнут — счётчик «+N» цветом ветки; ссылка — чип `@ Название`, как в тексте (DOC-003).
- **ПК:** масштаб справа внизу (− · 100 % · + · вся карта), подсказка клавиш слева внизу при правке.
- **Телефон:** «вся карта» справа внизу; у выделенного узла — панель над нижней панелью: Ветка · Рядом · Цвет · Свернуть · AI · Ещё (подписи 10 px, как у нижней панели). «Ещё» и долгое нажатие — лист с меню узла.

## 3. Что добавлено в библиотеку

- Значки `icon/minus`, `icon/fit`, `icon/mindmap` — страница «Значки» ([minus](https://www.figma.com/design/UZ5s8bNDVUfqK2yy80DAWR?node-id=67-66), [fit](https://www.figma.com/design/UZ5s8bNDVUfqK2yy80DAWR?node-id=67-74), [mindmap](https://www.figma.com/design/UZ5s8bNDVUfqK2yy80DAWR?node-id=67-82)); координаты — в `data:icons` на `_lib` (D-1004).
- `part:mindmap` на `_lib` (скрытый слой, грузится вместе с `core`): `Q.M.tpl()` (шаблон collocations), `Q.M.canvas(w, h, дерево, {cx, cy})` (сетка, авто-раскладка, линии), `Q.M.node`, `Q.M.menu`, `Q.M.sheet`, `Q.M.bar`, `Q.M.zoom`, `Q.M.hint`, `Q.M.screen(page, имя, {tree, pc, phone, over})` (4 кадра) и `Q.M.put(page, made, имя, ряд)` (поставить справа от Docs). Узел дерева: `{t, c, side: 'l', s: 'sel'|'edit', fold: N, link: true, k: [...]}`.

## 4. Решено без владельца (можно откатить)

- На телефоне карта открывается в 100 % и сдвигается к выделенному узлу; часть веток уходит за край — это холст, «вся карта» показывает всё.
- Цвет «красный» в палитре веток не используется (§0.3: красный — ошибки).
- Зона нажатия цветов в меню на ПК — 32 px (мышь), в листе телефона — 44 px.
