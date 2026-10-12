# Память проекта Qubite 2.0

Обновлено 12.10.2026. Эта память версионируется в репозитории; не зависит от истории чата/личной памяти Codex или Claude. Реальное runtime состояние сверять заново.

Цель текущего этапа: audit/design/harness, без масштабной реализации. Legacy code base 96f0457 архивирован tournaments/qubite-v1.0 на origin, refs verified. main — новый мейнлайн, archive неизменяем. Старые runtime файлы back/front/index/deploy/services не менялись; добавлены документы, scripts/tests/CI. Код нового core/React/Postgres не создавался.

Порядок входа: root AGENTS/CLAUDE → QUBITE_AGENT_KICKOFF_PROMPT.md (V2 имя отсутствует) → QUBITE_MASTER_CONTEXT.md → QUBITE_ACCESS_AND_OWNER_CONSOLE.md → CURRENT_STATE → TARGET_ARCHITECTURE/ADR → tasks.json → LAST_HANDOFF/QUB-001 report → git status/log. Если другой V2 появится, сначала compare требований, не подменять молча baseline.

Согласовано продуктом: ordinary owner home, separate Console, scoped tournament roles, default deny/manual grants, no tariffs, cost guard before paid calls, собственные Docs/Planner, local-first, все 48 ideas retained, ShadeAI independent connector/read-only сейчас. Согласовано ответами 1–6 от 12.10.2026: FastAPI/Python, React/TS, Postgres нового core, SQLite турниров; полностью новый дизайн, web/Android/Linux desktop с Windows/macOS portability, deploy/installer. Последнее решение Auth: новый backend FastAPI/Postgres, legacy только до cutover, минимальная регистрация без account code-entry (ADR-0005/0007).

State: QUB-001 done с baseline commit/evidence и ответами владельца; ready TEST-001, CORE-001, DESIGN-001, DEPLOY-001, TG-001. Всего 43 карточки. Остальные задачи требуют своих dependencies/task-level review; перенос live identity, массовая перепись и deploy не разрешены одним согласованием стека.

Проверки/границы: 332 проверки прошли (полный isolated runner + harness), текущий report содержит реальные результаты; архив code-only, runtime data backups ещё не создано. Production environment неизвестен локально; docs Pi snapshot не current verification. Test runner копирует source без .env/секретов/real HOME и блокирует внешнюю сеть. Paid/TG sends/HA actions не запускать.

Согласовано 12.10.2026: Raspberry Pi и выбор сервера сейчас не обсуждаем; возможен VPS, решение по хостингу отложено. OPS-001/capacity/backup drill нужны перед серверным этапом, не перед локальным core. Стек/БД согласованы позднейшими ответами; identity переход выбран по делегированию. Backup destination пока нет, GitHub не runtime backup. Планшет назван Lenovo Xiaoxin Pad 2025, точный model ID/стилус не подтверждены.

Next: isolated auth characterization и FastAPI/Postgres foundation; новый design/auth UX specification и deploy specification. Затем bridge/policy/mock budgets/Owner Console. Вход по account code-entry убрать отдельной задачей, турнирные коды сохранить. Новый функционал идёт небольшими approved задачами; один writer на домен, no dual DB writes. Commit/push на main разрешён для baseline; production отдельно.

CI baseline ae3f71e успешно завершился на GitHub (run 38197926998), результаты сохранены report/handoff. На сервер ничего не раскатывалось. Базовый стек согласован позднейшим ответом владельца; CI baseline не подтверждает новый runtime, клиентов или migration/deploy.

Дополнения владельца: Telegram control bot обязателен, полностью новый flow; всё tournament управление в module settings, общая аналитика и server load в Owner Console. Проверены legacy handlers/HTTP collectors; matrix и нюансы в TELEGRAM_AND_OBSERVABILITY. TG-1..6 закрыты, foundation продолжается. deploy/.env существует локально, права 600, текущим Git не отслеживается; владелец разрешил при необходимости локально использовать прежние credentials. Содержимое не читалось/не переносилось, актуальность/API доступ не проверены; в fixtures реальные ключи не использовать.

Последние ответы 12.10.2026 имеют приоритет над предыдущим reuse-предложением: нужные shared legacy функции FastAPI/Postgres, старый Node/Auth только временно до cutover; специфический tournament engine Node/SQLite остаётся optional, без полной переписи сейчас. TG-1..6 отвечены: сохранён bot, automatic text/voice capture, guest support и owner-managed staff grants, allowlist controls/confirmation, critical+daily events/deep links, агрегаты. ADR-0007 и capture spec — актуальные решения; pending осталось расписание/каналы при настройке, сервер/backup/аппаратные POC.
