# ADR-0025 — Серверный каталог и общая видимость

Статус: CONFIRMED14.10.2026 по ответам владельца перед UI-003. [Контракт](../MODULE_CATALOG.md), [отчёт](../../reports/QUB-UI-003.md). Не разрешает следующий task.

1. Без read-доступа по умолчанию карточка с замком; владелец вручную выбирает hidden. Настройка одна на модуль для всех пользователей без доступа, без персональных исключений.
2. С действующим read grant карточка видна независимо от hidden. Не установленный/не подготовленный модуль — «Готовится», установленный и выключенный — «Временно недоступен». Ни видимость, ни owner role не выдают grants/данные/AI.
3. Presentation catalog отдельно от existing /me/access: последний возвращает права только installed/enabled, а upcoming карточка учитывает исходный действующий read entitlement. Existing resource/workspace/action gate не изменяется.
4. Curated восемь модулей утверждённой shell: Docs/Projects/Planner/Search/Writing/VPN/Vault/Atlas. Projects/Atlas получают собственные новые policy IDs, Knowledge не переименовывается/не импортируется. Остальные исторические policy IDs сохраняются, Tournaments не добавляется в новый продуктовый каталог/SSO.
5. Additive0008_catalog, core0.7.0; поля presentation/default locked/released=false. Нет автоматической установки, grants, startup DDL или изменения existing identity. Release/installed metadata только future trusted registrar, не публичная owner команда.
6. Сохранение visibility — существующая PolicyCommand catalog_visibility: current owner, CSRF, own-password reauth, If-Match/idempotency, exclusive policy lock/global revision/atomic audit. Owner ordinary home; live настройки только settings/owner, выбранные Flux controls. Save явный для одной строки, draft отмечен «Не сохранено», errors не объявляют успех.
7. User GET catalog/detail server-filtered; hidden без read и unknown возвращают один generic404. Нет payload/counts/private objects/URL service из каталога. При route/focus/online/visibility/expiry/periodic recheck старые data очищаются, поздние responses отменяются. Live bundle не содержит demo catalog titles/descriptions; cosmetic storage не authority.
8. Native/services/полная Console/users/grants/budgets/installer/subdomains/production отдельно. После UI-003 primary track AI-001 → AI-002 → AUTH-004, каждый с новыми вопросами и approval. UI-003 не включает paid requests или настройку SMTP/providers.
