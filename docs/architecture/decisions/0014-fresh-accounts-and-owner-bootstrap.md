# ADR-0014 — fresh accounts и локальный singleton owner

13.10.2026. Engineering decisions в явно разрешённой AUTH-002: владелец поручил следующую задачу после AUTH-008; approved dependencies done. [ADR-0013](0013-fresh-identity-and-unified-login.md) и product access policy сохраняются.

- Явная0002_identity после неизменной0001: UUID subjects, original/canonical email, pending/active/blocked, optional name, verification/version/timestamps; без старых roles/passwords/sessions/aliases/grants.
- Owner row singleton CHECK=1 + composite FK к active subject. Дополнительный UNIQUE(id,status) выбран вместо cross-table CHECK (не гарантирует cross-row invariant) или trigger; UPDATE/DELETE RESTRICT не позволяет случайно деактивировать owner. Привилегированное переназначение/recovery отдельной задачей.
- Explicit local CLI + transaction advisory lock, общий с migration writer, проверка current schema в той же transaction. Повтор/refused/collision не upsert и не усыновление account. Coarse lock для маленького storage slice; последующие Auth writes/нагрузка измеряются отдельно, не обещаем высокую concurrency сейчас.
- Email casefold local/IDNA2008 nontransitional domain, no dot/plus folding, canonical COLLATE C exact unique. idna уже pinned, прямое использование указано в requirements.in. Не полная RFC grammar/deliverability verification.
- No passwords/login/HTTP public registration/bootstrap в этой задаче; owner email не считается verified. AI self grants/budgets остаются обязательными. No real DB role provisioning/owner account/деплой; только реализация и synthetic disposable checks.

Альтернативы: first signup owner отвергнуто из-за захвата; legacy import/bridge отменён пользователем; SQL trigger сложнее restore/test и здесь не нужен; case-insensitive citext не заменяет выбранное Unicode casefold/IDNA правило. Down/delete и повторный bootstrap с overwrite исключены. Readiness дополнительно проверяет наличие двух таблиц, не полный semantic schema fingerprint.

[Схема/CLI/rollback](../IDENTITY_SCHEMA.md), [отчёт](../../reports/QUB-AUTH-002.md). Следующая AUTH-009 реализует password/session API, AUTH-003 policy зависит от неё.
