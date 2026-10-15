# QUB-AI-002 — mock dispatcher, 15.10.2026

Статус: review/testing; final dispatcher45pass, browser86pass, full regression1113pass+final dispatcher45pass, exact-SHA CI pending. Перед реализацией получены ответы владельца: до3 safe attempts с задержками и повторной проверкой; configurable60s; fallback только вручную. [ADR-0027](../architecture/decisions/0027-mock-dispatcher-and-safe-retries.md), [контракт](../architecture/AI_DISPATCHER.md).

Core0.9.0/schema0010_dispatcher: additive2tables+timeout column; queued jobs вместе с reserve/outbox, fencing и live permissions/caps/pricing/expiry перед каждой попыткой, committed intent перед mock await, durable proof NotSent для safe1s/2s retry/release, unknown/cancel/timeout/crash без automatic replay. Полная actual usage/freeze по AI-001. Strict sealed mock provider без HTTP/key/URL/callbacks; generic paid gate закрыт. Нет нового публичного spend/webhook/Console API/стартап worker, нет raw prompt/response store. AUTH-004 дальше, после новых вопросов.

Base main7cf63a0470d6b9e09b71a121fcbe973bda4a5051/origin verified. Immutable tournaments/tagqubite-v1.0=96f0457a523b6b79f21c4092056d8fa8fa69a680. Existing external deletion .antigravitycli/07eac59c-6b3f-4705-b06f-3fd77ff36ace.json не включать/не восстанавливать. Не меняются secrets/env/legacy/reference services/ShadeAI/личная память/skills/subagents/quota reset. Push не deploy.

## Evidence

- Local full snapshot all1102+harness11=1113pass (dispatcher44); final updated dispatcher45pass55.23s separately, unchanged remaining runtime; browser86pass1.5m, format/build/build:demo pass. Full core groups208/175/202/22/61/44 in40.44/97.76/108.48/10.78/52.31/41.86s. No failed/skipped final; exact-SHA CI pending.
- Старые /tmp test tools отсутствуют после смены сессии; подготовка isolated Python3.14 из pinned test-requirements.lock и native PG18.6 только под /tmp, без system installation/service. Initial запуск PG suite не состоялся из-за отсутствующего executable; это не результат runtime tests.
- Native PG package URLs/SHA256 взяты из configured pacman package metadata; extraction только /tmp, checksums проверяются до исполнения.

Риски/границы: mock source-copy тесты не реальный provider/device/production acceptance. Crash между committed intent и send консервативно unknown. Any config revision может отменить pending работу; это явно документировано. Permanent0010 migration отдельно; preserve new writes, forward fix, old binary fail closed, не down/drop/reset/legacy fallback.

- Current local union покрывает1200 distinct cases; full snapshot имел44 dispatcher cases, последняя правка только dispatcher и дополнительный revoke-after-intent case проверены final45. Exact-SHA CI должна прогнать все1103 runtime+11harness+86browser на едином финальном source snapshot. Logs /tmp/qubite-dispatch-regression.log, /tmp/qubite-dispatch-final-target.log, /tmp/qubite-dispatch-web-tests.log.
