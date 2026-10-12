# Telegram quick capture и единые уведомления

CONFIRMED владельцем 12.10.2026: отправка обычного текста или голосового в чат без предварительного выбора раздела; AI самостоятельно понимает назначение/оформление, сохраняет и связывает материал. Существующий bot, общие аккаунты/grants, агрегированная analytics, guest Support, daily digest и event deep links.

## Capture contract

1. Проверить Telegram user → active linked platform subject; reauthorize grants. Unlinked visitor → Support. У linked пользователя обычный text/voice → capture; support replies и owner force-reply commands имеют точный message binding/TTL, режим «Поддержка» явный. Не перехватывать admin бюджетный ввод как note.
2. Сначала durable CaptureItem + source reference + private original + received UTC + Telegram update/message id и idempotency fingerprint. ACK «Сохранено» только после commit, «обработано» после actual outcome. Текст сохраняется сразу; voice — после защищённого attachment persist, не только после записи remote file_id. Crash/download failure показывает pending/error, не ложное сохранение.
3. Job STT (для voice) и classify/format получает только необходимый scoped context. Использовать existing voice/Hermes service через ограниченный adapter, без второго Telethon polling/копирования session/самостоятельной загрузки моделей. ASR ошибки сохраняют original, можно явно retry.
4. Model output — validated typed decision: kind, content/AST, permitted target refs, confidence, source/provenance, proposed schedule. Не свободный SQL/HTML/tool program. Email/страницы/голосовой текст не меняют системные capabilities. ACL/grants/allowlist/cost reserve проверяются на каждый job/tool, запрет до provider calls.
5. Для разрешённых новых личных note/task разрешён automatic routing/formatting: idempotent create и resource link. Для явно указанной даты/времени персонального reminder — отдельный tested schedule flow с timezone/undo; если неоднозначно, сохранить черновик в Inbox и показать вопрос/предложение без обязательного выбора до сохранения. Нет уверенности/модуля/модели/бюджета — raw item в доступном capture Inbox без платного вызова. Не выдавать Docs grant автоматически.
6. Ответ короткий: что и куда записано, deep link, кнопки «Исправить»/«Отменить». Исходник и structured revision с provenance сохраняются; undo удаляет/помечает только созданные этим capture сущности, не последующие edits. Повтор update не дублирует note/task/reminder или оплату.

Auto capture не разрешает агенту без review изменять существующий большой документ, публично делиться, отправлять сообщения другим людям, тратить вне выданного бюджета, выдавать grants или удалять данные. Нет выбора категории на входе, но реальный конфликт/внешнее действие получает конкретное подтверждение. Этот предел согласуется с original master/access rules.

Пример: «Идея для проекта: добавить…» → личная заметка/связь с доступным проектом, без меню. «Сделать… завтра» → task, uncertain time не превращается в guessed alarm. Голосовое → исходное audio + transcript + formatted note/task; показывать статус ASR, исправления и ссылку.

## Unified notification contract

Notification event: id, actor/recipient subject, module/resource/action, severity, occurred UTC, dedupe_key, payload schema, delivery state, channel preferences, read/dismiss status. Раздельные in-app/read и Telegram delivery status; открытие Telegram-ссылки не означает автоматическое чтение/закрытие всех уведомлений. Linked account grants проверяются перед send и при переходе. Sensitive contents по каналам минимизируются.

Outbox атомарен с domain event; отдельный worker делает доставку и фиксирует результат. Unknown send → unknown/pause, не blind retry. Critical signals не фильтруются AI; daily digest предпочтительно deterministic aggregates, не обязательный платный LLM вызов. Timezone/schedule configurable, digest id уникален recipient+period+kind; missed schedule/restart/revoke не создают дубли. Предложенный default timezone Asia/Yekaterinburg, время пользователь настроит до включения расписания; это не разрешение отправлять сейчас.

Переходы: stable app route/resource locator + web fallback; desktop/Android deep-link handler whitelists scheme/path/action и требует login/reauth. Никаких bearer tokens/owner bypass в URL. Wrong/revoked target показывает доступное denied/missing состояние без private title/snippet. Critical infra alerts owner-only; Support messages только assigned staff/user; tournament events только granted scoped recipients.

Acceptance: durable ingest/restart/duplicate/text/voice/STT fail/cost deny/cross-account/parser injection/low confidence/undo concurrent edit; exact reply vs capture vs guest support; daily UTC/DST/restart/dedup/revoke/unknown-send; website/desktop/Android routing with auth. Только synthetic data/mocked send/provider в local CI. Реальные voice/device/sends — отдельный integration acceptance.
