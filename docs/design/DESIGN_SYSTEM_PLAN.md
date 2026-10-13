**UI-001, 13.10.2026:** создана новая React/TS оболочка `apps/web/`0.1.0: Главная/Модули/Входящие/Профиль/Настройки, desktop left/mobile bottom, Qubite Command/Lite fixed bottom, owner entry в настройках. [ADR-0022](../architecture/decisions/0022-web-shell-and-command.md), [отчёт](../reports/QUB-UI-001.md). Live читает existing me/access, не симулирует writes; demo roles/capture/visibility временные. Backend catalog+owner hidden/locked — новая UI-003 перед AUTH-004; auth screens следующая AUTH-007. Core0.6.0/0007, legacy и design-lab unchanged. Новые задачи только после вопросов/ответов. Старые milestones ниже исторические.

UI-001 закрепляет только начальную оболочку, не окончательные размещения всего приложения. Цвет используется по роли; физика live material/питомцы отдельно UI-002/PET. Современные standalone Tournaments не встроены в навигацию и не получают новый SSO. Прежний Today/Command/Tournaments adapter план ниже исторический.

> Актуально 13.10.2026: владелец выбрал **Поток** внутри Milo. [Витрина дизайн-системы](FLUX_DESIGN_SYSTEM.md) — components/tokens/palette/type/marks/companions; palette/fonts/logo family и physical-device acceptance открыты. История и ранние рекомендации ниже не заменяют это решение. UI-001/002 gates сохраняются.

# План дизайн-системы

CONFIRMED 12.10.2026: новая React/TS shell alongside legacy и полностью новый дизайн, собственные visual tokens; existing docs/design-system.md и /design-system — референс действующих компонентов, не новая платформа. В данном этапе никаких UI файлов runtime не меняем.

**QUB-DESIGN-001 done13.10.2026:** владелец просмотрел версию4 и выбрал Поток/Игрушечную/Ленту/Unbounded/Manrope, ритм100/503. [Текущий контракт цвета](COLOR_PLASTIC.md), [Поток](FLUX_DESIGN_SYSTEM.md), [отчёт](../reports/QUB-DESIGN-001.md), [Auth UX](AUTH_UX.md). Исторические исследования сохранены; final product layout и реализация UI/агентов отдельно.

Tokens: semantic colors background/surface/text/muted/accent/danger, typography, spacing/radius/elevation, motion timings, focus ring, tap targets. Light/dark/reduced motion/high contrast. Components: Button/Input/Select/Popover/Menu/Dialog/Drawer/Tabs/Card/Toast/Empty/Error/Loading/Offline/Conflict/PermissionDenied/BudgetExceeded/ModuleUnavailable; consistent keyboard focus/escape/return focus.

Навигация: Today, Command, Docs, Projects; каталоги остальных модулей постепенно. Owner Console только Settings; Tournaments в modules/services. Layout phone single column + quick capture, tablet Ink-first paper, desktop multi-panel. Системная navigation имеет стабильную структуру и плавное выделение; AI наполняет только approved widget slots. Profile/access UI показывает собственные grants без управления чужими.

POC 1: owner/nonowner shell и modules unavailable/denied/budget states, без paid calls. POC 2: Tiptap/ProseMirror vs Lexical на одинаковых blocks/Markdown/formula/keyboard/offline cases, licenses/accessibility/export/CRDT feasibility. POC 3 отдельный native Ink input probe.

Acceptance viewport 360/768/1280+ и реальное устройство; табуляция/screenreader/zoom 200%, контраст, reduced motion, нет horizontal overflow. Frequent capture ≤3 действий как design goal; измерить на реальном UX. Screenshot baseline перед переносом legacy. Оптимистичный UI не пишет synced без ack; AI edits diff/accept/reject/undo. Hardware latency Ink фиксировать после benchmark, не обещать цифры заранее.

Отдельный slice: новые login/register/reset/OAuth экраны, email/password и минимум согласий, optional display name после входа. Без account code-entry и обязательных турнирных ФИО/школы/класса; security verification codes сохраняются. Сначала конкретный макет/UX acceptance, затем UI реализация. Сайт/desktop используют общие tokens/components, Android согласованный visual language и native Ink.

Уточнение UI scope: новый дизайн/React всех собственных включённых сервисов VPN/Writing/Search; Tournaments сохраняет Vanilla legacy UI. [ADR-0008](../architecture/decisions/0008-react-service-surfaces.md).
