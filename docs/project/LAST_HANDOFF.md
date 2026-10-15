# Handoff — QUB-AI-002, 15.10.2026, review/testing

Перед реализацией получены ответы: максимум3 попытки всего только proven NotSent, backoff1s/2s с live checks; configurable timeout60s; fallback только вручную. [ADR-0027](../architecture/decisions/0027-mock-dispatcher-and-safe-retries.md), [контракт](../architecture/AI_DISPATCHER.md), [отчёт](../reports/QUB-AI-002.md). AI-002 разрешена; AUTH-004 требует новых вопросов/ответов.

## Runtime

Core0.9.0/schema0010_dispatcher, additive2tables+timeout column, всего40tables; прежние SQL0001..0009/identity/session/grants/budget ledger сохранены. Job создаётся вместе с reserve/outbox. Internal Dispatcher claim/fencing→live admission→committed intent→sealed MockProvider→exact usage/unknown. Нет startup worker/public spend/webhook/provider network/API ключей, raw prompt/response store. Generic REST/job/tool/WS paid gate закрыт. Доменный/agent/native admission отдельными scoped slices, существующие delegation APIs не получают AI capability.

Live origin session/auth_version/permissions, price/model/expiry/bound, caps/freeze/revisions и payload SHA256 проверяются перед каждой попыткой. Перед committed intent revoke→0calls; после него accepted in-flight расход не обнуляется. Любая policy/budget revision change консервативно отменяет ещё не отправленную stale authority. Claim lease=request timeout+15s, queue TTL5min до отправки. Только durable NotSent разрешает safe retry/release; private transactional helper проверяет all attempts not_sent. Generic release после dispatched по-прежнему запрещён. Unknown/cancel/timeout/crash после intent/DB finish failure не повторяется, резерв сохранён; late verified usage закрывает ровно один раз. Старые dispatched/unknown outbox при forward migration никогда не replay.

apps/web0.4.0/выбранные assets/Поток/Игрушечная/Лента/Unbounded/Manrope100/503 без изменений. Existing private shell preview v5 прежний; UI budget/timeout controls ещё нет, AUTH-004 отдельно. Legacy/reference/Tournaments/ShadeAI untouched, реальные providers/SMTP/native/installer/deploy не выполнялись.

## Текущие проверки

Full groups208/175/202/22/61/44 in40.44/97.76/108.48/10.78/52.31/41.86s; Target40pass38.42s, расширенный42pass41.11s, final45pass55.23s. Финальный target покрывает late NotSent/revoke после committed intent/invalid usage/overrun freeze, также два spawn процесса100 claims→1 mock delivery и реальный os._exit(17) до/после intent/send. Full regression snapshot44 dispatcher cases completed all1102+harness11=1113pass; final45 отдельно прошли после последней уточняющей правки только dispatcher. Browser86pass1.5m, format/build/build:demo pass. Source/harness11pass. Full all passed на snapshot44, final45 обновлённого dispatcher отдельно; exact-SHA CI ещё pending; не объявлять done до них. Logs /tmp/qubite-dispatch-{target,final-target,regression,web-tests}.log.

Test tools из /tmp прежней сессии исчезли; новые /tmp/qubite-dispatch-tests/bin/python (Python3.14.8, pinned test-requirements.lock) и /tmp/qubite-dispatch-postgres/usr/bin (PG18.6). Native packages распакованы только /tmp, SHA256 из pacman metadata проверены; нет system install/service. Initial PG suite не стартовала из-за missing executable, это не тестовый failure runtime. Harness core_groups6/--suite dispatcher, future/nested file exactly once, timeout180 unchanged. OpenAPI0.9.0; permanent0010 отдельно с backup/restore/staging/approval, old core ahead fails, forward recovery preserve new writes без down/drop/reset.

Base main7cf63a0470d6b9e09b71a121fcbe973bda4a5051/origin verified; immutable origin/tournaments+qubite-v1.0=96f0457a523b6b79f21c4092056d8fa8fa69a680. Existing .antigravitycli/07eac59c-6b3f-4705-b06f-3fd77ff36ace.json deletion исключить, не stage/revert. Filled deploy/.env/private root env/DB/uploads/личная память/skills/subagents/quota reset untouched. Git push не deploy. Перед commit staged review; русский commit+immediate push main; проверить engineering/web exact implementation SHA, затем completion docs.

## Следующий цикл

После AI-002 primary **AUTH-004** users/grants/budgets/registration+invites Console — сначала новые вопросы/ответы. Global switches AUTH-015 и ChatGPT/real funding/provider flows отдельно; Legal operator/jurisdiction/contact pending/publication_ready=false, до public launch свой gate. Registry69:18done/4ready/1review-testing/46backlog до completion; актуальный tasks.json authority.
