#!/usr/bin/env bash
# Автодеплой Qubite на Pi (OPS-005, D-566, D-567). Ставится в /opt/qubite/bin/qubite-update,
# запускается таймером qubite-update.timer раз в 5 минут.
#
#   qubite-update             — обновиться, если в CI есть новая зелёная сборка main
#   qubite-update --force     — то же, даже если Pi нагружена или сборка уже падала
#   qubite-update --rollback  — вернуть прошлую версию; база остаётся как есть (D-970)
#   qubite-update --rollback --with-db — то же и база из бэкапа перед последним обновлением;
#                             текущая база сначала сохраняется в $BACKUPS/before-restore/
#   qubite-update --status    — что стоит сейчас
#
# Порядок: сборка `edge` из CI → все проверки этого коммита зелёные → сумма архива →
# остановка сервера и бота → бэкап базы → новая версия → миграции → сервер → /api/ready →
# бот → сообщение в Telegram. Не дождались /api/ready — откат: прошлая версия и база из бэкапа.
#
# Записи не теряются (D-970): бэкап снимается, когда сервер и бот уже остановлены, поэтому
# в нём всё, что приняла старая версия, а после него до отката никто ничего не пишет.
# Любое восстановление сначала сохраняет текущую базу в отдельный файл. Ручной --rollback
# базу не трогает: миграции только добавляют (D-970), прошлая версия работает и на новой схеме.
#
# После выкладки и отката пишет /opt/qubite/deploy.json — его читает `qubite serve` и показывает
# на сайте номер версии, коммит, время выкладки и «откат с X на Y» (OPS-007, D-574).
#
# Ничего не собирает на Pi. Если Pi нагружена (load average или мало памяти) — откладывает.
set -euo pipefail

REPO="${QUBITE_REPO:-kirillkuz1122/qubite}"
TARGET="${QUBITE_TARGET:-aarch64-unknown-linux-gnu}"
# QUBITE_UPDATE_PREFIX — только для теста deploy/pi/test-update.sh: все пути внутри временной
# папки, без root. На Pi не задаётся.
PREFIX="${QUBITE_UPDATE_PREFIX:-}"
ROOT="$PREFIX/opt/qubite"
ETC="$PREFIX/etc/qubite"
STATE="$PREFIX/var/lib/qubite-update"
BACKUPS="$PREFIX/var/backups/qubite"
READY_SECS="${QUBITE_UPDATE_READY_SECS:-90}"   # сколько ждать /api/ready после запуска
DB_OWNER="${QUBITE_DB_OWNER:-qubite}"          # владелец базы (в тесте — роль тестовой базы)
MAX_LOAD="${QUBITE_UPDATE_MAX_LOAD:-2.5}"      # load average за минуту (у Pi 5 четыре ядра)
MIN_MEM_MB="${QUBITE_UPDATE_MIN_MEM_MB:-400}"  # MemAvailable
KEEP_RELEASES=3
KEEP_BACKUPS=7
API="https://api.github.com/repos/${REPO}"

log() { echo "qubite-update: $*"; }
die() { log "$*"; exit 1; }

[[ -n $PREFIX || $EUID -eq 0 ]] || die "запускать от root (sudo)"
mkdir -p "$STATE" "$BACKUPS/before-restore" "$ROOT/releases"
chmod 700 "$STATE" "$BACKUPS" "$BACKUPS/before-restore"
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

# Файл для сайта (OPS-007): что стоит, когда собрано и выложено, был ли откат.
# $1 — коммит, $2 — папка релиза, $3 — откат одной строкой JSON (или пусто). Сбой не мешает обновлению.
write_info() {
    local commit="$1" dir="$2" rollback="${3:-null}" built tmp="$ROOT/deploy.json.new"
    built="$(sed -n 's/^Собрано: //p' "$dir/RELEASE.txt" 2>/dev/null | head -1 || true)"
    {
        jq -n --arg commit "$commit" --arg built "$built" --arg now "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
            --argjson rollback "$rollback" \
            '{commit: $commit, built_at: (if $built == "" then null else $built end), deployed_at: $now, rollback: $rollback}' \
            >"$tmp" && chmod 644 "$tmp" && mv -f "$tmp" "$ROOT/deploy.json"
    } || log "не записал $ROOT/deploy.json — сайт не покажет версию"
}

notify() {
    local kind="$1" text="$2" key="$3"
    # Старая версия может не знать вид `deploy` — тогда как ошибка сервера.
    q "$ROOT/current/bin/qubite" notify --key "$key" "$kind" "$text" >/dev/null 2>&1 \
        || q "$ROOT/current/bin/qubite" notify --key "$key" server_errors "$text" >/dev/null 2>&1 \
        || log "не удалось положить сообщение для Telegram"
}

wait_ready() {
    for _ in $(seq 1 "$READY_SECS"); do
        if curl -fsS --noproxy '*' -m 3 "http://${BIND}/api/ready" 2>/dev/null | grep -q '"status":"ready"'; then
            return 0
        fi
        sleep 1
    done
    return 1
}

# Всё, что пишет в базу. `systemctl stop` ждёт, пока процесс выйдет: сервер доотвечает
# на начатые запросы (TimeoutStopSec=30), бот допишет начатое.
WRITERS_STOPPED=0
stop_writers() {
    WRITERS_STOPPED=1
    systemctl stop qubite-bot.service qubite-serve.service
}

# Признак «остановлены» снимается, только когда сервер правда запустился.
start_serve() {
    systemctl restart qubite-serve.service || return 1
    WRITERS_STOPPED=0
}

start_bot() {
    systemctl restart qubite-bot.service || log "бот не запустился (нет токена?) — сайт это не ломает"
}

restart_services() {
    local status=0
    start_serve || { log "сервер не запустился"; status=1; }
    start_bot
    return "$status"
}

# Скрипт упал, пока сервер и бот остановлены, — запустить то, что стоит, а не оставить сайт лежать.
on_exit() {
    rm -rf "${tmp:-}"
    if [[ $WRITERS_STOPPED == 1 ]]; then
        log "выход при остановленном сервере — запускаю то, что стоит"
        restart_services || true
    fi
}
trap on_exit EXIT

switch_to() {
    ln -sfn "$1" "$ROOT/current.new"
    mv -T "$ROOT/current.new" "$ROOT/current"
}

# Снимок базы в файл (права 600). $1 — куда.
dump_db() {
    runuser -u postgres -- pg_dump -Fc "$DB_NAME" >"$1" && chmod 600 "$1"
}

# База из бэкапа: пересоздать (новые таблицы миграции тоже уходят) и восстановить.
# Сначала текущая база — в отдельный файл: всё записанное после бэкапа остаётся в нём,
# эти файлы скрипт сам не удаляет (удалить данные решает владелец).
restore_db() {
    local dump="$1" keep
    stop_writers || true
    keep="$BACKUPS/before-restore/$(date +%Y%m%d-%H%M%S)-$(current_commit | cut -c1-12).dump"
    if ! dump_db "$keep"; then
        rm -f "$keep"
        die "не сохранил текущую базу перед восстановлением — базу не трогаю"
    fi
    log "текущая база сохранена в $keep"
    log "восстанавливаю базу из $(basename "$dump")"
    runuser -u postgres -- dropdb --if-exists --force "$DB_NAME"
    runuser -u postgres -- createdb -O "$DB_OWNER" "$DB_NAME"
    runuser -u postgres -- pg_restore --no-owner --role="$DB_OWNER" -d "$DB_NAME" "$dump"
}

# Вернуть прошлую версию. $1 — причина (для сообщения), $2 — 1: и базу из бэкапа.
rollback() {
    local reason="$1" with_db="$2" prev dump bad base
    prev="$(cat "$STATE/previous" 2>/dev/null || true)"
    dump="$(cat "$STATE/last-backup" 2>/dev/null || true)"
    bad="$(current_commit)"
    [[ -n $prev && -d $prev ]] || die "откатываться некуда: прошлой версии нет"
    base="база не тронута"
    if [[ $with_db == 1 ]]; then
        [[ -n $dump && -f $dump ]] || die "бэкапа базы перед последним обновлением нет — версию не меняю"
        stop_writers
        switch_to "$prev"
        restore_db "$dump"
        base="база из бэкапа, всё записанное после — в $BACKUPS/before-restore/"
    else
        switch_to "$prev"
    fi
    restart_services || true
    echo "$bad" >"$STATE/failed"
    local good
    good="$(current_commit)"
    write_info "$good" "$prev" "$(jq -nc --arg from "$bad" --arg to "$good" --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
        --arg reason "$reason" '{from: $from, to: $to, at: $at, reason: $reason}')"
    if wait_ready; then
        log "откат на ${good:0:12} готов"
        notify deploy "Обновление до ${bad:0:12} не прошло (${reason}). Вернул прошлую версию ${good:0:12}, ${base}." "deploy-fail-${bad}"
    else
        log "после отката сервер тоже не готов"
        [[ $with_db == 1 ]] || log "если старая версия не работает на новой схеме: qubite-update --rollback --with-db"
        notify server_down "Обновление до ${bad:0:12} не прошло (${reason}), и после отката сервер не отвечает (${base}). Смотри: journalctl -u qubite-serve" "deploy-fail-${bad}"
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
        # Первый запуск этого скрипта после обновления со старого: выкладку делал он, файла для сайта
        # ещё нет. Заводим его для стоящей версии (время выкладки — сейчас, точнее не знаем).
        [[ -f $ROOT/deploy.json ]] || write_info "$commit" "$(readlink -f "$ROOT/current")"
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

    # Бэкап перед миграциями — когда сервер и бот уже остановлены (D-970): в нём всё, что они
    # успели принять, и после него до конца обновления никто не пишет. Сайт лежит с этой
    # минуты до /api/ready новой версии — обычно секунды. Первая установка — базы ещё может
    # не быть, это не страшно.
    prev="$(readlink -e "$ROOT/current" 2>/dev/null || true)"
    dump=""
    if [[ -n $prev && -d $prev ]]; then
        stop_writers
        dump="$BACKUPS/$(date +%Y%m%d-%H%M%S)-$(basename "$prev").dump"
        if ! dump_db "$dump"; then
            rm -f "$dump"
            restart_services || true
            die "бэкап базы не получился — не обновляю, старая версия запущена"
        fi
    fi
    echo "$prev" >"$STATE/previous"
    echo "$dump" >"$STATE/last-backup"

    switch_to "$dir"
    if ! q "$ROOT/current/bin/qubite" migrate; then
        [[ -n $prev ]] && rollback "миграции упали" 1
        die "миграции упали"
    fi
    # Бот — только когда сервер готов: до этого новая версия ничего не пишет.
    if ! start_serve || ! wait_ready; then
        [[ -n $prev ]] && rollback "сервер не запустился или не ответил /api/ready" 1
        die "сервер не запустился или не ответил /api/ready"
    fi
    start_bot

    rm -f "$STATE/failed"
    write_info "$commit" "$dir"
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
    --rollback)
        case "${2:-}" in
            "") rollback "откат вручную" 0 ;;
            --with-db) rollback "откат вручную с базой" 1 ;;
            *) die "непонятный ключ: $2 (есть --with-db)" ;;
        esac
        ;;
    --status)
        echo "версия: $(current_commit)"
        echo "папка:  $(readlink -f "$ROOT/current" 2>/dev/null || echo нет)"
        echo "прошлая: $(cat "$STATE/previous" 2>/dev/null || echo нет)"
        echo "бэкап:  $(cat "$STATE/last-backup" 2>/dev/null || echo нет)"
        echo "не прошла: $(cat "$STATE/failed" 2>/dev/null || echo нет)"
        echo "сохранено перед восстановлением: $(find "$BACKUPS/before-restore" -name '*.dump' 2>/dev/null | wc -l) файл(ов) в $BACKUPS/before-restore"
        echo "для сайта: $(jq -c . "$ROOT/deploy.json" 2>/dev/null || echo нет)"
        ;;
    *) die "непонятный ключ: $1 (есть --force, --rollback [--with-db], --status)" ;;
esac
