#!/usr/bin/env bash
# Локальная PostgreSQL 18 + pgvector для разработки и тестов (в Docker).
#
#   scripts/dev-db.sh up      — запустить (порт 55432)
#   scripts/dev-db.sh down    — остановить и удалить контейнер (данные тоже)
#   scripts/dev-db.sh status  — показать состояние
#   scripts/dev-db.sh env     — напечатать переменные для тестов
#
# Это только для разработки: пароль простой, порт открыт лишь на 127.0.0.1.
set -euo pipefail

NAME=qubite-dev-db
IMAGE=pgvector/pgvector:0.8.7-pg18-trixie
PORT="${QUBITE_DEV_DB_PORT:-55432}"
URL="postgres://qubite:qubite@127.0.0.1:${PORT}/postgres"

case "${1:-}" in
  up)
    if docker ps --format '{{.Names}}' | grep -qx "$NAME"; then
      echo "Уже запущена: $URL"
      exit 0
    fi
    docker rm -f "$NAME" >/dev/null 2>&1 || true
    docker run -d --name "$NAME" \
      -e POSTGRES_USER=qubite -e POSTGRES_PASSWORD=qubite \
      -p "127.0.0.1:${PORT}:5432" \
      --tmpfs /var/lib/postgresql:rw \
      "$IMAGE" >/dev/null
    for _ in $(seq 1 60); do
      if docker exec "$NAME" pg_isready -U qubite -q 2>/dev/null; then
        echo "Готово: $URL"
        exit 0
      fi
      sleep 0.5
    done
    echo "PostgreSQL не поднялась за 30 секунд" >&2
    docker logs "$NAME" | tail -20 >&2
    exit 1
    ;;
  down)
    docker rm -f "$NAME" >/dev/null 2>&1 && echo "Остановлена" || echo "Не была запущена"
    ;;
  status)
    docker ps --filter "name=^${NAME}$" --format '{{.Names}} {{.Status}} {{.Ports}}'
    ;;
  env)
    echo "export TEST_DATABASE_URL=$URL"
    ;;
  *)
    sed -n '2,9p' "$0"
    exit 1
    ;;
esac
