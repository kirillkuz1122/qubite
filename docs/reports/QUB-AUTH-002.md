# QUB-AUTH-002 — аккаунты PostgreSQL и локальное назначение owner

13.10.2026. Реализация и локальные проверки завершены; статус **review/testing**, ожидаются commit/push и CI для точного коммита.

## Что сделано

Добавлена миграция [0002_identity.sql](../../core/qubite/sql/0002_identity.sql): таблицы `subjects` и `platform_owner`. Аккаунт получает новый UUID, исходную и нормализованную почту, необязательное имя, статус, версию авторизации и временные отметки. Обычный новый аккаунт имеет статус pending и неподтверждённую почту. Паролей, сессий, глобальной роли, разрешений модулей и бюджетов в этих таблицах нет.

Локальная команда `python -m qubite.identity bootstrap-owner` создаёт активный аккаунт и единственную запись owner в одной транзакции. Почта и явное подтверждение вводятся через stdin. Повторный запуск, другая почта или совпадение с существующим обычным аккаунтом приводят к отказу без перезаписи/повышения прав. Ограничения PostgreSQL запрещают второго owner, привязку к неактивному аккаунту и случайное удаление/блокировку действующего owner. Публичной команды назначения и автоматического назначения при регистрации нет.

Общий advisory lock сериализует записи identity и миграции. Ошибка после первой записи откатывает обе таблицы; ошибка соединения/commit не объявляется успехом и не запускает автоматический повтор. В сообщениях ошибок нет почты, SQL, DSN, driver DETAIL и значений неправильных аргументов CLI. Нормализация почты сохраняет точки и +метки, использует casefold и IDNA2008/UTS46 без автосвязывания аккаунтов.

Миграция0001 и её checksum не изменены. Текущая версия схемы —0002; readiness проверяет историю и наличие обеих таблиц через каталоги, без чтения строк identity. Потерянные таблицы не восстанавливаются автоматически. Public OpenAPI/health version/core-v1 прежние; startup не применяет DDL и не создаёт аккаунты. `idna==3.20` уже присутствовала в lock, теперь явно отмечена как прямая зависимость; установка/обновление пакетов не потребовались.

[Подробная схема, команды и границы](../architecture/IDENTITY_SCHEMA.md), [решение ADR-0014](../architecture/decisions/0014-fresh-accounts-and-owner-bootstrap.md).

## Проверки

Финальный изолированный прогон:

```sh
python3 scripts/engineering/verify.py --suite all --python /tmp/qubite-design-tests/bin/python --postgres-bin /tmp/qubite-design-postgres/usr/bin
python3 -m unittest discover -s tests/engineering
python3 scripts/engineering/check.py
git diff --check
```

**477 проверок прошли: all473 + harness4, без ошибок и пропусков.** Локально: Python3.13, Node22.22.2, native PostgreSQL18.6. Разбивка: Node94, deploy18, Search95, Brief112, Kwork29, SiYuan5, identity protocol32, core88. Core содержит29 прежних foundation и59 новых identity cases.

Проверены реальные конкурентные подключения к PostgreSQL, repeat/collision, ограничения SQL и запрет удаления/смены статуса owner, ограниченная роль без права назначать owner, rollback частично выполненного bootstrap и DDL, pending/drift/missing schema gates. CLI проверена дочерним процессом; отдельно отмена/EOF и отсутствие приватных значений в ошибках argv. Публичные bootstrap/register/login маршруты отсутствуют.

Первый targeted прогон:85 pass/2 fail — тест ожидал ForeignKeyViolation, а PostgreSQL18 возвращает RestrictViolation для RESTRICT. Проверка уточнена до SQLSTATE23001/23503 и подтверждает сохранение owner; защита не ослаблялась. Повторный targeted прогон прошёл87 cases за4.11s. После добавления проверки argv финальный all подтвердил88 core cases за4.05s. Две существующие deprecation warnings FastAPI/httpx не errors; из-за них зависимости не менялись.

Runner использует source-copy без .env, отдельный HOME и временные БД; внешняя сеть запрещена. Не запускались реальные AI/provider/Telegram/HA/VPN вызовы. Дизайн и browser UI не менялись, прежние browser tests не повторялись. Git/CI для implementation SHA будут записаны после подтверждения.

## Git, данные и ограничения

Начальный main:93bca8edca89a0f694c1644790494c2884194de4, checkout чистый; origin refs проверены. Неизменные `tournaments` и `qubite-v1.0`:96f0457a523b6b79f21c4092056d8fa8fa69a680. Изменены только core/tests и документация/реестр. Legacy back/front/index/services/deploy, ShadeAI и секреты не затрагивались. Не было live migration/deploy, установки системного PostgreSQL или переноса старых аккаунтов. Временные тестовые clusters/DB удаляются fixtures.

**Постоянный аккаунт владельца ещё не создавался.** Рабочий вход, credentials, session/CSRF/OAuth, policy и Owner Console пока отсутствуют. Наличие таблиц и успешные тесты не означают готовую авторизацию. Ограниченные DB роли проверены на fixtures; provisioning операторских/runtime ролей в installer ещё предстоит. Readiness проверяет наличие/тип таблиц и историю, а не полный semantic fingerprint всех ограничений.

Откат кода сохраняет новые UUID/данные и ledger0002. Старый binary с историей0001 не станет ready на этой БД; нужен совместимый forward recovery, без drop/down или восстановления старых SQLite паролей поверх identity.

## Следующая задача

**AUTH-009:** Argon2id credentials, локальная установка пароля owner, настоящие FastAPI login/session/CSRF/logout/revoke на disposable PostgreSQL. Затем policy и React UI/Console по зависимостям. Native PKCE, scoped keys и introspection — отдельные задачи. Второй цикл автоматически не начинается.
