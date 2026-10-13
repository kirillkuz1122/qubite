# Перенос исходников — QUB-REPO-001

Одобрен владельцем13.10.2026 после четырёх вопросов: legacy сайт/app/deploy/docs сохранить, reference services оставить, турниры independent optional, modules subdomains. Дополнительно root .env/example заменить незаполненным новым шаблоном; filled deploy/.env не трогать. [ADR](../architecture/decisions/0021-repository-layout-and-standalone-tournaments.md).

## План и границы

1. Проверить чистый main/origin и immutable archive branch/tag96f0457a; сохранить pre-move file hashes/корневые документы. Не читать секреты в tool output.
2. back/front и11root HTML/legal/maintenance/.env.example/SMARTCAPTCHA/старые docs/deploy → legacy/qubite-v1. app/qubite_vpn + app notes/proxy guide → legacy/qubite-vpn. SiYuan source+guide → legacy/integrations/qubite-siyuan. Сервисные docs → docs/legacy-services, исходники services/integrations кроме SiYuan на месте.
3. Обновить относительные assets/routes/installer/dependencies, не менять auth/scoring/schema/core runtime. Не создавать compatibility symlinks/catch-all bridge. Root .env/example новый blank core; предыдущий root env приватно legacy; filled deploy/.env сохранён.
4. Записать самостоятельный optional Tournaments manifest, новую startup карту/ADR/context/tasks, отдельные service discovery задачи с owner questions. Старые module/identity/AI схемы не распространяются на tournament accounts.
5. Coverage/checksums, legacy HTTP/static/Writing assets, shell syntax + nonmutating installer plan, harness link/source-copy guards и все существующие Node/Python/real disposable PG tests. Exact SHA CI после русского commit/push. Не выполнять real install/provider/polling/DNS/deploy.

## Проверка отсутствия потерь

[RELOCATION_MANIFEST.json](RELOCATION_MANIFEST.json) перечисляет каждый tracked old→new путь с исходным SHA256 и причинами разрешённого изменения. Legacy HTML/frontend/scoring/VPN binary sources должны остаться byte-identical, кроме явных docs/installer/path changes. Новые core/contracts/design runtime остаются прежними. Pre-move repository docs дополнительно в legacy/qubite-v1/docs/repository-notes.

Env/DB/node_modules перемещаются только локально с исходниками и ignored; root private env по новому указанию сохранён в legacy, deploy/.env не меняется. Protected metadata хранится только в /tmp для сравнения (values не выводятся и не попадают в Git). Нет SQL миграции/записи существующих DB и никакого install.sh/systemctl запуска, кроме --plan.

## Rollback

До любого deploy обратный перенос по manifest с проверкой коллизий; сохранить заполненный deploy/.env и оба private legacy/new root env отдельно. Git revert source commit после сохранения локальных runtime данных; не reset --hard и не overwrite не-Git DB. Archive branch/tag не меняются. Старые service binary сборки сохранены как непроверенный reference, не распространяются как новый release.

## Дальше

UI-001 отдельное обсуждение shell → AUTH-007 auth screens. Search/Writing/VPN/Brief/Kwork/Knowledge перед своим модулем новые вопросы, сценарии, links Objects/Docs/Projects/Inbox и core API. DEPLOY-001/002/003 новые module selection/subdomains/owner bootstrap/operator controls; TEST-002 independent tournament runtime перед будущим релизом.
