# AI память, skills и tools

CONFIRMED: Hermes-подобная управляемая память, а не тренировка LLM весов. Working TTL, episodic event references, semantic facts, procedural recipes, skills registry, project memory, private vault memory и memory proposals — разные сущности. Каждый MemoryItem: owner/scope/source locator/confidence/freshness/expiry/review/status/consent, edit/delete/export. Удаление распространяется на summaries/index/embeddings, но financial ledger хранится отдельно по retention.

Context Resolver: authenticated scope → ACL до retrieval → минимальная source выборка → token/time budget → citations/Context Inspector. Personal/project/task/lesson/team contexts не пересылаются целиком; Shared assistant и private augmentation имеют отдельные logs/prompts/exports. Life ciphertext не индексируется team/global; анализ локальный либо явный просмотр export diff.

SkillVersion: manifest id/version/owner/input-output schema/tool allowlist/requested scopes/max steps/time/money/fixture tests/rollback/compatibility version. Agent proposal → isolated tests → policy-check → diff → owner approval или bounded preapproved safe class → activate. Агент не меняет свой system prompt/security/capabilities произвольно. Failed/obsolete skill возвращается в proposal, без auto-production update.

ToolInvocation: action preflight, schema, dry-run, diff preview, current object revisions, approval payload hash/expiry, idempotency, execution audit/result; external send unknown → paused. Approval стареет при изменении данных/grants. Делегирование {parent_invocation,subject,scope,object_refs,budget,max_depth,deadline}; intersection rights, общий финансовый резерв, recursion/step cap. Logical agent на объект не отдельный process/LLM на каждое действие.

Hermes — external optional connector: import только проверенных memory/skill форматов с scope/provenance, без копирования private configs/session. Не строить core на Hermes availability. Бесплатные manual command/search paths не требуют LLM. Retrieved web/school/mail content — untrusted data; оно не может авторизовать tool calls.

Приёмка: team agent не видит private memory, indirect graph/citations не раскрывают titles; no-grant MCP/tool/job deny до provider; proposal не активируется без policy; deletion убирает derived index; повторный skill update имеет version/hash/audit; expired approval и fork scope запрещены. Полный исходный перечень сохранён в master §10 и requirement trace.
