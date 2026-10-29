# Облачный Codex для Qubite

Бот Codex в GitHub берёт задания по комментарию `@codex …` в issue или PR, но только если на chatgpt.com/codex создано окружение для этого репозитория.

Настройка (делает владелец, один раз):
1. chatgpt.com/codex/cloud/settings/environments → New → репозиторий `kirillkuz1122/qubite`.
2. Setup script — содержимое `setup.sh` из этой папки.
3. Доступ в интернет для агента: «Common dependencies» или включить (нужен npm, crates.io).
4. Секреты не нужны: платный ИИ в тестах — только моки.
