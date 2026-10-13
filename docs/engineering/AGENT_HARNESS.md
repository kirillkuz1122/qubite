# Development Harness Codex/Claude

**AUTH-01113.10.2026 done:** core0.4.0/schema0005 verify/reset и mock-only delivery; email-2FA contract-only, registration/policy/UI/native/deploy отдельные. [EMAIL_CHALLENGES](../architecture/EMAIL_CHALLENGES.md), [AUTH-011 report](../reports/QUB-AUTH-011.md), [ADR-0017](../architecture/decisions/0017-email-challenges-and-recovery.md). Final local+CI762 passed; implementationf3d4b6c/CI38373075395 success; прежние snapshots ниже исторические. После этого ready DEPLOY-001/TG-001, не начинать новый task в том же cycle.

**AUTH-01013.10.2026:** текущий partial runtime включает AUTH-009 и AUTH-010, core0.3.0/schema0004. OAuth suites используют signed RSA/JWKS + MockTransport, никакой real provider сети/keys; runtime/test locks включают httpx/PyJWT/cryptography. [API/SQL/ограничения](../architecture/OAUTH_IDENTITY.md), [evidence](../reports/QUB-AUTH-010.md). Дальше AUTH-011 отдельным cycle; прежний порядок next AUTH-010 ниже — исторический. Production/provider enable и личная память не меняются по успешным fixtures.

**Identity уточнение13.10.2026:** AUTH-008 source specification сохранена; identity-v2 теперь partial runtime (AUTH-009 web routes), vectors/introspection oracle не полный verifier. Identity suite входит в all, actual Web Auth интеграции проверяет core suite. Новый путь fresh install без users/password/session import/bridge; [ADR-0013](../architecture/decisions/0013-fresh-identity-and-unified-login.md). Не требовать server backup для локального slice без существующего data source. По-прежнему одна ready approved задача на цикл, тесты→evidence→русский commit→push; AUTH-002 storage/bootstrap и AUTH-009 password/session отдельные verified slices; next AUTH-010 OAuth, затем AUTH-011 verify/reset. Требуемые runtime/test locks включают Argon2id. Найденные старые данные не удалять; deploy отдельно.

Минимальный harness готов: tasks.json + check.py + verify.py + CI + project context/ADR/report. Это не автономный unlimited agent runner и не production deployer.

## Запуск цикла

1. Прочитать AGENTS.md/CLAUDE.md → kickoff (доступен без V2 suffix) → master/access policy → PROJECT_CONTEXT/LAST_HANDOFF → CURRENT_STATE → TASKS/ADR.
2. git status --short --branch + log; сверить main/origin/archive. Не включать чужие файлы. scripts/engineering/check.py показывает ready. Если ready нет, выполнять согласованное обсуждение/исследование, не снимать approval флаг самостоятельно.
3. Одна ready задача с done dependencies; перевести in_progress, записать allowed files/acceptance/test plan/risk. Базовый стек и scope согласованы; ready registry разрешает local bounded задачи. Детальные неодобренные engine/cutover/release решения остаются отдельными gates.
4. Реализация → unit/integration/negative tests → требуемый UI/hardware/restore check → docs/tasks/changelog/evidence. Результат review/testing пока acceptance открыт. Safe diagnostics продолжаются независимо от открытого решения.
5. python3 scripts/engineering/verify.py --suite all --python <venv-python>; для targeted цикла scope определяется task, critical regression не пропускать. Runner копирует только исходники без .env, separate HOME/SQLite/sockets, запрещает внешнюю сеть, each suite отдельный процесс, timeout 180s. Node modules reused read-only; third-party dependency code доверенный, это не полноценный OS sandbox malicious packages.
6. git diff --check, exact staged review, no secrets/runtime/build/browser state. Коммит русский без prefixes, push origin main сразу; задача на task branch push своей ветки, tested merge main и push main. Не git add . вслепую. tests fail → не done, не push broken code. Commit evidence заполняется после commit отдельным handoff либо ссылкой на completion marker, без циклического self-hash.
7. Проверить remote SHA, оставить report+handoff, следующую ready задачу. Push не deployment; серверный rollout требует отдельного разрешения и backup runbook.

## Стоп-условия

Unapproved architecture/data authority/schema switch/role expansion, failed required tests, unexpected writes outside allowed files, live data/keys/provider/network calls, missing verified backup для migration, unknown external send, budget/time limit. Не force-push/reset --hard/удалять архив/БД. 1 primary task/cycle; bounded 3 repair attempts, затем конкретный report и blocker, без бесконечной рекурсии. Paid providers не включаются по факту успешных mocks.

## Честные ограничения

Runner запускает legacy suites и core tests с настоящим native disposable PostgreSQL cluster; production storage/React/Android не создаёт. Он не коммитит и не пушит сам: агент проверяет результат и делает эти шаги. Не установлены global hooks, не изменены сервисы. Архитектура отмечается approved только решением пользователя с ADR/date; ready task dependencies проверяются machine schema.

CI Python 3.14/Node 22 — отдельное окружение; фактические локальные версии указывать в отчёте (AUTH-002: Python3.13/Node22.22.2/Postgres18.6), CI actual green проверять на GitHub. Hardware/manual acceptance не превращать в CI skip. Параллельные агенты допускаются только по явной команде/разрешённому workflow и с file ownership.

CORE-001 расширяет --suite all required core suite. Test prerequisites: Psycopg lock + native initdb/postgres, можно указать --postgres-bin. Никаких automatic downloads/Docker/system services: missing prerequisite fail. Source-copy включает core/contracts/SQL, core-specific fixture address не наследуется из production env, PG cluster новый в /tmp. Core API startup никогда не вызывает migration apply.
