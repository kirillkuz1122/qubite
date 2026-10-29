#!/usr/bin/env bash
# Скрипт настройки облачного окружения Codex для kirillkuz1122/qubite.
# Вставить в chatgpt.com/codex → Environments → Setup script. Интернет для настройки — включён.
set -euo pipefail

# Node 22+ и pnpm из package.json (packageManager).
corepack enable
corepack prepare "$(node -p "require('./package.json').packageManager")" --activate
pnpm install --frozen-lockfile

# Rust из rust-toolchain.toml (rustup сам ставит нужную версию).
if command -v rustup >/dev/null; then rustup show active-toolchain || rustup toolchain install; fi

# Браузер для e2e и скриншотов ПК / 360 px.
pnpm --filter @qubite/web exec playwright install --with-deps chromium

# Проверка, что всё на месте.
node -v && pnpm -v && (cargo -V || true)
