# Qubite Tournaments — optional standalone component

[Manifest](manifest.json) описывает сохранённую самостоятельную платформу в [legacy/qubite-v1](../../legacy/qubite-v1/README.md). Код исполняется оттуда, не продублирован и не заменён ссылками/симлинками. Владелец13.10.2026 отменил план общего входа/SSO с Qubite 2.0.

Backend Node/Express, SQLite, старый Vanilla UI; собственные accounts/owner/tournament roles/credentials. Компонент по умолчанию не включён в новый core, не входит в новый пользовательский workspace и не читает его БД. Никаких automatic module grants/AI access/core cookie Domain. Manifest — описание для будущего installer, не реализованный package manager.

Турнирный поддомен будет настроен при deploy отдельно, например tournaments.<selected-domain>. Новый installer обязан предложить opt-in installation, отдельные данные/env/service/backup и возможность не устанавливать. Общий install.sh Qubite 2.0 и установка модулей из Owner Console пока отдельные задачи DEPLOY-001/002/003; deploy/TLS не выполнялись.

Безопасная проверка пути: `bash legacy/qubite-v1/deploy/install.sh --plan` из корня. Полный source-copy regression: root verify.py --suite all. Живой turнирный runtime/scoring regression — TEST-002 перед server release.
