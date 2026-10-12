# Окружения, деплой и резервные копии

Статус: план, не выполненный production restore. Git archive готов; actual runtime backups ещё не созданы. Read-only server inspection отдельная маленькая задача, live changes требуют явного разрешения владельца.

Dev — isolated env/fixtures/temp SQLite, no provider keys. CI — source copy/no-network tests. Staging — отдельные ports/DB/blob paths/hostnames/test bot tokens, outgoing sends disabled, mock AI. Production — фиксированный проверенный SHA/artifact, exact ingress routes, migrations отдельно. git push не deploy; новый CI не содержит SSH/secrets/restart/pull.

Хостинг отложен по решению владельца от 12.10.2026; возможен VPS. Ограничения текущей Raspberry Pi не блокируют проектирование и локальную разработку. Этот runbook применяется к фактически выбранному серверу перед миграцией/деплоем.

## Inventory перед server этапом

Собрать без секретов: deployed SHA и dirty paths каждого приложения, unit/container version/image digest, listening ports/routes/TLS/Cloudflare config paths, db/volume/attachments paths и size/count, RAM/swap/disk/CPU, memory cgroup support, единственный tg-listener/polling, cron/timers/backup destinations. Сравнить production hashes с repository, не overwriting dirty Kwork hooks. Не читать токены/сессии/интервью в модель. Server environment не выведен из локального Git.

## Что резервировать

| Область | Набор | Restore acceptance |
|---|---|---|
| Legacy Node | SQLite consistent backup, uploads, private config/env и encryption keys в encrypted backup | integrity/FK + auth/session/grants/tournament/rating tests |
| Search | search.sqlite/history/ciphertext/ledger, key/config references | accounts isolation, old ciphertext retained, ledger spent/reserved |
| Brief/Kwork/leads | все State SQLite/outbox/usage, attachments/PDF, mapping/HMAC/session private storage | invites/links/variants/approval states, no sends during drill |
| Native apps | AliasVault/Memos/Vikunja/SiYuan DB/volumes/files, enrollment registry и manager private config | native accounts ownership + grants, attachments |
| Infrastructure | unit overrides/Caddy/Nginx/Cloudflare/firewall routes/config + credential keys | exact ingress, Auth independent, no public management port |
| New core позже | Postgres backup + WAL policy, blob manifest + content + key envelopes | schema version/count/revisions/ACL/hash/restore + no orphan blobs |

Один manifest: backup ID/time UTC, application/schema SHA, components paths/checksums/size, consistent checkpoint, encrypted storage reference, retention, key-recovery reference, restore result. Сам manifest в Git только redacted; backup/keys не в Git. Off-host копия обязательна: единственный диск сервера не backup.

RECOMMENDED цели для обсуждения: RPO 24h для обычных notes; tighter для ledger/outbox перед критическими действиями. RTO 4h как начальная цель, не проверенное обещание. Перед каждой миграцией fresh snapshot независимо от schedule. Daily/weekly/monthly retention надо согласовать с private deletion policy.

## Runbook release

1. CI green, reviewed artifact SHA, approval архитектуры/задачи/production deployment.
2. Read-only drift/capacity report, current backups, disposable restore rehearsal без outbound network.
3. Staging migration dry-run и rollback; count/FK/hash/policy comparison.
4. При необходимости короткий write freeze конкретного модуля, drain outbox/jobs; Auth/SSH/network продолжают работать.
5. Apply expand migration/version, deploy one canary route/module, health + critical smoke + memory/queue/budget наблюдение.
6. При ошибке routing rollback, preserve writes, reconcile later; восстановление backup только с пониманием новых записей.
7. Report deployed SHA/data migration ID/checks/results/open acceptance, owner release decision.

Zero-downtime возможен для additive schema/routing, но не обещается SQLite DDL/identity cutover. PostgreSQL методы backup выбирать по [официальной документации](https://www.postgresql.org/docs/current/backup.html), не объявлять WAL/PITR настроенным заранее. Не включать autodeploy GitHub push.
