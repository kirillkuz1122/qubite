# ADR-0004: история и приватность

CONFIRMED: local-first, версия/restore, отдельно Ink Replay/audit/undo, private/team separation, переносимость. RECOMMENDED: durable client outbox, optimistic revision conflict MVP, CRDT text collaboration после POC, append-only domain events + snapshots (не event-source каждой таблицы).

OPEN QUESTION: offline device lease/revocation window, retention history/media/audit, key recovery Life/E2EE и доступность server-side AI. Private Vault исключён из общего index/agent/plugin/team; owner platform management не даёт plaintext ключ автоматически.

Отвергнуты: LWW на весь контент (теряет edits), CRDT finance/grants (нужна server transactional authority), Git commit на каждый stroke (не тот persistence mechanism), пароль UI без криптографии. Acceptance: two devices offline conflict + kill/recover + restore new revision; lost key recovery POC перед real Life data.
