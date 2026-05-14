#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${QUBITE_REPO_URL:-https://github.com/kirillkuz1122/qubite.git}"
BRANCH="${QUBITE_BRANCH:-main}"
INSTALL_DIR="${QUBITE_INSTALL_DIR:-/var/www/qubiteapp}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "ERROR: run this installer as root." >&2
  echo "Example: curl -fsSL https://raw.githubusercontent.com/kirillkuz1122/qubite/main/deploy/proxy/install-master.sh | bash" >&2
  exit 1
fi

if command -v apt-get >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y ca-certificates curl git
else
  echo "ERROR: this installer currently expects an apt-based Ubuntu/Debian server." >&2
  exit 1
fi

mkdir -p "$(dirname "$INSTALL_DIR")"

if [[ -d "$INSTALL_DIR/.git" ]]; then
  git -C "$INSTALL_DIR" fetch origin "$BRANCH"
  git -C "$INSTALL_DIR" checkout "$BRANCH"
  git -C "$INSTALL_DIR" pull --ff-only origin "$BRANCH"
elif [[ -e "$INSTALL_DIR" && ! -d "$INSTALL_DIR" ]]; then
  echo "ERROR: $INSTALL_DIR already exists and is not a directory." >&2
  echo "Move it away or set QUBITE_INSTALL_DIR to another path." >&2
  exit 1
elif [[ -d "$INSTALL_DIR" && -n "$(find "$INSTALL_DIR" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]]; then
  echo "ERROR: $INSTALL_DIR already exists and is not an empty git checkout." >&2
  echo "Move it away or set QUBITE_INSTALL_DIR to another path." >&2
  exit 1
else
  rm -rf "$INSTALL_DIR"
  git clone --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
fi

cd "$INSTALL_DIR"

if [[ -r /dev/tty ]]; then
  exec </dev/tty
fi

bash deploy/proxy/setup-master-server.sh
