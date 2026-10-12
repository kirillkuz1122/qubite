# Claude: продолжение Qubite 2.0

Всегда отвечай на русском. Сначала полностью прочитай [AGENTS.md](AGENTS.md); правила legacy/операций сохраняются. Затем [kickoff](QUBITE_AGENT_KICKOFF_PROMPT.md), [master](QUBITE_MASTER_CONTEXT.md), [обязательную access policy](QUBITE_ACCESS_AND_OWNER_CONSOLE.md), [память проекта](docs/project/PROJECT_CONTEXT.md), [handoff](docs/project/LAST_HANDOFF.md), [аудит](docs/architecture/CURRENT_STATE.md), [ADR](docs/architecture/decisions/README.md) и [задачи](docs/plan/tasks.json).

Новый core/UI ещё не реализован. Стек и миграция RECOMMENDED, до архитектурного согласования нельзя начинать переработку. Owner Console отдельно от normal home; tournament roles scoped; все paid модели требуют grants/budgets включая владельца. Сохранить legacy данные/URLs, ShadeAI только read-only.

Git: main canonical, tournaments/qubite-v1.0 immutable archive commit 96f0457. One approved bounded task → tests/verify → docs/evidence → русский commit → сразу push. Временная task branch разрешена с tested merge. Push не deploy; production после explicit approval/backup/restore/staging.

Проверка: python3 scripts/engineering/check.py; python3 scripts/engineering/verify.py --suite all --python <test-venv-python>. Нет готового нового React/Core/Android toolchain — не выдумывать команды или acceptance. Не читать/коммитить секреты/runtime БД. Все результаты и решения записывать в docs/, чтобы другая сессия могла продолжить.
