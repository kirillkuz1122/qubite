# Local-first, синхронизация и история

RECOMMENDED MVP: локальный IndexedDB/Android Room + private files, durable outbox. UI сначала атомарно сохраняет content+local command, затем отправляет. Статусы local_saved/queued/synced/conflict/error — server ack обязателен для synced.

Push contract /api/v2/sync/push: device_id, batch_id, commands[{id,object_id,base_revision,type,payload_schema,payload_hash,payload}]. Server связывает device с authenticated subject, авторизует каждый command и соблюдает declared atomic batch semantics. UNIQUE(subject,command_id) связывает payload fingerprint; повтор возвращает тот же результат. Конфликт revision → 409, оба варианта сохраняются, не silently LWW текст.

Pull /api/v2/sync/pull?cursor=<opaque>: разрешённые changes/tombstones плюс next_cursor. Cursor привязан к subject/workspace и generation, не позволяет обходить ACL. Revoke меняет authorization generation, закрывает WS и очищает разрешённые локальные cache/index при следующей связи; не удаляет авторские offline drafts. Долго offline device с expired cursor делает safe resync и upload drafts отдельно.

MVP merge manual для conflicting document snapshot; позднее CRDT только текст/совместный canvas после POC. Права, budgets и finance не CRDT. Ink chunk append-idempotent, immutable original samples, transform/delete отдельные ops; replay deterministic with checkpoint, audio clock reference отдельно. Peer device не authoritative для server permissions.

Истории различаются: editor undo/redo; meaningful Revision snapshots; append-only audit; domain event/outbox; point-level Ink replay. Restore создаёт новую revision с parent/source, не стирает audit и новые правки. External send/финансовая операция имеет compensation, не магическую отмену.

Blobs upload сначала staging/hash/check size/mime, finalize atomic metadata, background thumbnail/index. GC только unreferenced blobs после retention/restore window. Download authorizes attachment owner/scope, не один лишь hash. Handoff UI cursor/zoom/page/selection separate от content, exact authenticated device grant, private context не переносится автоматически.

Tests: kill после local commit; offline edit/restart/reconnect; duplicate/reorder/drop batch; 2 devices conflict; restore одновременно с новой edit; grant revoked while offline; incomplete media; expired cursor; replay/audio deterministic roundtrip. OPEN QUESTION: offline revocation policy и срок device lease выбрать вместе с владельцем.
