# Codex на Pi: очередь заданий (D-623, D-630…D-639)

Задание для Codex — GitHub Issue с меткой `codex`. Pi раз в 5 минут берёт **одно** задание, Codex делает его в отдельной копии репозитория, результат — PR с отчётом. Код Codex проверяет Claude (D-621), PR сам не сливается.

## Как поставить
1. Issue по шаблону из `.claude/skills/delegate/SKILL.md` (цель, файлы, прочитать, готово когда, нельзя, отчёт).
2. Метки: `codex` + модель + уровень (необязательно). Метку `codex` должен ставить владелец `kirillkuz1122` или issue должен быть от него — иначе задание пропускается.
3. Ждать: Codex работает минуты. Итог — комментарий в issue и метка.

| Метка | Что значит |
|---|---|
| `codex-model:sol` | GPT 6.1 Sol, `gpt-6.1-sol` — обычный код. **По умолчанию.** |
| `codex-model:terra` | GPT 6.1 Terra, `gpt-6.1-terra` — проверки и ревью |
| `codex-effort:medium\|high\|xhigh` | уровень рассуждения, по умолчанию `high` |
| `codex-review` | ревью: в тексте «PR #N»; Codex пишет отзыв комментарием в PR, код не меняет |
| `codex:в-работе` / `codex:готово` / `codex:ошибка` | ставит очередь сама |

Ветка — `codex-issue-N` (не `codex/…`: ветка `codex` уже есть, git не даст). PR — «Closes #N».

## Повторить или поправить
- Ошибка: прочитать комментарий с хвостом лога, снять `codex:ошибка` — задание возьмётся снова.
- Поправки к готовому: дописать в **текст** issue, что исправить (комментарии Codex не читает), и снять `codex:готово` — будет новая ветка `codex-issue-N-время`.

## Где что на Pi
- Код: `deploy/pi/codex-queue/` → `/opt/qubite/bin/qubite-codex`, юниты `qubite-codex.service` и `.timer` (в `qubite.slice`, Nice 15, MemoryMax 600M).
- Папки: `~/codex-queue/jobs/issue-N-время` (копии, последние 5), `~/codex-queue/logs/` (логи и отчёты, 30 дней).
- Состояние: `qubite-codex --status`; журнал: `journalctl -u qubite-codex -n 50`.
- Остановить: `sudo systemctl disable --now qubite-codex.timer`; вернуть — `enable --now`.
- Установить заново: `sudo deploy/pi/codex-queue/install.sh` (нужны `codex login --device-auth` и `gh auth login` от kirill).

## Ограничения
- Песочница Codex: запись только в папку задания (ревью — только чтение), сети нет. Значит, Terra не откроет браузер и не сделает скриншоты — для этого нужна отдельная доработка.
- На Pi только лёгкие проверки (`git diff --check`, `scripts/check.sh --quick` для не-кода); сборки и тесты — CI.
- Pi занята (load > 6 или памяти < 600M) — задание ждёт.
