# Plugin SDK и MCP

RECOMMENDED: TS/JS SDK, без собственного языка; Wasm только для portable compute после POC. JS/Wasm не обеспечивает единый native UI или безопасность сам по себе. Web UI contribution изолированный frame/worker, server plugin отдельный UID/process, Android adapter явный. First-party modules не нуждаются в marketplace на первом release.

Manifest: id/version/minHostVersion/platforms/entrypoints/content hashes/signature/capabilities/requested permissions/network allowlist/migrations/UI contributions/quotas. Desired install state account-level; устройство сообщает compatible/degraded/incompatible, не скачивает/исполняет произвольный payload без approval. Revoke мгновенно запрещает новые Core API вызовы, активные jobs reauthorize.

API поверхности: Objects/Search/Commands/Event/Notifications/Agent Tools/Memory/UI Slots; каждый вызов через common policy и cost guard. Token scope пересекается с initiator и tool; нет universal_admin/raw SQL/fs/host network/key reads. Payload validated schema, quotas CPU/memory/steps/time, file sandbox и secret references вместо plaintext. Не обещать OS sandbox только по manifest.

MCP — limited view Core API: resources проектных контекстов, tools читать/искать/создать черновик задачи/сохранить отчёт, templates возобновления. По умолчанию read/draft assigned-project, не deploy/delete/send. Remote OAuth/scoped short-lived tokens исследовать по актуальной спецификации в QUB-MCP-001; версия из master не принимается без проверки. Local stdio credential отдельный, revoke enforced server-side.

Context Capsule JSON/Markdown manifest: project, purpose, allowed object refs/revisions, decisions, tasks, last report, privacy/expiry, source hashes. Preview/redact before export. Tokens/secrets/дневник/другие проекты исключены. Report tool добавляет evidence/test/commit URL, не ставит done без acceptance.

Acceptance: malicious plugin пытается raw SQL/FS/external network/cross workspace/model escalation → deny; revoked token/incompatible host, malformed manifest, package hash mismatch, duplicated install/migration rollback. SDK public licensing/security review до marketplace. Shade adapter остаётся независимым, не слияние репозиториев.
