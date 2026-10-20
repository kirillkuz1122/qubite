#!/usr/bin/env bash
# Локальные PostgreSQL 18 + pgvector в Docker — две отдельные (D-281):
#
#   qubite-dev-db  — порт 55432, база `qubite`: данные `just dev` (owner, дела…).
#                    Лежат в томе Docker `qubite-dev-pgdata` и переживают
#                    перезагрузку, `up`/`down` и любые тесты.
#   qubite-test-db — порт 55433, только для тестов: каждый тест создаёт свою
#                    временную базу `qubite_test_*` и удаляет её. Данные в памяти.
#
#   scripts/dev-db.sh up      — запустить обе (повторный запуск ничего не стирает)
#   scripts/dev-db.sh down    — остановить обе (данные разработки остаются)
#   scripts/dev-db.sh status  — показать состояние
#   scripts/dev-db.sh env     — напечатать переменные (DATABASE_URL, TEST_DATABASE_URL)
#   scripts/dev-db.sh reset   — стереть данные разработки (спросит подтверждение)
#
# Это только для разработки: пароль простой, порты открыты лишь на 127.0.0.1.
set -euo pipefail

IMAGE=pgvector/pgvector:0.8.7-pg18-trixie
DEV=qubite-dev-db
DEV_PORT="${QUBITE_DEV_DB_PORT:-55432}"
DEV_VOLUME=qubite-dev-pgdata
TEST=qubite-test-db
TEST_PORT="${QUBITE_TEST_DB_PORT:-55433}"
DEV_URL="postgres://qubite:qubite@127.0.0.1:${DEV_PORT}/qubite"
TEST_URL="postgres://qubite:qubite@127.0.0.1:${TEST_PORT}/postgres"
# Метка нового устройства: контейнер без неё — старый, с данными в памяти.
LABEL=qubite.dev-db=2

exists() { docker ps -a --format '{{.Names}}' | grep -qx "$1"; }
running() { docker ps --format '{{.Names}}' | grep -qx "$1"; }
labelled() { [ "$(docker inspect -f '{{index .Config.Labels "qubite.dev-db"}}' "$1" 2>/dev/null)" = 2 ]; }

wait_ready() {
  for _ in $(seq 1 60); do
    if docker exec "$1" pg_isready -U qubite -q 2>/dev/null; then
      return 0
    fi
    sleep 0.5
  done
  echo "PostgreSQL ($1) не поднялась за 30 секунд" >&2
  docker logs "$1" | tail -20 >&2
  return 1
}

# Старый qubite-dev-db (до D-281) держал данные в памяти, в базе `postgres`.
# Если он ещё работает — перенести эти данные в новую базу `qubite`, не теряя.
migrate_old_dev() {
  local dump=""
  if running "$DEV"; then
    dump="$(mktemp -t qubite-dev-db.XXXXXX.sql)"
    echo "Старая база разработки (в памяти) — переношу данные в постоянную: $dump"
    docker exec "$DEV" pg_dump -U qubite -d postgres --no-owner --no-privileges >"$dump"
  fi
  docker rm -f "$DEV" >/dev/null
  start_dev
  if [ -n "$dump" ]; then
    docker exec -i "$DEV" psql -U qubite -d qubite -q -v ON_ERROR_STOP=1 >/dev/null <"$dump"
    echo "Перенесено. Копия осталась в $dump — её можно удалить."
  fi
}

start_dev() {
  if running "$DEV"; then
    return 0
  fi
  if exists "$DEV"; then
    docker start "$DEV" >/dev/null
  else
    docker run -d --name "$DEV" --label "$LABEL" --restart unless-stopped \
      -e POSTGRES_USER=qubite -e POSTGRES_PASSWORD=qubite -e POSTGRES_DB=qubite \
      -p "127.0.0.1:${DEV_PORT}:5432" \
      -v "${DEV_VOLUME}:/var/lib/postgresql" \
      "$IMAGE" >/dev/null
  fi
  wait_ready "$DEV"
}

start_test() {
  if running "$TEST"; then
    return 0
  fi
  # Тестовую можно пересоздать в любой момент: своих данных у неё нет.
  docker rm -f "$TEST" >/dev/null 2>&1 || true
  docker run -d --name "$TEST" --label "$LABEL" \
    -e POSTGRES_USER=qubite -e POSTGRES_PASSWORD=qubite \
    -p "127.0.0.1:${TEST_PORT}:5432" \
    --tmpfs /var/lib/postgresql:rw \
    "$IMAGE" >/dev/null
  wait_ready "$TEST"
}

case "${1:-}" in
  up)
    if exists "$DEV" && ! labelled "$DEV"; then
      migrate_old_dev
    else
      start_dev
    fi
    start_test
    echo "Готово: разработка $DEV_URL, тесты $TEST_URL"
    ;;
  down)
    docker stop "$DEV" "$TEST" >/dev/null 2>&1 || true
    echo "Остановлены (данные разработки сохранены в томе $DEV_VOLUME)"
    ;;
  status)
    docker ps -a --filter "name=^${DEV}$" --filter "name=^${TEST}$" \
      --format '{{.Names}} {{.Status}} {{.Ports}}'
    ;;
  env)
    echo "export DATABASE_URL=$DEV_URL"
    echo "export TEST_DATABASE_URL=$TEST_URL"
    ;;
  reset)
    read -r -p "Стереть ВСЕ данные разработки (owner, дела, входящие)? Напиши «да»: " answer
    [ "$answer" = "да" ] || { echo "Отменено"; exit 1; }
    docker rm -f "$DEV" >/dev/null 2>&1 || true
    docker volume rm "$DEV_VOLUME" >/dev/null 2>&1 || true
    start_dev
    echo "Пустая база разработки: $DEV_URL"
    ;;
  *)
    sed -n '2,16p' "$0"
    exit 1
    ;;
esac
