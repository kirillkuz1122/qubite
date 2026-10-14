# Handoff — QUB-UI-003, 14.10.2026, review/testing

Task разрешён после трёх ответов: locked по умолчанию, hidden вручную; общая настройка для модуля без per-user overrides; при read grant upcoming/unavailable показывать. [ADR-0025](../architecture/decisions/0025-server-module-catalog.md), [контракт](../architecture/MODULE_CATALOG.md), [отчёт](../reports/QUB-UI-003.md). Следующие задачи не разрешены.

## Runtime

Core0.7.0/schema0008_catalog: additive presentation table и IDs projects/atlas; existing UUID/sessions/grants/SQL0001..0007 preserved. Curated8 product cards, не импорт Knowledge/legacy/Tournaments. Default visibility locked; installed/enabled/released не включаются миграцией. Session-filtered GET me/modules/detail, hidden+no read/unknown generic404; owner GET owner/modules separate from ordinary home. Под upcoming учитывается direct read entitlement, old me/access installed-filter unchanged. Existing owner policy command catalog_visibility с recent own-password/CSRF/If-Match/idempotency/atomic audit/global revision. Visibility не grant, paid/resources gate unchanged.

apps/web0.4.0: API metadata only in live, no demo catalog fallback; strict DTO/expiry/detail revision, old responses cancelled/data cleared; private outgoing snapshots disabled with incoming Flux motion retained. Existing Поток/Игрушечная/Лента/Unbounded/Manrope100/503, lite/quiet/coarse/OS reduce. OwnerCatalog общий live/demo, per-row unsaved draft+Save; password only live, clear after attempt; error/manual recheck without replay/fake success. Default demo all locked, planner fictional temporary unavailable, local preview save only memory/no API. Home shortcuts/error/loading; live status grant does not open actual domain engine.

## Проверки и завершение

Final86browser passed1.2m:18desktop+19phone+33live fixtures+16real browser/core. Новые real cases owner save/default/no grants, shared hidden member/revoke, concurrent tabs/reauth error/stale conflict, expiry while page open, mobile/landscape/desktop/light/dark axe. Catalog22core targetpass, harness11pass. Final regression all997+harness11=1008pass: core208/175/202/22 (27.63/54.40/77.32/8.42s), no failed/skipped. Exact-SHA CI записать перед done. Manual screenshots phone/desktop/light/dark inspected; App skip-link position и neutral disabled Save CSS поправлены; final86browser passed1.2m. Это source-copy/loopback/synthetic DB/member/mail/registrar, не physical/native/SMTP/provider/installer/production acceptance.

Runtime helpers только scripts/engineering/web_auth_fixture.py /__fixture__/catalog в synthetic test app; не mount в production. Core groups4, --suite catalog targeted; every file exactly once, future/nested сохраняются в third, timeout180 unchanged. Старые migration tests ожидают schema0008, typed policy-v1.1 extension/OpenAPI updated; permission defaults deny и no owner bypass preserved.

Base3b8d9e435e036bf008de46486a49e1684687f439. Existing .antigravitycli/07eac59c-6b3f-4705-b06f-3fd77ff36ace.json deletion исключать/не восстанавливать. Filled deploy/.env/rootenv/DB/legacy/design-lab/ShadeAI/личная память/skills/subagents/quota reset untouched. Origin main/archive refs verified before coding: tournaments/tagqubite-v1.0 immutable96f0457a523b6b79f21c4092056d8fa8fa69a680. Git push не deploy; permanent schema migration отдельно с backup/restore/staging/approval. Старый core откажет после0008, no down/drop/legacy restore; preserve new writes, forward fix.

Reuse existing owner-private shell demo projectappgprj_6ace5114ca9c8191adc1bd33365fc909 из ignored apps/web/.openai/hosting.json, static.directory=dist: separate source copy/demo build only. Current published version3/source9c0707a40dc3c504747d4543eab4a3c55e19fb76/deploymentappgdep_6ace8192efb08191ae7bb0ca82a71245 succeeded13.10T19:08:19UTC. После implementation push/tests обновить то же демо; owner/custom/one owner/zero groups сохранить и повторно подтвердить. Static artifact only .openai/hosting.json+dist, no env/core/browser fixture. Старый material-lab не меняется.

## Следующий цикл

Primary AI-001 atomic mock budget reservation → AI-002 mock dispatcher → AUTH-004 full users/grants/budgets Console (depUI003+AI002). Сначала новые вопросы владельцу и ответы, затем один bounded task; не делать paid calls и не включать API providers. Alternative ready CORE-002/AUTH-013/DEPLOY-001/TG-001 отдельно. Legal operator/jurisdiction/contact вопрос ещё pending; publication_ready=false, QUB-LEGAL-001 before public launch. SMTP/native/Auth subdomain/module installation/server deployment остаются своими задачами.
