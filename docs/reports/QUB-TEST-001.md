# QUB-TEST-001 — HTTP baseline legacy Auth

12.10.2026. Выполнена первая задача по прямому запросу владельца. Реализация: `back/tests/auth-legacy-baseline.test.js` и test-only preload `back/tests/fixtures/auth-server.cjs`. Runtime `back/server.js`, `back/src`, frontend и deploy не изменены. Новый FastAPI Auth ещё не реализован.

## Метод проверки

Каждый сценарий запускает настоящий скопированный `server.js` отдельным дочерним процессом с `QUBITE_PROCESS_ROLE=auth`, временной SQLite и loopback-портом 0. Копируются только исходники, без root/back/deploy `.env`, рабочих БД, приватного HOME и секретов; зависимости подключаются через существующий node_modules. Производственный режим нужен для проверки cookie Secure, с явными synthetic Host/Origin `auth.test`.

Реальными остаются Express middleware/routes, SQLite/schema, парольный scrypt, хеши session/challenge/state, role/status/expiry checks, rate limiting, CSRF и OAuth state/PKCE/Telegram signature. Подменены только отправка почты и fetch-транспорт CAPTCHA/Google/Yandex/VK. Токен Telegram фиктивный, polling не запускается; корректная подпись вычисляется локально. Неизвестный fetch и внешний TCP запрещены. Внешний harness дополнительно запрещает DNS/сеть и очищает окружение.

Fixture читает только синтетические письма/данные через IPC. SQL используется для создания expired/blocked/revoked состояний и проверки persisted hashes/authority. Серверные логи дренируются без вывода OTP/токенов. После каждого сценария процесс завершается, временная копия удаляется. Разные user-agent моделируют разные устройства; отдельный тест проверяет дедупликацию одинакового устройства.

## Покрытие — 25 HTTP сценариев

| Область | Проверено |
|---|---|
| Регистрация/вход | login/email normalization, duplicate/invalid fields, scrypt и hash-only session, supplied owner role ignored, реальная проверка почты |
| Cookies/guards | HttpOnly/Secure/SameSite Strict/Path, чужой Host/Origin/Fetch-Site, неизвестные и повреждённые cookies, forged user/role headers, настоящий rate limiter |
| Сессии | собственный logout, logout-all сохраняет текущую, owner-scoped revoke, чужая сессия 404, expiry/blocked/deleted, same-device replacement без отзыва другого устройства |
| Recovery/verify | OTP→одноразовый reset ticket→новый пароль, revoke прежних сессий, replay/wrong purpose/wrong code/expired/forged отказ; неизвестная почта не получает reset authority |
| Owner/2FA | singleton bootstrap только после проверки нужной почты, challenge account binding, email 2FA не создаёт session до verify, повтор verify отказ |
| OAuth | Google/Yandex success и persisted state, missing/forged/expired/provider mismatch/replay, transport failure, blocked account; VK S256 и server-only verifier/device_id/runtime switch; Telegram HMAC/freshness/state |
| Известные дефекты | отдельные явно названные characterization tests для cookie 500, Google callback после disable и unverified email linking |

Auth-only процесс намеренно отвечает 503 на workspace `/api/profile`; защищённый отказ 401 проверяется на настоящем `/api/auth/logout-all`, без снятия workspace gate. Legacy отправляет reset challenge даже неизвестной почте; тест использует правильный синтетический код и доказывает отсутствие reset ticket/session. Это факты существующего поведения, не упрощённые router mocks.

## Обнаруженные дефекты и границы переноса

1. **AUTH-L01 — повреждённая percent-encoded cookie → HTTP 500.** `parseCookies` декодирует без обработки URIError. Процесс переживает запрос. Новый Auth должен безопасно отклонять/игнорировать повреждённый credential и не возвращать 500. Проверка в QUB-AUTH-009.
2. **AUTH-L02 — Google runtime disable не отменяет pending callback.** Start отвечает 503, но callback с ранее созданным state всё ещё выдаёт session. VK callback перепроверяет switch. Новый адаптер обязан проверять текущее разрешение в callback до exchange/session для каждого провайдера; QUB-AUTH-010. Нельзя обещать, что legacy тумблер немедленно отменяет уже начатый Google flow.
3. **AUTH-L03 — email-only linking без verified claim.** Синтетический Google profile с чужим существующим email и `email_verified=false` получает session этого аккаунта. Риск доступа к чужому аккаунту при таком provider claim; возможность получить такой ответ от реального Google в этой задаче не проверялась. P0 gate для нового account linking: immutable provider subject, явная безопасная привязка и проверенные claims; не переносить это поведение как совместимость. QUB-AUTH-008/010 обязаны учитывать этот кейс до cutover.

Три теста фиксируют существующие ошибки; их успешный результат не означает, что ошибки исправлены. При отдельном исправлении legacy изменить эти ожидания на безопасное поведение с report/evidence. Сейчас рабочая авторизация не правилась и не развёртывалась.

## Проверки и evidence

Окружение: Node v22.22.2, Python 3.14.7. Первоначальные предположения fixture скорректированы по коду: относительный OAuth redirect, Auth workspace gate, same-device session dedup, reset challenge для неизвестной почты. Первый прямой запуск в socket sandbox не дал успешной верификации; итоговый запуск разрешает loopback, сохраняя запрет внешней сети. Никаких skip/xfail для проблем окружения или дефектов.

```sh
python3 scripts/engineering/verify.py --suite all --python /tmp/qubite-audit-venv/bin/python
python3 -m unittest discover -s tests/engineering
python3 scripts/engineering/check.py
git diff --check
```

Результат полного runner: Node **94/94** (69 прежних + 25 новых), deploy **18**, Search **95**, Brief **112**, Kwork **29**, SiYuan **5**; всего **353**, плюс **4** harness unittest = **357 pass**. Fail/skipped/cancelled — 0. Existing deploy ResourceWarning и Search Starlette/httpx deprecation warning остаются, зависимости ради них не менялись. stdout verification временно в `/tmp/qubite-test-001-verification.txt`, не содержит credentials и не является единственным долговременным evidence; итог и scope записаны здесь.

Воспроизводимая task-команда: `python3 scripts/engineering/verify.py --suite node` (включает новые tests автоматически). Прямой `node --test back/tests/auth-legacy-baseline.test.js` также использует собственную source-copy изоляцию. В CI используется существующий engineering workflow, без deploy jobs/credentials. Commit/remote/CI evidence добавляется после проверенного commit отдельным handoff, чтобы не создавать циклическую ссылку на собственный hash.

## Что не проверено и следующий шаг

Реальные почтовые/OAuth/CAPTCHA/Telegram endpoints, TLS reverse proxy, браузерный UX, production DB/backup, платные модели, физические устройства не использовались. Этот baseline не даёт разрешения на live identity cutover или production deploy. Account code-entry/native VPN auth, полная tournament HTTP/rating матрица и browser E2E не входят в acceptance этой задачи; их отдельные QUB-AUTH-005/SVC-VPN/QUB-TEST-002 gates остаются открытыми.

Следующая основная задача **QUB-CORE-001**: отдельный FastAPI/Postgres foundation, health/контракты/версионированная миграция в disposable storage, без записи в legacy SQLite. Базовый стек уже согласован; детальные cutover/UX/device/deploy gates сохраняются. Эта итерация выполняет только QUB-TEST-001.

## Завершение и GitHub evidence

Статус **done**. Реализация/тесты/отчёт сохранены коммитом `695227792e6ab7a09cdad67b56d8acbad4cc0ad9`, push origin/main и remote SHA проверены. [GitHub Actions run 38207835631](https://github.com/kirillkuz1122/qubite/actions/runs/38207835631) **success** на этом точном SHA: полный isolated runner + harness, без deployment. `origin/tournaments` и `qubite-v1.0` повторно подтверждены на `96f0457a523b6b79f21c4092056d8fa8fa69a680`, не изменялись.

Registry done/commit/verification и актуальный handoff сохраняются отдельным последующим docs-коммитом. Его SHA брать из git log/remote; это исключает циклическое самоцитирование. Следующая primary задача QUB-CORE-001; в этой итерации она не начиналась.
