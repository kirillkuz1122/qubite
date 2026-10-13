# ADR-0021: отделение legacy, поддомены и самостоятельные турниры

CONFIRMED13.10.2026 прямыми ответами владельца перед QUB-REPO-001. Старый back/front/app/deploy/HTML/legal/учебные материалы переносим, новые core/contracts/assets/scripts/docs сохраняем. Сервисы Search/Writing/VPN/Brief/Kwork/native references остаются для нового обсуждения/проектирования; старый интерфейс/API не будущий продукт. SiYuan не нужен, сохранён отдельно.

## Решение

legacy/qubite-v1 сохраняет целый старый сайт и installer; legacy/qubite-vpn — Flutter/VPN; modules/tournaments описывает standalone optional компонент с единственной копией runtime в legacy. Турниры не связаны с Qubite 2.0: собственный вход/аккаунты/данные/роли, без SSO/core module grants/aliases/AI access. Старые handler/services/бот сохранились в исходниках сайта, не включены в новое ядро. Новая установка может выбрать этот самостоятельный компонент отдельно.

Все новые модули на поддоменах выбранного домена. Это URLs/ingress, а не решение делать отдельные микросервисы/БД или разные React дизайн-системы. Конкретный домен/TLS/routing/session handshake/provider callbacks будут обсуждаться в deploy/Auth tasks; никаких wildcard cookies/CORS/automatic iframe этой задачей.

Root README/AGENTS/CLAUDE/SECURITY/TODO/индекс docs описывают универсальную платформу. Старые документы перенесены/помечены; before-move snapshots сохранены. Заполненный deploy/.env не удалять/не менять. Дополнительное уточнение владельца: root .env/.env.example заменить новым незаполненным шаблоном, предыдущий root env сохранить приватно со старым сайтом. Runtime core не начинает автоматически читать env.

## Что отменено

Отменяется обязательный identity adapter/SSO новый core→Tournaments из ADR-0007/0008, diagrams/tasks/Owner Console migration предложений. Сам Node/SQLite/Vanilla engine сохраняется. Master/access/kickoff источники остаются неизменными, новое решение имеет приоритет. Раздельный tournament owner не становится platform_owner Qubite.

## Альтернативы и обратимость

Полное удаление старого сайта/VPN отклонено: сохранить референсы/installer/историю. Перенос всего старого back как будто нового core отклонён: монолит содержит old services/roles и paid bypass. Встраивание/SSO турниров отложено без задачи — сейчас явно не требуется. Subpath routing для модулей отвергнут владельцем в пользу поддоменов; отдельный сервер для каждого не требуется.

Git archive tournaments/tag qubite-v1.0 immutable96f0457a. Перенос source не миграция SQLite/PG и не deploy. Карта/checksums обеспечивает проверку и обратный перенос; private env/DB/uploads не включать в commit. Новая установка/module installation из Owner Console — DEPLOY-001/002/003; owner local bootstrap уже реализован AUTH-002/009, его orchestration при install ещё нет.
