# QUB-AUTH-008 — спецификация единого входа

Дата: 13.10.2026. Статус: **done**, specification и проверки завершены; runtime Auth ещё не реализован. Runtime Auth не реализован этой задачей.

## Основание и результат

Владелец сообщил, что существующих аккаунтов для переноса нет, прежний owner можно создать заново, проект нигде не запущен. Это пользовательское описание, не результат проверки сервера. Разрешены новый API и единый вход Search/остальных собственных сервисов. [ADR-0013](../architecture/decisions/0013-fresh-identity-and-unified-login.md) заменяет обязательную legacy compatibility и перенос паролей/сессий режимом fresh install.

Подготовлены [карта потребителей, спецификация и последовательность](../migration/IDENTITY_CUTOVER.md), [машинный контракт](../../contracts/identity-v2.json), [синтетические vectors](../../contracts/identity-vectors.json) и тестовый oracle в tests/identity. Никаких действующих endpoint, password verifier, PG identity таблиц или UI в этой задаче нет. Тесты описывают протокол и отрицательные требования, не проверяют несуществующую реализацию Auth. Runner включает identity в изолированную обязательную all suite; check.py проверяет реальные ссылки routes→tasks.

Один subject UUID в новом FastAPI/Postgres для Web/Search/Writing/VPN; отдельные credentials для браузера, нативных приложений и scoped ключей расширений/агентов. Private introspection для отдельных движков, один authority. Owner назначается локальным явным bootstrap; не появляется из первой публичной регистрации/email/header и не получает автоматического платного AI. Tournaments остаётся optional Node/SQLite/Vanilla с будущим core identity adapter. Пароли AliasVault и machine/bot/upstream credentials остаются отдельными.

## Изменение плана

AUTH-002 теперь создаёт новые PG accounts/singleton owner и local bootstrap; после неё AUTH-009 реализует password/session API. Добавлены AUTH-012 (native PKCE/device rotation), AUTH-013 (scoped keys), AUTH-014 (private introspection). AUTH-003 policy зависит от настоящего Auth, сервисные задачи от introspection, desktop от native flow. Это будущие bounded задачи, не выполненная интеграция.

## Проверки и Git

Локально13.10.2026:

| Проверка | Результат | Граница |
|---|---|---|
| check.py | pass,56 задач/51 docs; route→task/dependencies/source trace/links | не runtime acceptance |
| verify.py --suite identity |32 passed0.06s | synthetic Python/Node vectors/test-only oracle |
| verify.py --suite all |414 passed, без failed/skipped | Node94/deploy18/Search95/Brief112/Kwork29/SiYuan5/identity32/core29 |
| unittest tests/engineering |4 passed | task registry validation |
| git diff --check | pass | без whitespace errors |

**Итого418 distinct checks** в полном runner+harness,32 новые protocol cases. Отдельный targeted повтор не прибавляется к сумме. Python3.13 pinned /tmp/qubite-design-tests/bin/python, native disposable PostgreSQL18.6 /tmp/qubite-design-postgres/usr/bin; source-copy без .env/реальных DB/real HOME, внешняя сеть запрещена. Existing FastAPI/httpx deprecation warnings не failed/skipped; lock/runtime зависимости не менялись. Команда:

```sh
python3 scripts/engineering/verify.py --suite all --python /tmp/qubite-design-tests/bin/python --postgres-bin /tmp/qubite-design-postgres/usr/bin
python3 -m unittest discover -s tests/engineering
python3 scripts/engineering/check.py
```

Implementation **a48685c5a68cf8ca8973d6561f44b491157a9f1a** сохранён в main и отправлен в origin. `git ls-remote` подтвердил main на этом SHA и оба архивных ref на96f0457a523b6b79f21c4092056d8fa8fa69a680. [CI Qubite verification38344387215](https://github.com/kirillkuz1122/qubite/actions/runs/38344387215) для exact implementation SHA **completed/success13.10.2026 04:01:52UTC**. CI Python3.14.8/PostgreSQL16.15: те же all414+harness4 =418 passed, без failed/skipped; log counts и headSha проверены. Эта задача не меняет дизайн,133 browser checks предыдущего cycle повторно не запускались и не включены в418. Секреты, старые БД, back/front/services/deploy runtime, ShadeAI и demo не менялись. Архивы tournaments/qubite-v1.0 при начале задачи проверены на origin: 96f0457a523b6b79f21c4092056d8fa8fa69a680. Деплой, удаление данных, миграция пользователей и платные/provider вызовы не выполнялись.

## Дальше

AUTH-008 завершена, следующая ready задача AUTH-002 — PostgreSQL schema/accounts и локальный owner bootstrap. Нужны реальные disposable PG проверки повторов, гонок, FK/uniqueness и recovery; login ещё появится в AUTH-009. Старые AUTH-L01..03 остаются дефектами legacy кода; новый Auth должен выполнять противоположные negative requirements, а не копировать их. Реальные OAuth/provider/device/production проверки в будущих соответствующих задачах.

Итоговый реестр56:5done/3ready/48backlog. Ready AUTH-002/DEPLOY-001/TG-001; primary AUTH-002. Этот финальный docs-only evidence cycle также исправляет исторический bridge в MODULES_AND_BOUNDARIES/Auth UX и включает ссылку на актуальный ADR. Контракт/tests/runtime dependencies не меняются после проверенного implementation SHA; final check.py/diff проходят отдельно.
