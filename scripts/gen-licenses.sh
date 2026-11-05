#!/usr/bin/env bash
# Список лицензий зависимостей (OPS-008): THIRD_PARTY_LICENSES.rust.txt и .npm.txt в корне.
# Нужны: cargo-about (`cargo install --locked cargo-about`), pnpm.
set -euo pipefail
cd "$(dirname "$0")/.."
cargo about generate --locked --workspace about.hbs -o THIRD_PARTY_LICENSES.rust.txt
pnpm -s gen:licenses
echo "Готово: THIRD_PARTY_LICENSES.rust.txt, THIRD_PARTY_LICENSES.npm.txt"
