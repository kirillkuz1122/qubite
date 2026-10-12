# ADR-0012 — Поток и витрина компонентов Qubite

Дата 13.10.2026. **CONFIRMED: Flux/Поток выбран внутри Milo, мобильная оптимизация, selectable colors/fonts/logo families, сценарии персонажей. OPEN: финальная палитра, шрифты, знаки и acceptance на устройстве.** Уточняет ADR-0011; история пяти материалов сохраняется.

Владелец выбрал второй материал и описал реальные проблемы телефона: крупная draggable кнопка дёргается, выделение при нажатии прыгает вместо перетекания, элементы местами накладываются. Нужна единая витрина конструктора дизайна, а не final IA. Разрешены пять палитр без доминирующего фиолетового, отдельные списки heading/body, пять семейств Q/quantum логотипов на всех существующих сервисах. Геометрических персонажей доработать, их курсор/touch gaze и смену поз сделать мягкими; edge appearances и места/условия окончательно выбрать при разработке экранов.

Решение внутри одобренной DESIGN-001: отдельный default FluxStudio в React/TS, reusable existing controls, shared sleeping RAF scheduler, bounded spring steps, timed continuous selection, стабильный ResizeObserver, auto/manual lightweight rendering для coarse pointer. No glass blur, paid APIs или legacy migrations. Пять token palettes с dark counterparts, self-hosted OFL Cyrillic fonts, авторские SVG families. Прежние исследования доступны по старым hash-маршрутам. Preferences пока in-memory.

Питомцы — отдельный контекстный слой с восемью scripted states и тремя speech patterns. Персональность не даёт прав на запись/стоимость и не доказывает выполненных действий. Сценарии «скрыт/выглядывает из края/пришёл к действию/диалог/промах/отдых» зафиксированы для PET-001/002, не считаются готовым product поведением.

[Спецификация и критерии](../../design/FLUX_DESIGN_SYSTEM.md). Технический тест и CPU slowdown не заменяют physical-device acceptance. DESIGN-001 остаётся review/testing до выбора владельца. Следующий отдельный ready cycle рекомендован AUTH-008; UI gates не снимаются. Private demo Sites reuse existing project; main commit/push отдельно, production Qubite deploy не разрешён этой публикацией. Откат дизайна — старый hash/версия без миграции данных.
