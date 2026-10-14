# Каталог модулей — UI-003

Согласовано владельцем14.10.2026: locked по умолчанию, hidden включается вручную; одна настройка для каждого модуля; пользователь с read grant видит «Готовится» или «Временно недоступен». [ADR-0025](decisions/0025-server-module-catalog.md). Каталог раскрывает presentation metadata, не содержание пользователя и не разрешение на операции.

## Runtime и модель

Core0.7.0/schema0008_catalog, apps/web0.4.0. Forward0008 добавляет одну module_catalog (26 core tables), FK на policy_modules, имя/описание/label/tone/icon/порядок, visibility CHECK hidden|locked DEFAULT locked, released DEFAULT false. Сохраняет subjects/UUID/credentials/sessions/grants/audit; добавляет отдельные IDs projects/atlas, ничего не устанавливает и не выдаёт. Не изменяет SQL0001..0007. Код startup/readiness не выполняет DDL или repair; миграции запускаются explicit CLI только в отдельно согласованной среде.

Восемь карточек соответствуют выбранной оболочке: docs/projects/planner/search/writing/vpn/vault/atlas. Старый knowledge остаётся reference/отдельным policy ID; Tournaments — independent optional платформа, не в новом catalog. Остальные старые policy IDs не удаляются, будущие product modules сначала обсуждаются, получают trusted metadata/adapter/acceptance отдельно. Это не импорт старых сервисов.

Read entitlement проверяется по active session/subject на каждом read: action=read, effect=allow, срок не истёк. Write/manage/ai не подразумевают read. /me/access по-прежнему installed/enabled; его отсутствие для будущего модуля не стирает исходный разрешённый read в presentation catalog. В профиле список назван правами на включённые модули. Workspace/resource gate обязателен для любых domain данных: catalog не capability, предварительное read не авторизует effects.

| Права / состояние | User catalog |
|---|---|
| Нет действующего read, hidden | Нет строки, detail404 not_found |
| Нет действующего read, locked | Публичная карточка status locked, без installed/enabled/released |
| Есть read, не installed | preparing |
| Есть read, installed но disabled | unavailable |
| Есть read, installed/enabled но не released | preparing |
| Есть read, все три flags подтверждены registrar | ready; это не object authorization |

Singleton owner на обычной главной проходит те же read правила. Owner metadata list показывает все восемь строк/visibility/flags без выдачи прав. Released — presentation готовность, не замена существующему policy gate. Сейчас все карточки не установлены/не выпущены. HTTP команды не меняют installed/released; future registrar должен соблюдать общий policy lock/revision/audit, убедиться в настоящем adapter/health/ingress до отметки ready. Реальный registrar/installer не реализован UI-003. UI только placeholders без подключения domain engines/subdomain URLs.

## HTTP и запись

| Метод/путь | Authority / контракт |
|---|---|
| GET /api/v1/me/modules | Current session; filtered revision/items |
| GET /api/v1/me/modules/{module} | Current session; тот же фильтр, ровно одна карточка или generic404 |
| GET /api/v1/owner/modules | Current singleton owner; metadata и states всех product cards |
| POST /api/v1/owner/policy/commands | Existing owner protocol, kind=catalog_visibility/module/visibility/reason |

JSON строгий. Public card: module/name/summary/label/tone/icon/visibility/status/access_expires_at. Owner добавляет installed/enabled/released. Нет raw HTML/SVG/произвольных links/private payload или чужих UUID. Unknown IDs, hidden denied и исключённые presentation modules одинаково404; locked direct route показывает отказ, не данные. Операции вообще отсутствуют за этим GET. Guard: exact Host/Origin, no query/cross-site, narrow cookies, no-store/no-referrer; Bearer/legacy tokens не принимаются.

Сохранение одной строки требует собственного пароля (POST reauth), свежего CSRF, exact If-Match «policy-N», Idempotency-Key UUID. Existing PolicyStore exclusive lock сериализует state update+revision+before/after audit. Глобальная revision консервативно инвалидирует старые delegations/WS probes даже при изменении только visibility; persisted grants не удаляются, новая capability проходит прежний gate. Один winner при двух вкладках; stale409, отсутствующая precondition428; одинаковый actor/key/body/expected replay возвращает прежний receipt без второго audit. Чужой actor/nonowner запрещён; extra fields installed/released/subject/permission не принимаются. Ни одна visibility команда не меняет entitlements/AI grants/installation flags или accounts.

Сохранение строки сохраняет ещё не отправленные черновики других модулей. Reread снимает draft только при совпадении с подтверждённым server value; visibility/grants других строк не отправляются этой командой.

Owner UI не применяет optimistic server save: переключатель меняет отмеченный draft, рядом явное «Сохранить», пароль очищается после попытки. На ответе reread, а при потере/ошибке — понятный статус и ручное обновление перед новым сохранением. Ни таймаут, ни409/503 не вызывают автоматического replay. Idempotency server protocol остаётся источником истины.

## React и живой материал

Existing Поток/Игрушечная/Лента/Unbounded/Manrope100/503, LivingTabs/LivingButton, общий appearance, лёгкий rendering/quiet/OS reduce. Новых имитаций controls нет. Catalog DTO проверяется полностью, unique IDs/enum/limits/aware expiry; class/icon/route только из узких значений, текст escaped React. Demo catalog существует только compile-time demo; live получает все titles/descriptions с API, не использует demo strings как fallback.

Для direct URL server detail перечитывается после catalog; разные revisions/metadata fail closed. На route/focus/online/visible/recheck каждые60s и в момент read expiry data сбрасывается перед fetch, Abort+generation запрещают поздние ответы. Истёкший hidden read не рисуется даже между refresh и render; нет expiry retry loop. Live MorphContent не копирует уходящие private snapshots, incoming Flux movement сохраняется. Home shortcuts — только разрешённые catalog states; failed/loading catalog не выдаёт ошибку подключения за отсутствие grants. Sidebar/Command/Auth сохраняются. Никаких permissions/password/proofs в storage, только прежние appearance preferences.

## Проверка, migration и rollback

Source-copy Harness без env/real HOME, real disposable PostgreSQL, отдельная четвертая catalog group в пределах180s; target --suite catalog. Browser/core проверяет настоящие API/session/PG, synthetic mail/registrar/member setup только /__fixture__/catalog в test-only helper. Нельзя публиковать или включать fixture в production. API fixtures/viewport/axe не real device/FPS/installer/backend deployment acceptance. CI web+engineering exact implementation SHA; итоги в [отчёте](../reports/QUB-UI-003.md).

До реальной forward migration — отдельное разрешение deployment, inventory/backup/restore/staging. 0008 additive; failed batch rollback возвращает prefix0007 без новых IDs/table, existing grants/UUID сохранены. После успешной0008 старый binary отказывается от ahead schema, его нельзя запускать против новой БД. При проблеме остановить новый catalog consumer/artifact, сохранить current DB/grants/audit и применить forward fix. Не DROP/down/restore legacy accounts; trusted visibility correction через guarded command. Старые заполненные env/DB/uploads и immutable Git archive не менялись.
