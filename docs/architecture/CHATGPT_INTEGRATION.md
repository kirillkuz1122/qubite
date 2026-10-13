# ChatGPT identity и личный AI план

**13.10.2026: запрос владельца сохранён в AUTH-016/AI-003, runtime отсутствует.** Sign in with ChatGPT и AI по личным лимитам пользователя; независимо владелец может выдать использование своей API. Это два независимых разрешения и источника расхода, не один login grant. Перед отдельными задачами снова задать вопросы.

## Проверено в официальных источниках

Локальные OAuth adapters Qubite имеют Google/Yandex/VK/Telegram, ChatGPT adapter нет. Затем прочитаны официальные документы OpenAI (проверка13.10.2026):

- [Website identity](https://developers.openai.com/siwc/website): Authorization Code/PKCE/OIDC, backend создаёт собственную сессию; website доступ пока limited trial для selected commercial partners, нужны зарегистрированный client/callback. Qubite клиент/допуск не получены.
- [Plan usage overview](https://developers.openai.com/siwc/token-sharing-open-source): отдельное разрешение для eligible запросов из OSS/local apps; remotely hosted/paid требуют interest process. Связь user/workspace/client и отдельный стабильный host ID нужно учитывать.
- [Официальный пример desktop](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt): eligible Plus/Pro, identity и plan-use consent раздельны; примеры защищают credentials в local main process. Сам вход не даёт согласия на расход плана.
- [Preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations): Responses stream:true/store:false, некоторые hosted tools и ASR не поддерживаются. Нельзя обещать, что подписка покроет весь Qubite AI.
- [Раздельный биллинг](https://help.openai.com/en/articles/9039756-managing-billing-for-chatgpt-and-the-api-platform): обычная API оплачивается отдельно от подписки; documented plan-use — специальный flow, не превращение подписки в произвольный API-key.

Ограничения могут измениться; проверить заново перед реализацией. Вывод для Qubite: desktop/local потенциально подходит документированному flow, общий hosted сайт и Android **ещё требуют отдельного подтверждения eligibility/transport**. Это вывод из источников, не проверка реального аккаунта/устройства. Не подменять официальный client чужим Codex client/token или browser session.

## Контракт будущего среза

AUTH-016: client matrix/eligibility, approved provider identity, issuer/client/sub + state/nonce/PKCE, revocation/refresh и защищённое хранение. Identity не email matching; существующий UUID связывается явно. Новая registration через provider должна явно пройти режим/invite/consents/подтверждение по согласованной policy, не создавать owner/grants через случайный callback. Детальный standalone signup/password/recovery UX обсуждается в этой задаче; текущий AUTH-006 — email/password.

AI-003: личный ChatGPT источник с отдельным согласованным scope и eligible model capability; owner-funded источник — только ручной provider/model/action grant и собственный atomic budget AI-001/002. Оба могут быть разрешены одному человеку. Resource ACL/изоляция проверяются независимо даже при собственном плане. Перед AI-003 уточнить, должен ли eligible личный план сразу открывать отдельный базовый чат или AI только внутри вручную разрешённых модулей; желание владельца — личный AI по его квотам, без обязательного owner API гранта.

Показать выбранный источник, доступность и реальные ограничения. При исчерпании/неизвестной квоте/revoke личного плана остановить запрос и предложить явный выбор разрешённой owner API; никаких молчаливых fallback или списаний владельцу. Credential/profile/user/workspace/host isolation, переключение профиля/выход не смешивают чужие квоты. Реальные provider tokens/тексты не попадут в Git/audit/export.

Acceptance: fixtures для identity и funding gates, failure/revoke/expiry/account-switch/concurrency; затем отдельная реальная приёмка каждого клиента и consent. Документ и backlog не разрешают включить provider, отправить запрос или регистрировать внешний клиент в этом cycle.
