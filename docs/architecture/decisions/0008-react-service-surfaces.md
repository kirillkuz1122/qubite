# ADR-0008: React для сервисов нового Qubite, старый UI турниров

CONFIRMED 12.10.2026 прямым уточнением владельца: все собственные пользовательские интерфейсы сервисов, вошедших в Qubite 2.0, создаются на React/TypeScript и новой дизайн-системе. Это включает VPN, Writing, Search, общий Auth/Profile, настройки, Owner Console/analytics/support и новые модули. Не ограничиваться новой оболочкой со ссылками на прежние HTML страницы.

Qubite Tournaments — явное исключение: Node.js backend, SQLite и существующий Vanilla HTML/CSS/JS интерфейс сохраняются. Новая React карточка модуля может показывать доступ/статус и открывать legacy workspace; она не означает перепись турнирного UI. Турнирные роли/settings/statistics остаются в контуре модуля. SSO совместимость и сохранение URL/результатов — отдельный integration gate; никакого автоматического iframe или смешивания trusted origins.

React — клиентский слой. Необходимые общие и сервисные platform APIs/grants/budgets/commands/status на FastAPI/Postgres. Рабочие search/STT/LanguageTool/VPN node engines и сторонние native приложения не заменяются React. Для каждого собственного сервиса карта UI/API/domain data/runtime engine определяет, что именно мигрирует и что остаётся внешним adapter. Search history/ledger, Writing keys/addon behavior и VPN credentials/node/device state не терять.

Сначала общие identity/policy/cost guard, tokens/components и Owner Console; затем отдельные service slices с parity fixtures, новый React client и tested routing switch. Старые сервисные интерфейсы доступны до UX/function/data acceptance нового, без destructive replacement. Закрытие старых routes/assets только после compatibility и release approval. Новые референс страницы и CSS не копируют старую тему.

Android — отдельный native Ink track, а не обещание переписать pen input React; прочие shared client surfaces/hybrid POC по ADR-0006. Desktop повторно использует новый React UI. В этой итерации только scope/tasks/docs, новые приложения пока не созданы.
