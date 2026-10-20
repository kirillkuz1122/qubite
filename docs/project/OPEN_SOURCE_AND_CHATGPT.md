# Открыть Qubite и подключить «Sign in with ChatGPT»

Инструкция для владельца, шаг за шагом. Что нашлось в истории репозитория — отчёт в [STATUS](STATUS.md) («Перед публикацией репозитория»). Решение — [D-215](../product/DECISIONS.md).

## 0. Коротко

- **Публичным репозиторий делаешь ты сам**, агент этого не делает. Порядок: отозвать токен VPN → почистить историю (шаг 1) → настройки и публикация (шаг 2). Без чистки публиковать нельзя: в текущем `main` лежат твоё полное ФИО, класс, лицей, город и ФИО руководителя (школьная проектная работа в `legacy/`).
- **У «Sign in with ChatGPT» два разных режима**, и это важно:

  | | Модели по подписке ChatGPT в open-source приложении | Кнопка «Войти через ChatGPT» на сайте |
  |---|---|---|
  | Что даёт | AI-запросы за счёт **своей** подписки Plus/Pro, без ключа API | Только вход: имя, почта, ID. Модели не даёт |
  | Кому доступно | Открытым (open-source) и локально запущенным приложениям — без заявки | Только избранным коммерческим партнёрам, через лист ожидания |
  | Регистрация | **Не нужна**: приложение регистрируется само при первом входе | Форма интереса, потом OpenAI выдаёт `client_id` (`oaiapp_…`) |
  | Адрес возврата | Только `http://127.0.0.1:<порт>/auth/callback` (на твоём компьютере) | Точный адрес сайта, например `https://qubiteapp.ru/…` |
  | Для кого в Qubite | **Ты сам** на своём сервере и в своём desktop-приложении | Все пользователи qubiteapp.ru |

- То есть публичный репозиторий открывает **первый** режим: ты сможешь пользоваться AI в Qubite по своей подписке ChatGPT. Дать то же другим пользователям своего сервера по их подпискам — это уже второй режим (партнёрский), он сейчас закрыт.
- Это меняет вывод [D-214](../product/DECISIONS.md) («ChatGPT по подписке — не делаем»): у OpenAI появился **официальный** путь для open-source, без подделки под Codex. Провайдер `chatgpt` уже сделан (AI-005, раздел 3).

## 1. Перед публикацией: почистить историю

Твой выбор (Q-35, [D-265](../product/DECISIONS.md)): из истории убираем **только** школьную проектную работу и VPN-пакеты с токеном, остальное остаётся. Команды запускаешь **сам**, когда все сессии агентов остановлены (чистка переписывает все коммиты — их ветки и worktree после этого придётся пересоздать).

GitHub показывает **всю** историю, а не только последние файлы, поэтому удалить файл новым коммитом мало.

### 1.1. Сначала — отозвать токен VPN (обязательно, до публикации)

`VPN_APP_TOKEN` старого VPN настоящий. Чистка его из истории **не спасает**: он остаётся в тексте старых версий `app/qubite_vpn/installer/windows/BUILD.md` (их ты решил не трогать), а до 17.10.2026 репозиторий уже был публичным — копии могли сохраниться у кого угодно. Поэтому: выпусти **новый** токен, старый выключи на сервере VPN. Пока VPN не работает — просто считай старый токен сгоревшим и не используй его снова.

### 1.2. Что именно удаляется

Проверено по всем веткам, тегам и всей истории (19.10.2026):

| Путь в истории | Что там |
|---|---|
| `docs/explanatory-note-typst/` | школьная проектная работа: исходники, речь, презентации, записка в PDF — твоё ФИО, класс, лицей, город, ФИО руководителя |
| `legacy/qubite-v1/docs/explanatory-note-typst/` | то же после переноса в `legacy/` (лежит в текущем `main`) |
| `app/qubite_vpn/installer/linux/qubite-vpn_1.0.0_amd64.deb` | собранный пакет VPN, токен внутри (`lib/libapp.so`) |
| `legacy/qubite-v1/app/qubite_vpn/installer/linux/qubite-vpn_1.0.0_amd64.deb` | то же после переноса (в текущем `main`) |
| `legacy/qubite-vpn/installer/linux/qubite-vpn_1.0.0_amd64.deb` | то же, промежуточный путь переноса |

Собранные `.exe` (`qubite-vpn.exe`, `sing-box.exe`) проверены — токена в них нет, они остаются.

### 1.3. Команды

```bash
# 0. git-filter-repo: `pipx install git-filter-repo` (или пакет системы)

# 1. Резервная копия всего репозитория — на случай ошибки
git clone --mirror git@github.com:kirillkuz1122/qubite.git qubite-backup.git

# 2. Свежая копия для чистки
git clone --mirror git@github.com:kirillkuz1122/qubite.git qubite-clean.git
cd qubite-clean.git

# 3. Удалить школьную работу и VPN-пакеты со всей истории
git filter-repo --invert-paths \
  --path docs/explanatory-note-typst/ \
  --path legacy/qubite-v1/docs/explanatory-note-typst/ \
  --path app/qubite_vpn/installer/linux/qubite-vpn_1.0.0_amd64.deb \
  --path legacy/qubite-v1/app/qubite_vpn/installer/linux/qubite-vpn_1.0.0_amd64.deb \
  --path legacy/qubite-vpn/installer/linux/qubite-vpn_1.0.0_amd64.deb

# 4. Проверить: ничего из этого не осталось (оба числа — 0)
git log --all --format= --name-only | grep -c -e explanatory-note-typst -e 'qubite-vpn_1.0.0_amd64.deb'
git log --all -p | grep -c 'лицей-интернат'

# 5. Отправить на GitHub: ветки и теги целиком заменятся очищенными
git push --force git@github.com:kirillkuz1122/qubite.git 'refs/heads/*:refs/heads/*' 'refs/tags/*:refs/tags/*'
```

`git push --mirror` здесь не подойдёт: на GitHub есть служебные ссылки двух старых pull request (`refs/pull/1`, `refs/pull/2`), их менять нельзя, и push с `--mirror` упадёт.

### 1.4. После отправки

1. **Pull request №1 и №2** (ветки `codex`, `friend-changes`, май 2026) по-прежнему держат на GitHub **старые** коммиты — в них есть и школьная работа, и пакет VPN (проверено). Убрать их может только поддержка GitHub: https://support.github.com/contact → «Remove sensitive data / cached views», указать репозиторий и пути из таблицы 1.2. Делать **до** публикации.
2. Все локальные копии (твой `~/programing/qubite`, worktree агентов) после чистки устарели: склонировать заново, а старые удалить, чтобы случайно не отправить старую историю обратно.
3. Pi работает по ветке `tournaments` и тегу `qubite-v1.0` — их коммиты тоже перепишутся (новые хеши), но файлы на Pi не изменятся. На Pi `git pull` после чистки не делать без нового клона.

## 2. Сделать репозиторий публичным

1. **Почта:** https://github.com/settings/emails → включить «Keep my email addresses private» и «Block command line pushes that expose my email». Локально: `git config --global user.email 96770557+kirillkuz1122@users.noreply.github.com`.
2. **Лицензия:** выбрана AGPL-3.0 (Q-34, [D-265](../product/DECISIONS.md)), файл `LICENSE` уже в репозитории.
3. **Защита:** в репозитории → Settings → Code security → включить **Secret scanning** и **Push protection** (для публичных бесплатно). Settings → Actions → General → «Fork pull request workflows from outside collaborators» → «Require approval for all outside collaborators».
4. **Опубликовать:** Settings → General → внизу «Danger Zone» → **Change repository visibility** → **Make public** → подтвердить названием репозитория.
5. Проверить, что CI зелёный и в README нет ничего личного.

## 3. ChatGPT: модели по подписке (open-source режим)

> **Готово (AI-005, [D-219](../product/DECISIONS.md)).** Провайдер `chatgpt` в коде, выключен по умолчанию. Проверен на подставном сервере OpenAI; настоящий вход делаешь ты.
>
> **20.10.2026 исправлено ([D-280](../product/DECISIONS.md)):** OpenAI отвечал `Invalid authorize request` про `ext_agent_host_id`. Это ID установки Qubite; OpenAI принимает его только в виде `urn:uuid:<UUID>` (или `urn:ietf:params:oauth:jwk-thumbprint:…`, `did:key:…`), а мы слали `qubite-<буквы-цифры>`. Регистрировать ID нигде не нужно. Теперь он правильный, старый заменится сам при следующем входе.

Регистрировать ничего не нужно. Команды — из папки проекта; `qubite` сам читает `.env` ([D-282](../product/DECISIONS.md)), `set -x` в fish не нужен.

1. В `.env` должна быть база: `DATABASE_URL=postgres://qubite:qubite@127.0.0.1:55432/postgres` (строка есть в `.env.example`), база запущена: `just db-up`. И создан owner (`cargo run --bin qubite -- owner create --email … --name …`, если `qubite` скажет «owner ещё не создан»).
2. Ключ шифрования токенов: `cargo run --bin qubite -- ai secret-key` → строку `QUBITE_AI_SECRET_KEY=…` положи в `.env` (права `600`: `chmod 600 .env`). Потеряешь ключ — просто войдёшь заново.
3. Вход: `cargo run --bin qubite -- ai chatgpt login` (или короче `just qubite ai chatgpt login`). Qubite печатает адрес и открывает браузер на `auth.openai.com`; ты входишь в ChatGPT (Plus или Pro) и разрешаешь доступ (имя «Qubite» можно оставить). Первый вход идёт с `client_id=dynamic_agent_client` и ID этой установки (`ext_agent_host_id=urn:uuid:…`); OpenAI выдаёт постоянный `client_id` вида `oaiapp_…` — он и ID установки запоминаются и переиспользуются.
4. Браузер возвращается на `http://127.0.0.1:1455/auth/callback` — это сам Qubite (именно `127.0.0.1`, не `localhost`; другой порт — `--port`). Команда пишет «ChatGPT подключён: <почта>».
5. Токены лежат **в базе Qubite, зашифрованными** этим ключом (без ключа их не прочитать). Access-токен живёт час и обновляется сам заранее; refresh одноразовый и меняется при каждом обновлении.
6. **Сервер** (VPS или Pi) без браузера: открой туннель со своего компьютера `ssh -L 1455:127.0.0.1:1455 сервер`, на сервере запусти `qubite ai chatgpt login --no-browser`, адрес открой у себя — браузер вернётся через туннель прямо на сервер. Переносить файлы не нужно.
7. **Посмотреть модели** (сервер не нужен — команда сама спросит их у OpenAI): `cargo run --bin qubite -- ai catalog chatgpt`. Видны как `chatgpt:<модель>` (20.10.2026: `gpt-6.1-sol`, `gpt-6-sol`, `gpt-6-luna`, `gpt-6-astra`, `gpt-5.6-…`).
8. **Разрешить модель:** `cargo run --bin qubite -- ai model chatgpt:gpt-6-luna on`; сделать основной — `… ai use chatgpt:<модель>` (или `--task inbox.triage`).
9. **Личный лимит owner** — без него AI закрыт для всех, и для тебя тоже (D-212): `cargo run --bin qubite -- ai limit --scope user:<твоя почта> --period day --metric usd --value 0`. Ноль долларов — подписка стоит 0 $ и проходит, а платный OpenRouter остаётся закрытым. (20.10.2026 агент уже поставил тебе такой лимит для проверки.)
10. **Включить:** строка `QUBITE_AI_CHATGPT_ENABLED=true` в `.env`, потом перезапуск сервера (`just dev`).
11. **Проверить одним запросом** (тратит один запрос твоей подписки): `cargo run --bin qubite -- ai try --model chatgpt:gpt-6-luna "скажи привет одним словом"`. Проверено 20.10.2026: ответ пришёл, списано 0 $.
12. Запросы идут на официальный `https://api.openai.com/v1/responses` и тратят лимиты **твоей** подписки. Денег Qubite не считает (0 $), а **число запросов** ограничивает как обычно: защита от зацикливания и, если хочешь, лимит, например `qubite ai limit --scope model:chatgpt:<модель> --period day --metric requests --value 200`.

Если OpenAI всё равно покажет ошибку на своей странице — скопируй её текст целиком (и адрес из строки браузера без `state`, `nonce` и `code_challenge`) и пришли агенту.

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

Проверено 19.10.2026, формат `ext_agent_host_id` — 20.10.2026; программа в бета-версии, условия могут меняться.
