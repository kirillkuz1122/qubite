#!/usr/bin/env bash
# Собрать архив релиза Qubite (OPS-003).
#
#   scripts/release.sh [цель]        # цель по умолчанию — эта машина, например aarch64-unknown-linux-gnu
#   QUBITE_SKIP_WEB=1 scripts/release.sh …   # не собирать сайт (взять готовый apps/web/dist)
#   QUBITE_SKIP_LICENSES=1 scripts/release.sh …   # не генерировать списки лицензий (нужен cargo-about)
#
# Результат в dist/release/:
#   qubite-<версия>-<цель>.tar.gz          — архив
#   qubite-<версия>-<цель>.tar.gz.sha256   — контрольная сумма (проверка: sha256sum -c …)
#
# Внутри архива:
#   bin/qubite            — сервер и все служебные команды (миграции встроены в бинарник)
#   web/                  — собранный сайт для Caddy
#   qubite.env.example    — пример настроек
#   THIRD_PARTY_LICENSES.{rust,npm}.txt — лицензии зависимостей (OPS-008), копия и в web/licenses/
#   RELEASE.txt           — версия, коммит, цель, что где лежит
set -euo pipefail

cd "$(dirname "$0")/.."
target="${1:-$(rustc -vV | sed -n 's/^host: //p')}"
version="$(sed -n 's/^version = "\(.*\)"/\1/p' Cargo.toml | head -1)"
commit="$(git rev-parse --short=12 HEAD 2>/dev/null || echo unknown)"
name="qubite-${version}-${target}"
out="dist/release"
stage="${out}/${name}"

echo "Сборка ${name} (коммит ${commit})"
cargo build --release --locked --bin qubite --target "${target}"

if [[ "${QUBITE_SKIP_WEB:-0}" != "1" ]]; then
    pnpm --filter @qubite/web build
fi
[[ -f apps/web/dist/index.html ]] || { echo "нет apps/web/dist/index.html — сначала собери сайт" >&2; exit 1; }

if [[ "${QUBITE_SKIP_LICENSES:-0}" != "1" ]]; then
    scripts/gen-licenses.sh
fi

rm -rf "${stage}" "${out}/${name}.tar.gz" "${out}/${name}.tar.gz.sha256"
mkdir -p "${stage}/bin" "${stage}/web"
cp "target/${target}/release/qubite" "${stage}/bin/qubite"
cp -R apps/web/dist/. "${stage}/web/"
cp .env.example "${stage}/qubite.env.example"
if [[ "${QUBITE_SKIP_LICENSES:-0}" != "1" ]]; then
    cp THIRD_PARTY_LICENSES.rust.txt THIRD_PARTY_LICENSES.npm.txt "${stage}/"
    mkdir -p "${stage}/web/licenses"
    cp THIRD_PARTY_LICENSES.rust.txt THIRD_PARTY_LICENSES.npm.txt "${stage}/web/licenses/"
fi
mkdir -p "${stage}/deploy"
cp -R deploy/pi "${stage}/deploy/pi"
cat > "${stage}/RELEASE.txt" <<TXT
Qubite ${version}
Коммит: ${commit}
Цель: ${target}
Собрано: $(date -u +%Y-%m-%dT%H:%M:%SZ)

bin/qubite          сервер: serve, migrate, owner create, owner password, version, openapi
web/                сайт (статические файлы для Caddy)
qubite.env.example  пример настроек (заполнить и положить в /etc/qubite/qubite.env, права 600)
deploy/pi/          службы systemd и автодеплой для Raspberry Pi (OPS-005)

Быстрая проверка: bin/qubite version
Установка — deploy/install.sh (задача OPS-001), инструкция — docs/engineering/DEPLOYMENT.md.
TXT

# Одинаковый порядок и владелец файлов — архив не зависит от машины сборки.
tar --sort=name --owner=0 --group=0 --numeric-owner -C "${out}" -czf "${out}/${name}.tar.gz" "${name}"
(cd "${out}" && sha256sum "${name}.tar.gz" > "${name}.tar.gz.sha256")
rm -rf "${stage}"
echo "Готово: ${out}/${name}.tar.gz"
cat "${out}/${name}.tar.gz.sha256"
