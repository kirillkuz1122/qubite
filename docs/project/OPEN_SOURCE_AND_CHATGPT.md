# Открыть Qubite и подключить «Sign in with ChatGPT»

Инструкция для владельца, шаг за шагом. Что нашлось в истории репозитория — отчёт в [STATUS](STATUS.md) («Перед публикацией репозитория»). Решение — [D-215](../product/DECISIONS.md).

## 0. Коротко

- **Публичным репозиторий делаешь ты сам**, агент этого не делает. Сначала — чистка истории (шаг 1). Без неё публиковать нельзя: в текущем `main` лежат твоё полное ФИО, класс, лицей, город и ФИО руководителя (школьная проектная работа в `legacy/`).
- **У «Sign in with ChatGPT» два разных режима**, и это важно:

  | | Модели по подписке ChatGPT в open-source приложении | Кнопка «Войти через ChatGPT» на сайте |
  |---|---|---|
  | Что даёт | AI-запросы за счёт **своей** подписки Plus/Pro, без ключа API | Только вход: имя, почта, ID. Модели не даёт |
  | Кому доступно | Открытым (open-source) и локально запущенным приложениям — без заявки | Только избранным коммерческим партнёрам, через лист ожидания |
  | Регистрация | **Не нужна**: приложение регистрируется само при первом входе | Форма интереса, потом OpenAI выдаёт `client_id` (`oaiapp_…`) |
  | Адрес возврата | Только `http://127.0.0.1:<порт>/auth/callback` (на твоём компьютере) | Точный адрес сайта, например `https://qubiteapp.ru/…` |
  | Для кого в Qubite | **Ты сам** на своём сервере и в своём desktop-приложении | Все пользователи qubiteapp.ru |

- То есть публичный репозиторий открывает **первый** режим: ты сможешь пользоваться AI в Qubite по своей подписке ChatGPT. Дать то же другим пользователям своего сервера по их подпискам — это уже второй режим (партнёрский), он сейчас закрыт.
- Это меняет вывод [D-214](../product/DECISIONS.md) («ChatGPT по подписке — не делаем»): у OpenAI появился **официальный** путь для open-source, без подделки под Codex. Сам провайдер `chatgpt` в коде ещё не сделан — это задача сессии AI (вопрос Q-33).

## 1. Перед публикацией: почистить историю

GitHub показывает **всю** историю, а не только последние файлы. Удалить файл новым коммитом мало.

1. **Отозвать то, что утекло** (до чистки — копии могли остаться у кого угодно, пока репозиторий был публичным до 17.10):
   - `VPN_APP_TOKEN` старого VPN — выпустить новый, старый выключить (сейчас VPN не работает, но токен настоящий);
   - `maintenance_token` старого Qubite на Pi — сменить (в истории есть пример из `test_bypass.js`; скорее всего не настоящий, но проверить дёшево). Pi трогаешь ты сам.
2. **Сделать копию** репозитория на всякий случай:
   ```bash
   git clone --mirror git@github.com:kirillkuz1122/qubite.git qubite-backup.git
   ```
3. **Поставить git-filter-repo** (`pipx install git-filter-repo` или пакет системы) и в **свежем** клоне выполнить:
   ```bash
   git clone --mirror git@github.com:kirillkuz1122/qubite.git qubite-clean.git
   cd qubite-clean.git
   # школьная работа (ФИО, класс, лицей, руководитель), собранные VPN-пакеты с токеном,
   # личные переписки и автоматизация Telegram/Kwork
   git filter-repo --invert-paths \
     --path legacy/qubite-v1/docs/explanatory-note-typst --path docs/explanatory-note-typst \
     --path legacy/qubite-v1/app/qubite_vpn/installer --path app/qubite_vpn/installer \
     --path legacy/qubite-vpn/installer \
     --path legacy/qubite-v1/app/qubite_vpn/core_build --path app/qubite_vpn/core_build \
     --path legacy/qubite-vpn/core_build --path app/qubite_vpn/qubite-vpn.exe \
     --path 'app/qubite_vpn/qubite-vpn.exe~' \
     --path legacy/qubite-v1/docs/kwork-negotiations.md --path docs/kwork-negotiations.md \
     --path legacy/qubite-v1/docs/telegram-leads.md --path docs/telegram-leads.md \
     --path docs/context/codex-session-2026-10-12.md \
     --path test_bypass.js
   # токен VPN в тексте старых версий BUILD.md — заменить заглушкой
   printf 'regex:VPN_APP_TOKEN=[0-9a-f]{64}==>VPN_APP_TOKEN=<убрано>\n' > ../replace.txt
   git filter-repo --replace-text ../replace.txt
   # почта автора: личную gmail заменить на адрес GitHub без почты
   # вместо <ЛИЧНАЯ_ПОЧТА> — твоя gmail из `git log --format='%ae' | sort -u`
   printf 'kirillkuz1122 <96770557+kirillkuz1122@users.noreply.github.com> <ЛИЧНАЯ_ПОЧТА>\n' > ../mailmap.txt
   git filter-repo --mailmap ../mailmap.txt
   ```
   Список путей — по отчёту в STATUS; перед запуском пробеги его глазами и добавь, если что-то ещё не хочешь показывать (например, фамилию в `docs/project/LAST_HANDOFF.md` и других старых отчётах — их можно убрать тем же `--replace-text`).
4. **Проверить результат**: в `qubite-clean.git` снова запустить поиск секретов по всей истории и убедиться, что ФИО больше нет:
   ```bash
   docker run --rm -v "$PWD:/repo" -w /repo zricethezav/gitleaks:v8.30.1 git --no-banner --redact --log-opts="--all" .
   git log --all -p | grep -c 'лицей-интернат'   # должно быть 0; проверь так же свою фамилию
   ```
5. **Отправить** очищенную историю (перезапишет GitHub; все старые клоны и worktree после этого надо клонировать заново):
   ```bash
   git push --force --mirror git@github.com:kirillkuz1122/qubite.git
   ```
6. Лишние ветки на GitHub (`codex`, `ds-001-experiment-1`, `friend-changes`, `frontend-demo`) лучше удалить или оставить сознательно: в `friend-changes` есть коммиты и почта другого человека — спроси его. Ветку `tournaments` и тег `qubite-v1.0` не трогай: по ним работает Pi.
7. Если репозиторий раньше был публичным — GitHub мог закэшировать старые коммиты. После чистки можно попросить поддержку GitHub удалить кэш («Remove sensitive data»).

## 2. Сделать репозиторий публичным

1. **Почта:** https://github.com/settings/emails → включить «Keep my email addresses private» и «Block command line pushes that expose my email». Локально: `git config --global user.email 96770557+kirillkuz1122@users.noreply.github.com`.
2. **Лицензия:** ответь на Q-34 в STATUS (AGPL-3.0 или MIT) — агент добавит файл `LICENSE`. Без лицензии код формально «все права защищены» — для open-source партнёров OpenAI лучше с лицензией.
3. **Защита:** в репозитории → Settings → Code security → включить **Secret scanning** и **Push protection** (для публичных бесплатно). Settings → Actions → General → «Fork pull request workflows from outside collaborators» → «Require approval for all outside collaborators».
4. **Опубликовать:** Settings → General → внизу «Danger Zone» → **Change repository visibility** → **Make public** → подтвердить названием репозитория.
5. Проверить, что CI зелёный и в README нет ничего личного.

## 3. ChatGPT: модели по подписке (open-source режим)

> **Готово (AI-005, [D-219](../product/DECISIONS.md)).** Провайдер `chatgpt` в коде, выключен по умолчанию. Проверен на подставном сервере OpenAI; настоящий вход делаешь ты.

Регистрировать ничего не нужно:

1. Ключ шифрования токенов: `qubite ai secret-key` → строку `QUBITE_AI_SECRET_KEY=…` положи в `.env` (права `600`). Потеряешь ключ — просто войдёшь заново.
2. Вход: `qubite ai chatgpt login`. Qubite печатает адрес и открывает браузер на `auth.openai.com`; ты входишь в ChatGPT (Plus или Pro) и разрешаешь доступ. Qubite регистрирует себя сам (`client_id=dynamic_agent_client`, имя «Qubite»), OpenAI выдаёт постоянный `client_id` вида `oaiapp_…` — он и ID этой установки (`ext_agent_host_id`) запоминаются и переиспользуются.
3. Браузер возвращается на `http://127.0.0.1:1455/auth/callback` — это сам Qubite (именно `127.0.0.1`, не `localhost`; другой порт — `--port`).
4. Токены лежат **в базе Qubite, зашифрованными** этим ключом (без ключа их не прочитать). Access-токен живёт час и обновляется сам заранее; refresh одноразовый и меняется при каждом обновлении.
5. **Сервер** (VPS или Pi) без браузера: открой туннель со своего компьютера `ssh -L 1455:127.0.0.1:1455 сервер`, на сервере запусти `qubite ai chatgpt login --no-browser`, адрес открой у себя — браузер вернётся через туннель прямо на сервер. Переносить файлы не нужно.
6. Включить: `QUBITE_AI_CHATGPT_ENABLED=true` и перезапуск сервера. Модели подписки появятся в `qubite ai catalog` как `chatgpt:<модель>`; включить нужную — `qubite ai model chatgpt:<модель> on`, сделать основной — `qubite ai use chatgpt:<модель>` (или `--task inbox.triage`).
7. Запросы идут на официальный `https://api.openai.com/v1/responses` и тратят лимиты **твоей** подписки. Денег Qubite не считает (0 $), а **число запросов** ограничивает как обычно: защита от зацикливания и, если хочешь, лимит, например `qubite ai limit --scope model:chatgpt:<модель> --period day --metric requests --value 200`. Режим «owner без личного лимита» требует дневной потолок платформы в $ (D-212) — задай любой, хоть `1`.

Ограничения: только для **твоих** запросов (запрос другого пользователя Qubite получает отказ до отправки); нет генерации картинок, распознавания речи и файлового поиска; нельзя ограничить длину ответа. Когда лимиты подписки кончились — понятная ошибка «лимит подписки ChatGPT исчерпан», и Qubite 15 минут не шлёт новые запросы к ChatGPT. Состояние — `qubite ai chatgpt status`; выйти — `qubite ai chatgpt logout` (токен отзывается у OpenAI и стирается). OpenAI пишет, что отзыв доступа для сессий на сервере пока не всегда доходит — тогда отключи Qubite в ChatGPT → Настройки.

## 4. ChatGPT: кнопка входа на сайте (партнёрский режим)

Сейчас — только для избранных коммерческих партнёров OpenAI.

1. Заполнить форму интереса: https://openai.com/form/sign-in-with-chatgpt-interest/ (описать Qubite, приложить ссылку на публичный репозиторий).
2. Если одобрят — OpenAI выдаст `client_id` (`oaiapp_…`) и, для серверного клиента, секрет. Адреса возврата нужно указать **точно**, для каждого окружения:
   - `https://qubiteapp.ru/api/auth/oauth/chatgpt/callback`
   - `https://qubiteapp.online/api/auth/oauth/chatgpt/callback` (если второй домен тоже будет принимать вход)
   - для разработки — `http://localhost:8080/api/auth/oauth/chatgpt/callback`, если OpenAI разрешит `http` (в документации не сказано; если нет — тестируем на mock-провайдере, как Яндекс и VK).

   Формат адреса тот же, что у Яндекса, VK и Google: `$QUBITE_PUBLIC_URL/api/auth/oauth/<провайдер>/callback`.
3. Вход через ChatGPT даёт только имя и почту — модели по подпискам других людей он не открывает.

## 5. Что вписать в `.env`

Источник правды — [`.env.example`](../../.env.example).

```bash
# Модели по подписке ChatGPT (раздел 3) — только для owner
QUBITE_AI_CHATGPT_ENABLED=false
QUBITE_AI_SECRET_KEY=                      # qubite ai secret-key; права файла 600

# Кнопка «Войти через ChatGPT» (раздел 4) — только если OpenAI одобрит
QUBITE_OAUTH_CHATGPT_CLIENT_ID=            # oaiapp_…
QUBITE_OAUTH_CHATGPT_CLIENT_SECRET=        # если выдадут; хранить только в .env с правами 600
QUBITE_OAUTH_CHATGPT_ENABLED=false
QUBITE_AUTH_CHATGPT_ENABLED=true           # аварийный выключатель, как у других способов входа
```

Ключи и токены вписываешь сам; агенты их не видят и в git не кладут.

## Источники

- [Quickstart](https://developers.openai.com/siwc/quickstart), [Request a client ID](https://developers.openai.com/siwc/request-client-id), [Sign-in on your website](https://developers.openai.com/siwc/website)
- Open-source: [обзор](https://developers.openai.com/siwc/token-sharing-open-source), [вход](https://developers.openai.com/siwc/token-sharing-open-source/sign-in), [модели](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference), [self-hosted VM](https://developers.openai.com/siwc/token-sharing-open-source/self-hosted-vms), [ограничения](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)

Проверено 19.10.2026; программа в бета-версии, условия могут меняться.
