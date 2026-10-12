# Память проекта Qubite 2.0

Обновлено 12.10.2026. Эта память версионируется в репозитории; не зависит от истории чата/личной памяти Codex или Claude. Реальное runtime состояние сверять заново.

Цель текущего этапа: audit/design/harness, без масштабной реализации. Legacy code base 96f0457 архивирован tournaments/qubite-v1.0 на origin, refs verified. main — новый мейнлайн, archive неизменяем. Старые runtime файлы back/front/index/deploy/services не менялись; добавлены документы, scripts/tests/CI. Код нового core/React/Postgres не создавался.

Порядок входа: root AGENTS/CLAUDE → QUBITE_AGENT_KICKOFF_PROMPT.md (V2 имя отсутствует) → QUBITE_MASTER_CONTEXT.md → QUBITE_ACCESS_AND_OWNER_CONSOLE.md → CURRENT_STATE → TARGET_ARCHITECTURE/ADR → tasks.json → LAST_HANDOFF/QUB-001 report → git status/log. Если другой V2 появится, сначала compare требований, не подменять молча baseline.

Согласовано продуктом: ordinary owner home, separate Console, scoped tournament roles, default deny/manual grants, no tariffs, cost guard before paid calls, собственные Docs/Planner, local-first, все 48 ideas retained, ShadeAI independent connector/read-only сейчас. Предложено, но не одобрено: вариант B FastAPI/React alongside legacy, new Postgres after Pi capacity gate, legacy Auth authority первого release.

State: QUB-001 review/testing, product tasks backlog, ready отсутствует. Архитектуру/права не менять до решения владельца. Open questions и ADR — источник pending choices; принять решение можно только по пользовательскому ответу с записью даты.

Проверки/границы: 332 проверки прошли (полный isolated runner + harness), текущий report содержит реальные результаты; архив code-only, runtime data backups ещё не создано. Production environment неизвестен локально; docs Pi snapshot не current verification. Test runner копирует source без .env/секретов/real HOME и блокирует внешнюю сеть. Paid/TG sends/HA actions не запускать.

Next: обсуждение 6 ключевых вопросов, read-only OPS-001/backup drill и full auth/tournament regression, затем owner/mock foundation. Новый функционал идёт небольшими approved задачами; один writer на домен, no dual DB writes. Commit/push на main разрешён для baseline; production отдельно.

CI baseline ae3f71e успешно завершился на GitHub (run 38197926998), результаты сохранены report/handoff. На сервер ничего не раскатывалось. Архитектура всё ещё требует решения владельца; CI green не снимает этот gate.
