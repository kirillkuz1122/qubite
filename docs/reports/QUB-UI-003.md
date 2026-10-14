# UI-003 — Серверный каталог, 14.10.2026

Статус: done в согласованных границах, Git/CI/private demo подтверждены. [ADR-0025](../architecture/decisions/0025-server-module-catalog.md), [контракт](../architecture/MODULE_CATALOG.md).

Перед task вопросы заданы, ответы получены: по умолчанию locked, вручную hidden; одна настройка на модуль; при выданном read upcoming/unavailable показываются. Реализация core0.7.0/schema0008_catalog и apps/web0.4.0. Additive metadata сохраняет identity/гранты и legacy; восемь утверждённых карточек, Projects/Atlas получают отдельные IDs, Tournaments/Knowledge не импортируются.

Filtered session catalog/detail, generic hidden/unknown404, current explicit read до installation, owner metadata separate from ordinary home. Existing Owner policy commands/CSRF/reauth/If-Match/idempotency/atomic audit; settings UI Flux, per-row explicit save, unsaved draft label, password clear, no optimistic success/replay. Grants/paid/installed/released не меняются visibility. Read/write/manage/ai остаются независимыми, domain resource gate/owner no paid bypass unchanged.

Live does not embed demo catalog metadata, only API; route/detail revision guard, cache clear/Abort/generation/expiry timer and no private transition snapshots. Home/catalog/status/settings responsive; compile-time demo updated default locked, remains fictional/no server writes. Source-copy synthetic fixture extends member/registrar setup, not production installer/API. Правовые документы/SMTP/providers/native/production отдельно.

## Проверки и evidence

Новая catalog suite22pass с real isolated PostgreSQL: shared persistence, filters, every action/expiry/revoke, headers/cookies/owner/strict commands, race/replay/atomic audit, forward rollback/UUID/grants and storage drift. Harness11pass. Final86browser passed1.2m (18desktop/19phone/33HTTP fixtures/16real browser-core), including5 new full backend workflows; format/live+demo builds passed. Final local all997+harness11=1008pass, core4groups208/175/202/22 (27.63/54.40/77.32/8.42s). Manual screenshots inspected; small structural App skip-link/disabled Save CSS fixes rechecked: final86pass1.2m. Final evidence ниже. Первые прогоны обнаружили старые schema-count ожидания и необходимость ждать завершения входа в новых browser scenarios; fixtures/tests исправлены, failing runs не acceptance.

Base3b8d9e435e036bf008de46486a49e1684687f439. Existing .antigravitycli deletion исключить; filledenv/DB/legacy/design-lab/ShadeAI не менялись. Origin archive refs96f0457a523b6b79f21c4092056d8fa8fa69a680 verified before coding. До close русский commit/push/exact-SHA CI, existing owner-private demo update, не real core deployment.

Следующий primary track AI-001 atomic mock budget → AI-002 mock dispatcher → AUTH-004 users/grants/budgets Console. Перед каждым свои вопросы/ответы; эта задача не разрешает следующий scope и платные запросы. Alternative ready CORE-002/AUTH-013/DEPLOY-001/TG-001 по отдельному согласованию.

## Проверка перед окончательным закрытием

Initial implementation346909ca15dbf8330b61771f0fc45ec885983f9b pushed/origin verified. Exact-SHA web38502878056 completed/success2026-10-14T02:49:54Z86pass; engineering38502878053 success02:54:45Z1008pass. Private demo version4/source3a09b2b5ed7ddadced425aa2eb8c4ea59dccc2a5/deploymentappgdep_6acef03dc8748191bebd87b744606ac0 succeeded03:00:29.646235UTC, owner/custom/one owner/zero groups confirmed.

Final review found per-row save discarded other unsent choices. Corrected OwnerCatalog reconciliation in live/demo and extended existing real backend/demo tests to save two independent drafts. Server/schema/permission gates unchanged; final browser/CI/artifact evidence ниже указывает на corrected SHA/version.

## Подтверждённое завершение

Final code**9771158ce3600ff0c396ea72baedfbb67cc1d908** после initial**346909ca15dbf8330b61771f0fc45ec885983f9b**; русский commit/push/origin confirmed. Source and staged review исключили чужое .antigravitycli deletion, env/DB/browser state/build artifacts. Archive origin/tournaments и tagqubite-v1.0 immutable96f0457a523b6b79f21c4092056d8fa8fa69a680 verified. Шаблоны/filledenv/legacy не менялись.

[Final web CI](https://github.com/kirillkuz1122/qubite/actions/runs/38505000027) completed/success2026-10-14T03:13:58Z86pass; [final engineering CI](https://github.com/kirillkuz1122/qubite/actions/runs/38505000011) success03:17:10Z997+harness11=1008pass; both headSHA**9771158ce3600ff0c396ea72baedfbb67cc1d908**. Это1094 проверок local и1094CI, no failed/skipped. Core runtime unchanged by final draft correction, CI repeats full regression against corrected SHA. Completion-docs commit после code SHA отдельно; не выдавать его за новый web run. Physical device/FPS/screenreader/SMTP/OAuth/provider/installer/ingress/legal publication acceptance отдельно.

Existing [owner-private demo](https://qubite-app-shell-kirill.kuzmichevkonstantin9.chatgpt.site) **version5**, corrected source**56a26e87909a282edba46c4cc66265c39d4dc692** из git archive final apps/web. Separate /tmp source repo, clean npmci/isolated HOME, same pinned deps/rebuild correction, static.directory=dist in demo mode. Only .openai/hosting.json+dist archive,15files/696320bytes. Gzipsha25696a129d80e56fd1e5c89f37f93ce8c584d8cf89cefaa9e3624ef2e8c024ec944; normalized tarsha256e14d327dea052457f3ce1120225963f943b106ee9e750631bf1070bd470895b9. Saved versionappgprj_6ace5114ca9c8191adc1bd33365fc909~appgver_8e7e11d260a48191970fa6b6ffbc7180; deploymentappgdep_6acef5267ce08191bd9a61531c01b63c **succeeded2026-10-14T03:21:25.034187+00:00**. get_site after publish confirms version5/owner/custom/one owner/zero groups, env revision0. Initialversion4 superseded; previous material-lab untouched.

[Настройки](https://qubite-app-shell-kirill.kuzmichevkonstantin9.chatgpt.site/#/settings/owner), [каталог](https://qubite-app-shell-kirill.kuzmichevkonstantin9.chatgpt.site/#/modules). Demo edits stay in memory and make no API writes; no passwords requested. Real persistence is verified by separate source-copy browser/core PostgreSQL, not this static hosting. No backend/DB/production migrations deployed.

69tasks17done/4ready/48backlog. Next primary **AI-001 atomic mock budgets**, then AI-002, then AUTH-004 full users/grants/budgets Console. Перед следующим task вопросы/ответы владельца; no paid calls/price assumptions by this approval. Legal operator/jurisdiction/contact pending, public launch deferred.
