# ADR-0022 — оболочка и Qubite Command

Статус: CONFIRMED ответы владельца13.10.2026 по UI-001; bounded техническая реализация. Перед задачей вопросы заданы, получены ответы1–3. Это не согласование AUTH-007/UI-002/UI-003 или финального расположения всего продукта.

1. Состав: Главная, Модули, Входящие, Профиль, Настройки. На desktop навигация слева, на телефоне снизу. Настройки через профиль; owner ordinary home, отдельное управление только в настройках. Прямой owner URL nonowner закрыт.
2. Поле закреплено снизу: Qubite Command, компактное представление Lite (старое Light имя историческое). Command расположен над мобильной навигацией; safe-area, VisualViewport и измеренная высота панели учитываются. При клавиатуре нижняя навигация скрывается, ввод остаётся над клавиатурой. Поиск/объекты/голос/файлы/AI маршрутизация пока будущие slices.
3. Для каждого модуля владелец выбирает hidden или locked для пользователей без доступа. Visibility не grant и не доступ к данным. Демонстрация интерфейса в UI-001; trusted persistence/filtering/catalog HTTP в новой UI-003, обязательной перед полной AUTH-004 Console. Детали defaults/installed/disabled/public metadata обсудить с владельцем перед UI-003.

Новый пакет apps/web, React19.3/TS5.9/Vite8.3; своя render tree без imports assets/design-lab/legacy/services. Принятый материал Поток, Игрушечная палитра, Лента, Unbounded/Manrope; semantic hierarchy orange действия, blue выбор/проект, yellow мысли, green спокойный статус. Opaque surfaces, transform motion503ms, quiet/OS reduce; расширенная физика controls/питомцы отдельные UI-002/PET tasks.

Live и demo **разные build artifacts**. Live получает identity/grants только от same-origin existing core endpoints, строго проверяет DTO/expiry и не расширяет read через write/owner. При refresh старый профиль скрыт, старые async ответы отменены/проверены generation. Без server visibility catalog неизвестные/недоступные карточки скрыты. Разрешённый ещё не реализованный модуль показывает unavailable; ни один legacy handler не активируется.

Demo содержит фиктивные owner/member/new сценарии, локальные preview switches, временный text capture в память, явные подписи. Не использует реальный API/AI/микрофон/облачный аккаунт/секреты. Live не обещает сохранение или синхронизацию. Только вид/quiet живут в localStorage. Private demo hosting отдельно от production Qubite; core/DB/installer не разворачиваются.

Проверки: TS+две сборки, Playwright desktop/touch/live с negative/direct URL/refresh race, axe light/dark/modal; independent core/legacy harness. Native keyboard/реальное устройство/screen reader/full login E2E остаются отдельной приёмкой. Откат: убрать новый apps/web routing/build, сохранить core/grants; schema/data migrations отсутствуют.
