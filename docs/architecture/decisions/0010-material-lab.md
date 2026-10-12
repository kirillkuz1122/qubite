# ADR-0010 — отдельная лаборатория пяти React-направлений

Дата: 12.10.2026. Статус: **CONFIRMED scope по прямому запросу владельца / engineering implementation / OPEN визуальный выбор**.

## Основание

Владелец запросил пять оригинальных сильно отличающихся React-концепций живого материала, landing и интерфейс, различные ориентации, цвета/шрифты/анимации и публикацию для телефона. Референсы — ArtCraft, Liquid Glass и expressive auth screenshots. Отдельно запретил skills и quota reset; разрешил широко исследовать стиль. Это расширяет reviewable artifact DESIGN-001, не разрешает массовую миграцию платформы.

## Решение

Изолированное `assets/design-lab`, React/TypeScript/Vite, собственные CSS/SVG материалы Nacre/Ferro/Folio/Prism/Milo и 20 сцен. Self-hosted variable fonts с OFL. Новый отдельный private Sites project; static output только `dist`, source configuration `.openai/hosting.json`. GitHub main сохраняет код/документацию; Sites source repository содержит только demo source. Публикация отдельная явная операция, CI автодеплоя нет.

Pointer через RAF/CSS variables плюс общий семантический event contract и отдельная реакция каждого материала. Данные и текст на непрозрачных поверхностях, сниженное движение/keyboard/контраст обязательны. Все interactions synthetic/in-memory, ни один provider/service/identity consumer не подключён. Console только из Settings; модель access не расширяется демонстрационным role selector.

## Альтернативы и последствия

Подключение SDK Liquid Glass не выбрано: прозрачный слой против предпочтения владельца, дополнительные требования WebGPU/совместимости не нужны для этих прототипов. Пять static images не позволили бы оценить формы/touch/reactions, поэтому созданы настоящие компоненты. Продакшен React shell вместо demo преждевременен до выбора направления и identity/policy contracts.

47 browser tests + existing386 regression дают техническую проверку прототипа. Physical phone/Safari/native clients/readability и финальный стиль принимает владелец. Prototype palette/motion не объявляются approved production design. Следующий цикл — feedback/выбор/доработка, затем отдельная UI задача. Откат — не использовать demo route/site, legacy runtime unaffected, никаких user-data migration/rollback нет.
