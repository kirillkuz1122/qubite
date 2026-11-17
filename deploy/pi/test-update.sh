#!/usr/bin/env bash
# Проверка deploy/pi/update.sh без Pi (OPS-009, D-962): обновление и откат не теряют записей.
#
#   UPDATE_TEST_DATABASE_URL=postgres://qubite:qubite@127.0.0.1:5432/postgres deploy/pi/test-update.sh
#
# Нужны PostgreSQL (роль с правом создавать базы; pg_dump не старше сервера), jq, flock.
# Настоящие systemctl, runuser и curl подменяются заглушками из временной папки; «сервер»
# и «бот» — поддельный бинарник qubite, который без остановки пишет строки в базу и помнит
# номер последней подтверждённой записи. Проверка: всё, что старая версия подтвердила,
# есть в базе после обновления и после любого отката; записи новой версии не пропадают
# (остаются в базе или в файле before-restore).
# Проверки пишутся в одинарных кавычках и раскрываются в check (eval) — это нарочно.
# shellcheck disable=SC2016,SC2034
set -euo pipefail

ADMIN_URL="${UPDATE_TEST_DATABASE_URL:-${TEST_DATABASE_URL:-}}"
[[ -n $ADMIN_URL ]] || { echo "нужна UPDATE_TEST_DATABASE_URL (или TEST_DATABASE_URL)"; exit 2; }
SCRIPT="$(cd "$(dirname "$0")" && pwd)/update.sh"
WORK="$(mktemp -d)"
FAILS=0

# Разбор адреса: postgres://user:pass@host:port/db
url_re='^postgres(ql)?://([^:@/]+)(:([^@/]*))?@([^:/]+)(:([0-9]+))?/'
[[ $ADMIN_URL =~ $url_re ]] || { echo "не разобрал адрес базы"; exit 2; }
export PGUSER="${BASH_REMATCH[2]}" PGPASSWORD="${BASH_REMATCH[4]}" PGHOST="${BASH_REMATCH[5]}"
export PGPORT="${BASH_REMATCH[7]:-5432}" PGDATABASE=postgres
OWNER="$PGUSER"

A=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
B=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb

cleanup() {
    local pidfile
    for pidfile in "$WORK"/*/run/*.pid; do
        [[ -f $pidfile ]] && kill "$(cat "$pidfile")" 2>/dev/null || true
    done
    psql -qAt -c "SELECT datname FROM pg_database WHERE datname LIKE 'qubite_update_test_%'" 2>/dev/null |
        while read -r db; do dropdb --if-exists --force "$db" 2>/dev/null || true; done
    rm -rf "$WORK"
}
trap cleanup EXIT

ok() { echo "  ✓ $*"; }
bad() { echo "  ✗ $*"; FAILS=$((FAILS + 1)); }
check() { if eval "$2"; then ok "$1"; else bad "$1"; fi; }

# ---------------------------------------------------------------- заглушки и поддельный qubite

make_stubs() {
    local bin="$1/stubs"
    mkdir -p "$bin"
    # runuser -u USER -- команда…  →  команда… (доступ к базе — из PG* окружения теста)
    cat >"$bin/runuser" <<'SH'
#!/usr/bin/env bash
while [[ $# -gt 0 && $1 != -- ]]; do shift; done
shift
echo "runuser $1" >>"$QUBITE_UPDATE_PREFIX/calls.log"
exec "$@"
SH
    # systemctl start|stop|restart юнит… — фоновые процессы с pid-файлами
    cat >"$bin/systemctl" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
P="$QUBITE_UPDATE_PREFIX"
cmd="$1"
shift
echo "systemctl $cmd $*" >>"$P/calls.log"
mkdir -p "$P/run"
stop() {
    local pid
    pid="$(cat "$P/run/$1.pid" 2>/dev/null || true)"
    [[ -n $pid ]] || return 0
    kill -TERM "$pid" 2>/dev/null || true
    for _ in $(seq 1 100); do kill -0 "$pid" 2>/dev/null || break; sleep 0.1; done
    rm -f "$P/run/$1.pid"
}
start() {
    local role
    [[ -f $P/run/$1.pid ]] && return 0
    case "$1" in qubite-serve.service) role=serve ;; qubite-bot.service) role=bot ;; *) return 0 ;; esac
    (
        exec 9>&- # замок update.sh не должен достаться «службе», как и у настоящего systemd
        set -a
        # shellcheck disable=SC1091
        . "$P/etc/qubite/pi.env"
        set +a
        exec "$P/opt/qubite/current/bin/qubite" "$role" >>"$P/services.log" 2>&1
    ) &
    echo $! >"$P/run/$1.pid"
}
for unit in "$@"; do
    case "$cmd" in
        start) start "$unit" ;;
        stop) stop "$unit" ;;
        restart) stop "$unit"; start "$unit" ;;
        *) ;;
    esac
done
SH
    # curl: GitHub API, архивы и /api/ready — из папки fixtures
    cat >"$bin/curl" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
P="$QUBITE_UPDATE_PREFIX"
F="$P/fixtures"
out="" url=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        -o) out="$2"; shift 2 ;;
        -m|-H|--noproxy) shift 2 ;;
        http*) url="$1"; shift ;;
        *) shift ;;
    esac
done
emit() { if [[ -n $out ]]; then cp "$1" "$out"; else cat "$1"; fi; }
case "$url" in
    */api/ready) [[ -f $P/run/ready ]] && echo '{"status":"ready"}' || exit 7 ;;
    */releases/tags/edge) emit "$F/release.json" ;;
    */check-runs*) echo '{"check_runs":[{"status":"completed","conclusion":"success"}]}' ;;
    */commits/*) echo '{"commit":{"message":"тест"}}' ;;
    https://fake/*) emit "$F/${url#https://fake/}" ;;
    *) echo "curl-заглушка: неизвестный адрес $url" >&2; exit 22 ;;
esac
SH
    chmod +x "$bin"/*
}

# Поддельный qubite. Что делать — по файлам в папке релиза: migrate.sql, BROKEN_MIGRATE, BROKEN_READY.
FAKE_QUBITE='#!/usr/bin/env bash
set -uo pipefail
here="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"
P="$QUBITE_UPDATE_PREFIX"
case "${1:-}" in
    version) echo fake ;;
    notify) exit 0 ;;
    migrate)
        [[ -f $here/BROKEN_MIGRATE ]] && { echo "миграция упала" >&2; exit 1; }
        psql -q -v ON_ERROR_STOP=1 "$DATABASE_URL" -f "$here/migrate.sql" ;;
    serve|bot)
        name="$(basename "$here")-$1"
        n="$(cat "$P/run/$name.last" 2>/dev/null || echo 0)"
        stop=0
        trap "stop=1" TERM
        while [[ $stop == 0 ]]; do
            if psql -qAt "$DATABASE_URL" -c "INSERT INTO writes (src, n) VALUES ('"'"'$name'"'"', $((n + 1)))" >/dev/null 2>&1; then
                n=$((n + 1))
                echo "$n" >"$P/run/$name.last"
                [[ $1 == serve && ! -f $here/BROKEN_READY ]] && touch "$P/run/ready"
            fi
            sleep 0.05
        done
        [[ $1 == serve ]] && rm -f "$P/run/ready"
        exit 0 ;;
esac'

# Релиз: папка releases/<12 знаков> (A — установлен) или архив в fixtures (B — новая сборка).
make_release() {
    local dir="$1" sql="$2"
    mkdir -p "$dir/bin"
    printf '%s\n' "$FAKE_QUBITE" >"$dir/bin/qubite"
    chmod +x "$dir/bin/qubite"
    printf '%s\n' "$sql" >"$dir/migrate.sql"
    echo "Собрано: 2026-11-17T00:00:00Z" >"$dir/RELEASE.txt"
}

# Новая сборка B в fixtures; $2 — что сломать (BROKEN_MIGRATE / BROKEN_READY / пусто).
make_edge() {
    local P="$1" broken="$2" F="$1/fixtures" name="qubite-edge-aarch64-unknown-linux-gnu.tar.gz"
    mkdir -p "$F/src"
    make_release "$F/src/qubite-edge" "ALTER TABLE writes ADD COLUMN IF NOT EXISTS from_b boolean DEFAULT true;"
    [[ -n $broken ]] && touch "$F/src/qubite-edge/$broken"
    tar -czf "$F/$name" -C "$F/src" qubite-edge
    (cd "$F" && sha256sum "$name" >"$name.sha256")
    echo "{\"commit\":\"$B\"}" >"$F/edge.json"
    jq -n --arg n "$name" '{assets: [
        {name: "edge.json", browser_download_url: "https://fake/edge.json"},
        {name: $n, browser_download_url: ("https://fake/" + $n)},
        {name: ($n + ".sha256"), browser_download_url: ("https://fake/" + $n + ".sha256")}]}' >"$F/release.json"
}

# Стенд: стоит версия A, сервер и бот пишут в базу. $1 — имя сценария, $2 — поломка B.
setup() {
    local name="$1" broken="$2"
    P="$WORK/$name"
    DB="qubite_update_test_$name"
    mkdir -p "$P/etc/qubite" "$P/opt/qubite/releases"
    make_stubs "$P"
    createdb -O "$OWNER" "$DB"
    echo "DATABASE_URL=postgres://$PGUSER:$PGPASSWORD@$PGHOST:$PGPORT/$DB" >"$P/etc/qubite/pi.env"
    echo "QUBITE_BIND=127.0.0.1:1" >>"$P/etc/qubite/pi.env"
    make_release "$P/opt/qubite/releases/${A:0:12}" \
        "CREATE TABLE IF NOT EXISTS writes (id bigserial PRIMARY KEY, src text NOT NULL, n int NOT NULL);"
    echo "$A" >"$P/opt/qubite/releases/${A:0:12}/COMMIT"
    ln -s "$P/opt/qubite/releases/${A:0:12}" "$P/opt/qubite/current"
    make_edge "$P" "$broken"
    run_env "$P/opt/qubite/current/bin/qubite" migrate
    run_env systemctl start qubite-serve.service qubite-bot.service
    sleep 1
}

run_env() {
    (
        set -a
        # shellcheck disable=SC1091
        . "$P/etc/qubite/pi.env"
        set +a
        PATH="$P/stubs:$PATH" QUBITE_UPDATE_PREFIX="$P" QUBITE_UPDATE_READY_SECS=4 \
            QUBITE_UPDATE_MAX_LOAD=1000 QUBITE_UPDATE_MIN_MEM_MB=0 QUBITE_DB_OWNER="$OWNER" "$@"
    )
}

update() { run_env bash "$SCRIPT" "$@" >>"$P/update.log" 2>&1; }

sql() { psql -qAt -d "$DB" -c "$1"; }

# Записи писателя $1 с номерами 1…$2 все есть в базе.
kept_upto() {
    local have
    have="$(sql "SELECT count(DISTINCT n) FROM writes WHERE src = '$1' AND n <= $2")"
    [[ $2 -gt 0 && $have == "$2" ]]
}

# Все записи, которые подтвердил писатель $1 (номер в run/<имя>.last), есть в базе.
all_kept() { kept_upto "$1" "$(last_of "$1")"; }
last_of() { cat "$P/run/$1.last" 2>/dev/null || echo 0; }

current() { basename "$(readlink -f "$P/opt/qubite/current")"; }
has_column() { [[ $(sql "SELECT count(*) FROM information_schema.columns WHERE table_name = 'writes' AND column_name = 'from_b'") == 1 ]]; }
saved_dumps() { find "$P/var/backups/qubite/before-restore" -name '*.dump' 2>/dev/null | wc -l; }

# Записи писателя $1 в последнем файле before-restore.
in_saved_dump() {
    local who="$1" file tmpdb="${DB}_saved" n
    file="$(find "$P/var/backups/qubite/before-restore" -name '*.dump' 2>/dev/null | sort | tail -1)"
    [[ -n $file ]] || return 1
    createdb -O "$OWNER" "$tmpdb"
    pg_restore --no-owner -d "$tmpdb" "$file"
    n="$(psql -qAt -d "$tmpdb" -c "SELECT count(*) FROM writes WHERE src = '$who'")"
    dropdb --force "$tmpdb"
    [[ $n -gt 0 ]]
}

# Остановка сервера и бота — раньше снимка базы.
stopped_before_dump() {
    awk '/systemctl stop qubite-bot.service qubite-serve.service/ && !s {s=NR}
         /runuser pg_dump/ && !d {d=NR} END {exit !(s && d && s < d)}' "$P/calls.log"
}

# ---------------------------------------------------------------- сценарии

echo "1. Обновление A → B проходит"
setup ok ""
update
check "стоит B" '[[ $(current) == ${B:0:12} ]]'
check "все записи старого сервера на месте" 'all_kept ${A:0:12}-serve'
check "все записи старого бота на месте" 'all_kept ${A:0:12}-bot'
check "сервер и бот остановлены до снимка" stopped_before_dump
check "миграция B применена" has_column
a_before="$(last_of "${A:0:12}-serve")"
sleep 0.5
check "новая версия пишет" 'all_kept ${B:0:12}-serve && all_kept ${B:0:12}-bot'

echo "   ручной --rollback: версия назад, база как есть"
update --rollback
sleep 0.5
check "стоит A" '[[ $(current) == ${A:0:12} ]]'
check "записи новой версии остались в базе" 'all_kept ${B:0:12}-serve'
check "схема не откатывалась" has_column
check "файла before-restore нет — базу не трогали" '[[ $(saved_dumps) == 0 ]]'

echo "   ручной --rollback --with-db: база из бэкапа, текущая — в файл"
update --rollback --with-db
check "записи новой версии сохранены в before-restore" 'in_saved_dump ${B:0:12}-serve'
check "записи старого сервера до обновления на месте" 'kept_upto ${A:0:12}-serve "$a_before"'
check "схема как до обновления" '! has_column'

echo "2. Новая версия не отвечает /api/ready → автоматический откат"
setup not_ready BROKEN_READY
if update; then bad "update.sh должен завершиться ошибкой"; else ok "update.sh сообщил об ошибке"; fi
check "стоит A" '[[ $(current) == ${A:0:12} ]]'
check "все записи старого сервера на месте" 'all_kept ${A:0:12}-serve'
check "все записи старого бота на месте" 'all_kept ${A:0:12}-bot'
check "схема как до обновления" '! has_column'
check "записи сломанной версии сохранены в before-restore" 'in_saved_dump ${B:0:12}-serve'
check "бот новой версии не запускался" '! grep -q "${B:0:12}-bot" <(sql "SELECT DISTINCT src FROM writes") && [[ ! -f $P/run/${B:0:12}-bot.last ]]'
check "сборка B помечена как не прошедшая" 'grep -q "$B" "$P/var/lib/qubite-update/failed"'
sleep 0.5
check "старая версия снова пишет" 'all_kept ${A:0:12}-serve'

echo "3. Миграция B падает → автоматический откат"
setup migrate_fail BROKEN_MIGRATE
if update; then bad "update.sh должен завершиться ошибкой"; else ok "update.sh сообщил об ошибке"; fi
check "стоит A" '[[ $(current) == ${A:0:12} ]]'
check "все записи старого сервера на месте" 'all_kept ${A:0:12}-serve'
check "все записи старого бота на месте" 'all_kept ${A:0:12}-bot'
sleep 0.5
check "сервер снова работает" '[[ -f $P/run/ready ]]'

if [[ $FAILS -gt 0 ]]; then
    echo "Провалено проверок: $FAILS. Логи:"
    tail -n 40 "$WORK"/*/update.log
    exit 1
fi
echo "Все проверки прошли."
