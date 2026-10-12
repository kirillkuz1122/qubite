# План дизайн-системы

RECOMMENDED: новая React/TS shell alongside legacy, собственные visual tokens; existing docs/design-system.md и /design-system — референс действующих компонентов, не новая платформа. В данном этапе никаких UI файлов runtime не меняем.

Tokens: semantic colors background/surface/text/muted/accent/danger, typography, spacing/radius/elevation, motion timings, focus ring, tap targets. Light/dark/reduced motion/high contrast. Components: Button/Input/Select/Popover/Menu/Dialog/Drawer/Tabs/Card/Toast/Empty/Error/Loading/Offline/Conflict/PermissionDenied/BudgetExceeded/ModuleUnavailable; consistent keyboard focus/escape/return focus.

Навигация: Today, Command, Docs, Projects; каталоги остальных модулей постепенно. Owner Console только Settings; Tournaments в modules/services. Layout phone single column + quick capture, tablet Ink-first paper, desktop multi-panel. Неподвижная системная navigation; AI наполняет только approved widget slots. Profile/access UI показывает собственные grants без управления чужими.

POC 1: owner/nonowner shell и modules unavailable/denied/budget states, без paid calls. POC 2: Tiptap/ProseMirror vs Lexical на одинаковых blocks/Markdown/formula/keyboard/offline cases, licenses/accessibility/export/CRDT feasibility. POC 3 отдельный native Ink input probe.

Acceptance viewport 360/768/1280+ и реальное устройство; табуляция/screenreader/zoom 200%, контраст, reduced motion, нет horizontal overflow. Frequent capture ≤3 действий как design goal; измерить на реальном UX. Screenshot baseline перед переносом legacy. Оптимистичный UI не пишет synced без ack; AI edits diff/accept/reject/undo. Hardware latency Ink фиксировать после benchmark, не обещать цифры заранее.
