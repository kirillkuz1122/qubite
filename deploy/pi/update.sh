#!/usr/bin/env bash
# Автодеплой Qubite на Pi (OPS-005, D-566, D-567). Ставится в /opt/qubite/bin/qubite-update,
# запускается таймером qubite-update.timer раз в 5 минут.
#
#   qubite-update             — обновиться, если в CI есть новая зелёная сборка main
#   qubite-update --force     — то же, даже если Pi нагружена или сборка уже падала
#   qubite-update --rollback  — вернуть прошлую версию и базу из бэкапа перед последним обновлением
#   qubite-update --status    — что стоит сейчас
#
# Порядок: сборка `edge` из CI → все проверки этого коммита зелёные → сумма архива →
# бэкап базы → новая версия → миграции → перезапуск → /api/ready → сообщение в Telegram.
# Не дождались /api/ready — откат: прошлая версия и база из бэкапа.
#
# Ничего не собирает на Pi. Если Pi нагружена (load average или мало памяти) — откладывает.
set -euo pipefail

REPO="${QUBITE_REPO:-kirillkuz1122/qubite}"
TARGET="${QUBITE_TARGET:-aarch64-unknown-linux-gnu}"
ROOT=/opt/qubite
ETC=/etc/qubite
STATE=/var/lib/qubite-update
BACKUPS=/var/backups/qubite
MAX_LOAD="${QUBITE_UPDATE_MAX_LOAD:-2.5}"      # load average за минуту (у Pi 5 четыре ядра)
MIN_MEM_MB="${QUBITE_UPDATE_MIN_MEM_MB:-400}"  # MemAvailable
KEEP_RELEASES=3
KEEP_BACKUPS=7
API="https://api.github.com/repos/${REPO}"

log() { echo "qubite-update: $*"; }
die() { log "$*"; exit 1; }

[[ $EUID -eq 0 ]] || die "запускать от root (sudo)"
mkdir -p "$STATE" "$BACKUPS" "$ROOT/releases"
chmod 700 "$STATE" "$BACKUPS"
exec 9>"$STATE/lock"
flock -n 9 || { log "уже идёт другое обновление"; exit 0; }

# DATABASE_URL и адрес сервера — из pi.env (его пишет install.sh, простой формат KEY=VALUE).
env_value() { sed -n "s/^$1=//p" "$ETC/pi.env" | tail -1; }
DATABASE_URL="$(env_value DATABASE_URL)"
BIND="$(env_value QUBITE_BIND)"
[[ -n $DATABASE_URL && -n $BIND ]] || die "нет DATABASE_URL или QUBITE_BIND в $ETC/pi.env"
DB_NAME="${DATABASE_URL##*/}"
DB_NAME="${DB_NAME%%\?*}"

current_commit() { cat "$ROOT/current/COMMIT" 2>/dev/null || true; }

# Команда qubite от пользователя qubite, только с базой (без файла .env владельца).
q() {
    local bin="$1"
    shift
    runuser -u qubite -- env QUBITE_DOTENV=0 DATABASE_URL="$DATABASE_URL" QUBITE_LOG=warn "$bin" "$@"
}

notify() {
    local kind="$1" text="$2" key="$3"
    # Старая версия может не знать вид `deploy` — тогда как ошибка сервера.
    q "$ROOT/current/bin/qubite" notify --key "$key" "$kind" "$text" >/dev/null 2>&1 \
        || q "$ROOT/current/bin/qubite" notify --key "$key" server_errors "$text" >/dev/null 2>&1 \
        || log "не удалось положить сообщение для Telegram"
}

wait_ready() {
    local i
    for i in $(seq 1 90); do
        if curl -fsS --noproxy '*' -m 3 "http://${BIND}/api/ready" 2>/dev/null | grep -q '"status":"ready"'; then
            return 0
        fi
        sleep 1
    done
    return 1
}

restart_services() {
    systemctl restart qubite-serve.service
    systemctl restart qubite-bot.service || log "бот не запустился (нет токена?) — сайт это не ломает"
}

switch_to() {
    ln -sfn "$1" "$ROOT/current.new"
    mv -T "$ROOT/current.new" "$ROOT/current"
}

# База из бэкапа: пересоздать (новые таблицы миграции тоже уходят) и восстановить.
restore_db() {
    local dump="$1"
    log "восстанавливаю базу из $(basename "$dump")"
    systemctl stop qubite-bot.service qubite-serve.service || true
    runuser -u postgres -- dropdb --if-exists --force "$DB_NAME"
    runuser -u postgres -- createdb -O qubite "$DB_NAME"
    runuser -u postgres -- pg_restore --no-owner --role=qubite -d "$DB_NAME" "$dump"
}

# Вернуть прошлую версию и базу. $1 — причина (для сообщения).
rollback() {
    local reason="$1" prev dump bad
    prev="$(cat "$STATE/previous" 2>/dev/null || true)"
    dump="$(cat "$STATE/last-backup" 2>/dev/null || true)"
    bad="$(current_commit)"
    [[ -n $prev && -d $prev ]] || die "откатываться некуда: прошлой версии нет"
    switch_to "$prev"
    if [[ -n $dump && -f $dump ]]; then
        restore_db "$dump"
    fi
    restart_services
    echo "$bad" >"$STATE/failed"
    local good
    good="$(current_commit)"
    if wait_ready; then
        log "откат на ${good:0:12} готов"
        notify deploy "Обновление до ${bad:0:12} не прошло (${reason}). Вернул прошлую версию ${good:0:12}, база из бэкапа." "deploy-fail-${bad}"
    else
        log "после отката сервер тоже не готов"
        notify server_down "Обновление до ${bad:0:12} не прошло (${reason}), и после отката сервер не отвечает. Смотри: journalctl -u qubite-serve" "deploy-fail-${bad}"
        exit 1
    fi
}

loaded() {
    local load mem
    load="$(cut -d' ' -f1 /proc/loadavg)"
    mem="$(awk '/^MemAvailable:/ {print int($2/1024)}' /proc/meminfo)"
    if awk -v l="$load" -v m="$MAX_LOAD" 'BEGIN {exit !(l > m)}'; then
        log "Pi нагружена (load ${load} > ${MAX_LOAD}) — отложу"
        return 0
    fi
    if ((mem < MIN_MEM_MB)); then
        log "мало свободной памяти (${mem} МБ < ${MIN_MEM_MB}) — отложу"
        return 0
    fi
    return 1
}

github() { curl -fsSL -m 30 -H 'Accept: application/vnd.github+json' "$@"; }

# Все проверки коммита в GitHub закончились и ни одна не красная.
ci_green() {
    local sha="$1" runs
    runs="$(github "${API}/commits/${sha}/check-runs?per_page=100")" || return 1
    jq -e '.check_runs | length > 0 and all(.status == "completed" and
        (.conclusion == "success" or .conclusion == "skipped" or .conclusion == "neutral"))' \
        >/dev/null <<<"$runs"
}

deploy() {
    local force="$1" release edge_url commit tar_url sum_url tar_name dir prev dump
    if [[ $force != 1 ]] && loaded; then
        exit 0
    fi
    release="$(github "${API}/releases/tags/edge")" || { log "нет сборки edge в GitHub"; exit 0; }
    edge_url="$(jq -r '.assets[] | select(.name == "edge.json") | .browser_download_url' <<<"$release")"
    [[ -n $edge_url ]] || { log "сборка edge ещё выкладывается"; exit 0; }
    commit="$(github "$edge_url" | jq -r .commit)"
    [[ $commit =~ ^[0-9a-f]{40}$ ]] || die "в edge.json нет коммита"

    if [[ $commit == "$(current_commit)" ]]; then
        exit 0
    fi
    if [[ $force != 1 && $commit == "$(cat "$STATE/failed" 2>/dev/null || true)" ]]; then
        log "сборка ${commit:0:12} уже не прошла — жду следующую (или --force)"
        exit 0
    fi
    if ! ci_green "$commit"; then
        log "CI для ${commit:0:12} ещё не зелёный — подожду"
        exit 0
    fi

    tar_url="$(jq -r --arg t "$TARGET" '.assets[] | select(.name | endswith("-" + $t + ".tar.gz")) | .browser_download_url' <<<"$release")"
    sum_url="$(jq -r --arg t "$TARGET" '.assets[] | select(.name | endswith("-" + $t + ".tar.gz.sha256")) | .browser_download_url' <<<"$release")"
    [[ -n $tar_url && -n $sum_url ]] || die "в edge нет архива для $TARGET"
    tar_name="$(basename "$tar_url")"

    log "ставлю ${commit:0:12} ($tar_name)"
    tmp="$(mktemp -d)"
    trap 'rm -rf "${tmp:-}"' EXIT
    curl -fsSL -m 600 -o "$tmp/$tar_name" "$tar_url"
    curl -fsSL -m 60 -o "$tmp/$tar_name.sha256" "$sum_url"
    (cd "$tmp" && sha256sum -c --quiet "$tar_name.sha256") || die "контрольная сумма не сошлась"

    dir="$ROOT/releases/${commit:0:12}"
    rm -rf "$dir"
    mkdir -p "$dir"
    tar -xzf "$tmp/$tar_name" -C "$dir" --strip-components=1 --no-same-owner
    echo "$commit" >"$dir/COMMIT"
    chmod -R a+rX "$dir"
    "$dir/bin/qubite" version >/dev/null || die "новый бинарник не запускается"

    # Бэкап перед миграциями. Первая установка — базы ещё может не быть, это не страшно.
    prev="$(readlink -e "$ROOT/current" 2>/dev/null || true)"
    dump=""
    if [[ -n $prev && -d $prev ]]; then
        dump="$BACKUPS/$(date +%Y%m%d-%H%M%S)-$(basename "$prev").dump"
        runuser -u postgres -- pg_dump -Fc "$DB_NAME" >"$dump" || die "бэкап базы не получился — не обновляю"
        chmod 600 "$dump"
    fi
    echo "$prev" >"$STATE/previous"
    echo "$dump" >"$STATE/last-backup"

    switch_to "$dir"
    if ! q "$ROOT/current/bin/qubite" migrate; then
        [[ -n $prev ]] && rollback "миграции упали"
        die "миграции упали"
    fi
    restart_services
    if ! wait_ready; then
        [[ -n $prev ]] && rollback "сервер не ответил /api/ready"
        die "сервер не ответил /api/ready"
    fi

    rm -f "$STATE/failed"
    # Свежий скрипт обновления из сборки (службы systemd меняет только install.sh).
    if [[ -f $dir/deploy/pi/update.sh ]]; then
        install -m 755 "$dir/deploy/pi/update.sh" "$ROOT/bin/qubite-update.new"
        mv -f "$ROOT/bin/qubite-update.new" "$ROOT/bin/qubite-update"
    fi
    cleanup
    log "готово: ${commit:0:12}"
    notify deploy "Qubite обновился: ${commit:0:12}. $(git_subject "$commit")" "deploy-ok-${commit}"
}

git_subject() {
    github "${API}/commits/$1" 2>/dev/null | jq -r '.commit.message | split("\n")[0]' 2>/dev/null || true
}

cleanup() {
    local cur
    cur="$(readlink -f "$ROOT/current")"
    # shellcheck disable=SC2012
    ls -1dt "$ROOT"/releases/*/ 2>/dev/null | sed 's#/$##' | { grep -vxF "$cur" || true; } | tail -n +"$KEEP_RELEASES" | xargs -r rm -rf
    # shellcheck disable=SC2012
    ls -1t "$BACKUPS"/*.dump 2>/dev/null | tail -n +"$((KEEP_BACKUPS + 1))" | xargs -r rm -f
}

case "${1:-}" in
    "") deploy 0 ;;
    --force) deploy 1 ;;
    --rollback) rollback "откат вручную" ;;
    --status)
        echo "версия: $(current_commit)"
        echo "папка:  $(readlink -f "$ROOT/current" 2>/dev/null || echo нет)"
        echo "прошлая: $(cat "$STATE/previous" 2>/dev/null || echo нет)"
        echo "бэкап:  $(cat "$STATE/last-backup" 2>/dev/null || echo нет)"
        echo "не прошла: $(cat "$STATE/failed" 2>/dev/null || echo нет)"
        ;;
    *) die "непонятный ключ: $1 (есть --force, --rollback, --status)" ;;
esac
