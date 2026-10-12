# Реестр требований Qubite 2.0

Состояние всех новых функций: target/backlog, не implemented. CONFIRMED — продуктовая потребность из master/access policy; технические механизмы RECOMMENDED/OPEN QUESTION в ADR. P0 foundation/risk, P1 первый daily-use slice, P2 развитие, P3 отдельные релизы. Ни одна idea не удаляется.

| ID | Приоритет | Модуль | Требование | Проверяемый результат | Источник |
|---|---|---|---|---|---|
| REQ-CORE-01 | P0 | Core | Identity, scope, typed objects, explicit grants | New account profile-only; module/action/ACL denial tested | §0.1, §19 |
| REQ-OWNER-01 | P0 | Owner | Normal Today + hidden Console, independent module/config/budget management | Nonowner direct API/URL rejected; owner self AI budget=0 sends nothing | §0.1; access document |
| REQ-MIG-01 | P0 | Migration | Legacy preservation, archive/backup, scope role mapping | All migrated counts/hash/ACL/results/ledger reconcile; restore drill passes | §18, §21 |
| REQ-UX-01 | P1 | Today/Command | Spaces, fixed widgets, multimodal quick capture, responsive themes/a11y | Phone/tablet/desktop keyboard/zoom capture; no-grant widgets hidden; manual route works | §4, §9 |
| REQ-DOC-01 | P1 | Docs | Typed block AST, Markdown shortcuts/import/export, media/formula/task/Ink refs | Block/version export-import roundtrip; editor reload/undo, attachments ACL | §5 |
| REQ-DOC-02 | P2 | Docs | Templates, nested collections/views, selected text transforms and reversible AI diff | Template create/apply; accept/reject diff preserves later edits | §5 |
| REQ-INK-01 | P0 | Ink | Hardware probe/engine POC: pressure/tilt/palm/latency and adaptive smoothing | Real device diagnostic + benchmark trace and owner handwriting acceptance | §6.1–6.2 |
| REQ-INK-02 | P1 | Ink | Notebook pages/infinite canvas/PDF, brushes/layers/lasso/transforms/shapes/gestures | Stroke crash recovery, PDF visual/semantic fidelity, canvas memory/profile measured | §6.1–6.2 |
| REQ-INK-03 | P2 | Ink | Local handwriting profile/vector glyph synthesis, corrected samples and styles | Delete sample/export profile; generated Cyrillic/math editable on device without network | §6.3 |
| REQ-MATH-01 | P2 | Math | Confirmed OCR, symbolic/numeric checks/units/graphs/Visual Math | Wrong OCR corrected; equation/units checked independent of LLM; parameters change graph | §6.4 |
| REQ-REPLAY-01 | P2 | Ink/Media | Deterministic stroke event replay/checkpoints/audio binding | Roundtrip same points/timing; seek bookmark/object to audio; originals preserved | §6.5, §7.2 |
| REQ-STUDIO-01 | P3 | Studio | Layered art, brushes/fill/onion-skin/frame animation/storyboards/video | Frame timeline/export matches order/FPS; measured large-canvas performance | §6.6 |
| REQ-SCHOOL-01 | P2 | School | Subjects/lessons/homework/grades; permitted Моя школа adapter/manual import | Manual homework link+local progress independent official status; imported provenance | §7.1 |
| REQ-AUDIO-01 | P2 | Media | Consent recording, ASR Russian/diarization benchmark, timestamp citations | Consent revoked; recordings private; quality/latency/cost compared on permitted sample | §7.2 |
| REQ-LEARN-01 | P2 | Learn | Source-based quizzes/cards/oral exams/explanations/FSRS/skill evidence | Answer records and repeat schedule deterministic; citations point to page/block/time | §7.3 |
| REQ-PRINT-01 | P2 | Print | PDF A4 and narrow monochrome thermal cheatsheets | Real print widths no cropped formulas/margins; media previews/links preserved | §7.3, §20 |
| REQ-PLAN-01 | P1 | Planner/Projects | Task/project/milestones/dependencies, list/Kanban/Gantt/calendar same data | Task edit reflected in views; dependency cycle rejected; schedule proposal reviewed | §8 |
| REQ-CAL-01 | P2 | Calendar | Recurrence/reminders/free slots/Focus/school + future CalDAV adapter | Timezone/DST recurrence tests; reminder dedupe; no silent external write | §8 |
| REQ-TEAM-01 | P2 | Teams | Sharing/invites/ACL/comments/polls/presence/realtime/guest TTL | Guest expires/revokes; permissions view/comment/edit/audio/replay separated | §8, §17 |
| REQ-SEARCH-01 | P1 | Knowledge/Search | Keyword then semantic multimodal ACL search, typed graph, source explanation | Find linked objects; no private title/count/edge leak; index version/rebuild rollback | §9 |
| REQ-INBOX-01 | P1 | Inbox/Notifications | Capture inputs separate signals; dedupe/channel settings/fixed Today widgets | Telegram text/voice automatic scoped classify/format with durable raw Inbox fallback; manual correction; duplicate notification merges, urgent rule survives AI filtering | §9 |
| REQ-AGENT-01 | P2 | Agents | Scoped personal/project/task/lesson/team/specialist runtime with bounded delegation | Initiator∩tool∩agent scopes tested; token/depth/time/step limits; citations inspector | §10.1, §10.4 |
| REQ-MEM-01 | P2 | Memory/Skills | Eight kinds of memory, provenance/confidence/proposals/inspector/skill version tests | Confirm/reject/edit/forget/export; team excludes private; skill cannot activate itself | §10.2–10.5 |
| REQ-AI-01 | P0 | AI | Common allowlist/atomic reserve/unknown state/quota/cost audit | Two processes cap race; 0/missing budget sends 0; double settle idempotent | §0.1, access document |
| REQ-PULSE-01 | P2 | Pulse | Event/scheduler/heartbeat/dry-run/risk approval/idempotent jobs | Workflow simulation diff + timeout/retry/deny; event-only path avoids LLM expense | §11 |
| REQ-LIFE-01 | P2 | Life | Private journal/photos/voice/timeline, key/recovery/encryption/reflection consent | Recovery/lock/export tests; no team/search/plugin plaintext; remote export explicit | §12 |
| REQ-FOCUS-01 | P2 | Focus/Guardian | One-task view/timers/breaks/device consent/scoped trusted controller | Timer sync/emergency exit/revoke; capability POC does not promise universal kiosk | §13 |
| REQ-FIN-01 | P2 | Finance | Balanced ledger, accounts/budgets/recurring/Kwork taxes/portfolio sources | Balanced entries + compensation, no auto transfers; rates configurable/source timestamps | §14 |
| REQ-PLUGIN-01 | P2 | Plugins | Manifest/multi-platform capability sandbox/scoped SDK desired state | Incompatible degraded; malicious FS/net/SQL/secret attempts denied, grant revoke | §15.1 |
| REQ-MCP-01 | P2 | MCP/Bridge | Project-scoped resources/tools/tokens, context capsules/progress export | Assigned project only, revoke TTL, manifest preview/redact; no private context | §15.2 |
| REQ-SYNC-01 | P1 | Sync | Atomic local save/outbox/idempotent ingest/conflicts/tombstones/Handoff | Kill/restart/offline/two devices duplicate conflict tests; synced only after ack | §16.1, §19.4 |
| REQ-HIST-01 | P1 | History | Events/snapshots/revisions/diff/restore, audit separated replay/undo | Restore creates revision; later edits kept; external action compensation explicit | §16.2 |
| REQ-INT-01 | P2 | Integrations | Writer/Search/Hermes/Telegram/Kwork/VPN/Vault/native apps preserved/adapted | Compatibility fixture each adapter; credential/token scoped/revocable; no unknown resend | §18 |
| REQ-SHADE-01 | P3 | Shade | Independent authorized local smart home bridge | HA action allowlist/mock/approval/unknown delivery; Shade Zero-Cloud unchanged | §18 |
| REQ-IMPORT-01 | P2 | Import | Memos/Vikunja/notes/CSV/manual/YouTube permitted capture/Paper Capture | Source mapping/dedupe preview/roundtrip; no invented school/bank/watch history API | §18 |
| NFR-DATA-01 | P0 | Data | Backups/export/retention/recovery/migration reversibility | Fresh consistent off-host backup, integrity/FK/blob hashes and disposable restore | §16, §19 |
| NFR-PERF-01 | P0 | Performance | Pi resource budget, bounded worker, responsive pen/media/large objects | Measured RSS/latency/frame/queue, crash recovery under pressure; hardware POC target | §19.6 |
| NFR-SEC-01 | P0 | Security | TLS/secrets/least privilege/injection/privacy/consent/explicit approval | negative ACL across all API/jobs/plugins/indices; logs sanitized; private vault excluded | §19.5, §25 |
| NFR-A11Y-01 | P1 | UX | Keyboard/contrast/tap targets/zoom/reduced motion/adaptive UI | Viewport+keyboard+zoom checks and user acceptance of common actions | §4, §19.6 |
| NFR-ENG-01 | P0 | Engineering | Risk-based tests/CI/harness/task-state/evidence/commits/handoff | fail blocks done; deps/approval verified; source-only fixtures; push not deploy | §21–23, §27 |
| NFR-LEGAL-01 | P3 | Release | Future open source/licensing/dependency registry/DCO/security/contribution | Primary license audit with sources; no restricted code copied; owner chooses license | §24, §26 |

## Полные 48 идеи

Отдельная source idea != ready implementation task. Перед coding каждую capability дробить по [task schema](../plan/tasks.json) с конкретными fixture/командами и security/data rollback. Acceptance ниже фиксирует наблюдаемую цель; алгоритм/UX уточняется POC, не hidden scope expansion.

| ID | Идея | Capability / acceptance outcome | Source line |
|---|---|---|---|
| IDEA-01 | Life Evolution | интерактивная карта личного развития с доказательствами изменений. Демонстрация по разрешённым источникам; результат редактируем/отзываем и отражён в истории соответствующего модуля. | QUBITE_MASTER_CONTEXT.md:485 |
| IDEA-02 | Time Machine | переход в выбранную дату/период, заметки, фото, проекты, мысли тогда и сейчас. Демонстрация по разрешённым источникам; результат редактируем/отзываем и отражён в истории соответствующего модуля. | QUBITE_MASTER_CONTEXT.md:486 |
| IDEA-03 | Memory Map | карта воспоминаний по фотографиям, местам, событиям и людям с разрешением. Демонстрация по разрешённым источникам; результат редактируем/отзываем и отражён в истории соответствующего модуля. | QUBITE_MASTER_CONTEXT.md:487 |
| IDEA-04 | Letters to Future Me | письма будущему себе и отложенное открытие. Демонстрация по разрешённым источникам; результат редактируем/отзываем и отражён в истории соответствующего модуля. | QUBITE_MASTER_CONTEXT.md:488 |
| IDEA-05 | Life Chapters | «главы жизни», тематические альбомы. Демонстрация по разрешённым источникам; результат редактируем/отзываем и отражён в истории соответствующего модуля. | QUBITE_MASTER_CONTEXT.md:489 |
| IDEA-06 | Thought Evolution | история изменения взглядов, аргументы и причинные связи. Демонстрация по разрешённым источникам; результат редактируем/отзываем и отражён в истории соответствующего модуля. | QUBITE_MASTER_CONTEXT.md:490 |
| IDEA-07 | Personal Milestones | реальные достижения, без надуманной геймификации. Демонстрация по разрешённым источникам; результат редактируем/отзываем и отражён в истории соответствующего модуля. | QUBITE_MASTER_CONTEXT.md:491 |
| IDEA-08 | Reflection Companion | личный поддерживающий дневник/собеседник, приватно. Демонстрация по разрешённым источникам; результат редактируем/отзываем и отражён в истории соответствующего модуля. | QUBITE_MASTER_CONTEXT.md:492 |
| IDEA-09 | Skill Tree | дерево подтверждённых навыков, зависимости тем. Демонстрация по разрешённым источникам; результат редактируем/отзываем и отражён в истории соответствующего модуля. | QUBITE_MASTER_CONTEXT.md:495 |
| IDEA-10 | Mistake Library | библиотека ошибок и персональные упражнения. Демонстрация по разрешённым источникам; результат редактируем/отзываем и отражён в истории соответствующего модуля. | QUBITE_MASTER_CONTEXT.md:496 |
| IDEA-11 | Exam Simulator | симулятор тестов, контрольных, олимпиад с таймером. Демонстрация по разрешённым источникам; результат редактируем/отзываем и отражён в истории соответствующего модуля. | QUBITE_MASTER_CONTEXT.md:497 |
| IDEA-12 | AI Oral Exam | голосовой устный экзамен с уточнениями. Демонстрация по разрешённым источникам; результат редактируем/отзываем и отражён в истории соответствующего модуля. | QUBITE_MASTER_CONTEXT.md:498 |
| IDEA-13 | Learning Radar | активные, забываемые и требующие повторения темы. Демонстрация по разрешённым источникам; результат редактируем/отзываем и отражён в истории соответствующего модуля. | QUBITE_MASTER_CONTEXT.md:499 |
| IDEA-14 | Explain It Differently | одно содержание разными способами объяснения. Демонстрация по разрешённым источникам; результат редактируем/отзываем и отражён в истории соответствующего модуля. | QUBITE_MASTER_CONTEXT.md:500 |
| IDEA-15 | Knowledge Gaps | поиск недостающих предварительных знаний. Демонстрация по разрешённым источникам; результат редактируем/отзываем и отражён в истории соответствующего модуля. | QUBITE_MASTER_CONTEXT.md:501 |
| IDEA-16 | Source Reliability | достоверность и источники AI-утверждений. Демонстрация по разрешённым источникам; результат редактируем/отзываем и отражён в истории соответствующего модуля. | QUBITE_MASTER_CONTEXT.md:502 |
| IDEA-17 | Project Autopilot | план проекта из короткого описания. Демонстрация по разрешённым источникам; результат редактируем/отзываем и отражён в истории соответствующего модуля. | QUBITE_MASTER_CONTEXT.md:505 |
| IDEA-18 | Smart Scheduling | расписание на основе сроков и свободного времени. Демонстрация по разрешённым источникам; результат редактируем/отзываем и отражён в истории соответствующего модуля. | QUBITE_MASTER_CONTEXT.md:506 |
| IDEA-19 | Time Estimation Learning | улучшение оценок длительности задач. Демонстрация по разрешённым источникам; результат редактируем/отзываем и отражён в истории соответствующего модуля. | QUBITE_MASTER_CONTEXT.md:507 |
| IDEA-20 | Task Starter | открыть весь контекст и Focus одной кнопкой. Демонстрация по разрешённым источникам; результат редактируем/отзываем и отражён в истории соответствующего модуля. | QUBITE_MASTER_CONTEXT.md:508 |
| IDEA-21 | Decision Journal | почему приняты решения и их последующие результаты. Демонстрация по разрешённым источникам; результат редактируем/отзываем и отражён в истории соответствующего модуля. | QUBITE_MASTER_CONTEXT.md:509 |
| IDEA-22 | Project Dependencies | зависимости задач и планирование влияния сдвига сроков. Демонстрация по разрешённым источникам; результат редактируем/отзываем и отражён в истории соответствующего модуля. | QUBITE_MASTER_CONTEXT.md:510 |
| IDEA-23 | Progress Digest | дневной/недельный отчёт о результатах. Демонстрация по разрешённым источникам; результат редактируем/отзываем и отражён в истории соответствующего модуля. | QUBITE_MASTER_CONTEXT.md:511 |
| IDEA-24 | Smart Priorities | объяснимые рекомендации текущей задачи. Демонстрация по разрешённым источникам; результат редактируем/отзываем и отражён в истории соответствующего модуля. | QUBITE_MASTER_CONTEXT.md:512 |
| IDEA-25 | Universal Canvas | смешанный холст текста, рукописи, медиа, задач, схем. Демонстрация по разрешённым источникам; результат редактируем/отзываем и отражён в истории соответствующего модуля. | QUBITE_MASTER_CONTEXT.md:515 |
| IDEA-26 | Smart Sketch | набросок интерфейса превращается в редактируемые компоненты/React (после подтверждения). Демонстрация по разрешённым источникам; результат редактируем/отзываем и отражён в истории соответствующего модуля. | QUBITE_MASTER_CONTEXT.md:516 |
| IDEA-27 | Handwriting Styles | несколько личных стилей почерка и обучение исправлениями. Демонстрация по разрешённым источникам; результат редактируем/отзываем и отражён в истории соответствующего модуля. | QUBITE_MASTER_CONTEXT.md:517 |
| IDEA-28 | Document Transform | документ → презентация, карточки, инфографика, шпаргалка, аудио и др. Демонстрация по разрешённым источникам; результат редактируем/отзываем и отражён в истории соответствующего модуля. | QUBITE_MASTER_CONTEXT.md:518 |
| IDEA-29 | Storyboard | раскадровка и анимационные идеи. Демонстрация по разрешённым источникам; результат редактируем/отзываем и отражён в истории соответствующего модуля. | QUBITE_MASTER_CONTEXT.md:519 |
| IDEA-30 | Visual Math Lab | интерактивные формулы и графики. Демонстрация по разрешённым источникам; результат редактируем/отзываем и отражён в истории соответствующего модуля. | QUBITE_MASTER_CONTEXT.md:520 |
| IDEA-31 | Reusable Elements | библиотека рукописных/графических элементов. Демонстрация по разрешённым источникам; результат редактируем/отзываем и отражён в истории соответствующего модуля. | QUBITE_MASTER_CONTEXT.md:521 |
| IDEA-32 | Print Studio | A4, миникарточки, длинные полосы для термопринтера. Демонстрация по разрешённым источникам; результат редактируем/отзываем и отражён в истории соответствующего модуля. | QUBITE_MASTER_CONTEXT.md:522 |
| IDEA-33 | Spatial Comments | комментарий к точной области, блоку, объекту. Демонстрация по разрешённым источникам; результат редактируем/отзываем и отражён в истории соответствующего модуля. | QUBITE_MASTER_CONTEXT.md:525 |
| IDEA-34 | Team Decisions | голосования и опросы, AI-обобщение мнений. Демонстрация по разрешённым источникам; результат редактируем/отзываем и отражён в истории соответствующего модуля. | QUBITE_MASTER_CONTEXT.md:526 |
| IDEA-35 | Shared AI Sessions | общий AI + персональные невидимые дополнения. Демонстрация по разрешённым источникам; результат редактируем/отзываем и отражён в истории соответствующего модуля. | QUBITE_MASTER_CONTEXT.md:527 |
| IDEA-36 | Review Rooms | пространство проверки конспектов, дизайна, документа. Демонстрация по разрешённым источникам; результат редактируем/отзываем и отражён в истории соответствующего модуля. | QUBITE_MASTER_CONTEXT.md:528 |
| IDEA-37 | Team Replay | история изменений разных участников. Демонстрация по разрешённым источникам; результат редактируем/отзываем и отражён в истории соответствующего модуля. | QUBITE_MASTER_CONTEXT.md:529 |
| IDEA-38 | Guest Workspaces | гостевые роли со сроком и scope. Демонстрация по разрешённым источникам; результат редактируем/отзываем и отражён в истории соответствующего модуля. | QUBITE_MASTER_CONTEXT.md:530 |
| IDEA-39 | Automation Discovery | предложения AI автоматизировать повторяемые сценарии. Демонстрация по разрешённым источникам; результат редактируем/отзываем и отражён в истории соответствующего модуля. | QUBITE_MASTER_CONTEXT.md:533 |
| IDEA-40 | Workflow Simulator | dry-run автоматизаций на тестовых событиях. Демонстрация по разрешённым источникам; результат редактируем/отзываем и отражён в истории соответствующего модуля. | QUBITE_MASTER_CONTEXT.md:534 |
| IDEA-41 | AI Model Router | выбор модели по стоимости, качеству, приватности. Демонстрация по разрешённым источникам; результат редактируем/отзываем и отражён в истории соответствующего модуля. | QUBITE_MASTER_CONTEXT.md:535 |
| IDEA-42 | Plugin Studio | AI создаёт и тестирует расширения перед одобрением. Демонстрация по разрешённым источникам; результат редактируем/отзываем и отражён в истории соответствующего модуля. | QUBITE_MASTER_CONTEXT.md:536 |
| IDEA-43 | Personal API | API/MCP для внешних скриптов и агентов. Демонстрация по разрешённым источникам; результат редактируем/отзываем и отражён в истории соответствующего модуля. | QUBITE_MASTER_CONTEXT.md:537 |
| IDEA-44 | Smart Home Bridge | будущая интеграция Shade AI. Демонстрация по разрешённым источникам; результат редактируем/отзываем и отражён в истории соответствующего модуля. | QUBITE_MASTER_CONTEXT.md:538 |
| IDEA-45 | Integration Monitor | статус синхронизации внешних интеграций. Демонстрация по разрешённым источникам; результат редактируем/отзываем и отражён в истории соответствующего модуля. | QUBITE_MASTER_CONTEXT.md:539 |
| IDEA-46 | AI Cost Center | стоимость по моделям, сценариям, проектам, лимиты. Демонстрация по разрешённым источникам; результат редактируем/отзываем и отражён в истории соответствующего модуля. | QUBITE_MASTER_CONTEXT.md:540 |
| IDEA-47 | Notification Intelligence | сводка и приоритизация входящих сигналов. Демонстрация по разрешённым источникам; результат редактируем/отзываем и отражён в истории соответствующего модуля. | QUBITE_MASTER_CONTEXT.md:541 |
| IDEA-48 | Context Exporter | перенос контекста между Codex/Claude/Hermes/другими агентами. Демонстрация по разрешённым источникам; результат редактируем/отзываем и отражён в истории соответствующего модуля. | QUBITE_MASTER_CONTEXT.md:542 |

## Полнота и приоритет

Все подробные source clauses (включая непопавшие в 48 additions) имеют полную построчную трассировку в [SOURCE_TRACE](SOURCE_TRACE.md) с section/line и linked requirement family. Domain entities, blocks/media/ink gestures, diary privacy, thermal print, school/audio, budgets/plugin/MCP и legal/engineering constraints нельзя исключить краткой карточкой. Source trace не обещает first release всего раздела.

Для первых задач mapping: QUB-AUTH-* → REQ-CORE/OWNER/AI/NFR-SEC; DOC/SYNC/SEARCH/HISTORY → REQ-DOC/SYNC/SEARCH/HIST; INK-001 → REQ-INK/NFR-PERF; OPS → NFR-DATA/REQ-MIG; TEST → NFR-ENG. TASKS acceptance конкретизирует scope, а source остается неизменным baseline. При расхождении access policy и старых глобальных roles приоритет у policy. Coverage checker должен найти 48 IDEA IDs и каждый source section; final acceptance соответствующего требования требует test evidence + user/device где применимо.

Уточнение 12.10.2026: общий Auth/settings/support/analytics/observability/command backend на FastAPI/Postgres; optional tournament engine остаётся Node/SQLite. Telegram auto capture без выбора раздела + guest Support с отдельными staff grants + daily/critical notifications с app links. Это дополнение к source trace, оригинальные master/access документы не изменены.
