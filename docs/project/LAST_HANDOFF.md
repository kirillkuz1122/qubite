# Handoff — QUB-UI-001, 13.10.2026, review/testing

Вопросы до реализации, owner ответы1–3 получены. [Отчёт](../reports/QUB-UI-001.md), [ADR-0022](../architecture/decisions/0022-web-shell-and-command.md), [apps/web](../../apps/web/README.md). React shell0.1.0 separate live/demo, approved Toy/Flux/Ribbon/fonts; five sections, Command fixed bottom, settings-only owner entry. Live me/access read adapter, grants exact and no owner bypass; domain writes/auth forms/catalog persistence отсутствуют. Demo owner/member/new, ephemeral text/visibility preview, no paid/provider/mic calls. Local cosmetic settings only.

Local36 browser checks +965 all+11engineering=1012. Browser live tests fixtures, not real browser/core/device acceptance; PG18.6 disposable tested separately. Core0.6.0/0007/legacy/design-lab unchanged. Git exact SHA/CI пока ожидаются; статус не done до успешных результатов. ui001 architecture approved по ответам владельца, новая ui003 scope записана, detailed server decisions ещё вопросы. AUTH-004 зависит UI003+AI002.

Следующая для обсуждения **AUTH-007** React auth forms email/password/register/verify/reset/OAuth на existing core; до начала новые вопросы и ответы. UI002 физика Потока/сохранённые material prefs, UI003 backend per-module hidden/locked, PET и реальные domain modules отдельные. Tournaments independent optional без core SSO и отсутствует в shell catalog. Никакой установки/постоянного owner/real provider/production deploy.

Base main7da65e0edc5f9aecd0bc3de1f3e5c220be0bbd00. Existing external .antigravitycli deletion исключить. Secrets/env/build/browser state ignored; заполненный deploy/.env не трогать. Skills/subagents/quota reset/личная память writes не применять. Старые snapshots не текущий runtime статус.
