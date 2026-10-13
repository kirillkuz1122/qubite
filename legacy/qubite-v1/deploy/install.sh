#!/usr/bin/env bash
set -euo pipefail
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_REPOSITORY_DIR="$(cd "$REPO_DIR/../.." && pwd)"
export REPO_DIR
export QUBITE_LEGACY_ENV_FILE="${QUBITE_LEGACY_ENV_FILE:-$SOURCE_REPOSITORY_DIR/deploy/.env}"
plan=false
while (($#)); do
 case "$1" in
  --plan) plan=true; shift ;;
  --env-file) [[ $# -ge 2 && -n $2 ]] || { echo 'Нужен путь после --env-file' >&2; exit 2; }; export QUBITE_LEGACY_ENV_FILE="$2"; shift 2 ;;
  --help) echo 'Legacy installer: bash legacy/qubite-v1/deploy/install.sh [--plan] [--env-file /private/file]'; exit 0 ;;
  *) echo 'Неизвестный аргумент' >&2; exit 2 ;;
 esac
done
if [[ $plan == true ]]; then
 python3 - "$REPO_DIR" "$SOURCE_REPOSITORY_DIR" "$QUBITE_LEGACY_ENV_FILE" <<'PY'
import json, pathlib, sys
site, repository, config = map(pathlib.Path, sys.argv[1:])
print(json.dumps({'component':'tournaments', 'kind':'standalone-legacy', 'source':str(site),
 'backend':str(site/'back/server.js'), 'frontend':str(site/'index.html'),
 'search_reference':str(repository/'services/search'), 'writing_reference':str(repository/'integrations/qubite-writing'),
 'env_file_exists':config.is_file(), 'shared_core_identity':False, 'mutations':False}))
PY
 exit 0
fi
if [[ $EUID -ne 0 ]]; then echo 'Запуск: sudo bash legacy/qubite-v1/deploy/install.sh'; exit 1; fi
echo 'Установка старого самостоятельного Qubite Tournaments. Это не installer Qubite 2.0.'
read -r -p 'Самостоятельная турнирная платформа? [Y/n] ' choice_platform
read -r -p 'Поиск SearXNG с ИИ? [Y/n] ' choice_search
read -r -p 'Хранилище AliasVault? [Y/n] ' choice_vault
read -r -p 'Редактор LanguageTool (Java, около 500–700 МБ RAM)? [y/N] ' choice_writing
read -r -p 'Входящие подключения: 1 — белый IP / Nginx, 2 — Cloudflare Tunnel [2]: ' choice_ingress
choice_vpn=n
if [[ $choice_ingress == 1 ]]; then
 read -r -p 'Эта машина также VPN-нода? [y/N] ' choice_vpn
else
 echo 'Cloudflare: эта машина — управляющий сервер; отдельные VPN-ноды можно добавлять позже.'
fi
export INSTALL_PLATFORM=true INSTALL_SEARCH=true INSTALL_VAULT=true INSTALL_VPN=false INSTALL_WRITING=false INGRESS_MODE=cloudflare SERVICES_VPN_ENABLED=false
[[ ${choice_platform,,} =~ ^(n|нет)$ ]] && INSTALL_PLATFORM=false
[[ ${choice_search,,} =~ ^(n|нет)$ ]] && INSTALL_SEARCH=false
[[ ${choice_vault,,} =~ ^(n|нет)$ ]] && INSTALL_VAULT=false
[[ ${choice_writing,,} =~ ^(y|yes|да)$ ]] && INSTALL_WRITING=true
[[ ${choice_vpn,,} =~ ^(y|yes|да)$ ]] && INSTALL_VPN=true
[[ $choice_ingress == 1 ]] && INGRESS_MODE=direct
if [[ $INSTALL_PLATFORM == false && ( $INSTALL_SEARCH == true || $INSTALL_VAULT == true || $INSTALL_WRITING == true ) ]]; then
 echo 'Старые Search/Writing/Vault требуют legacy platform; это не новые модули Qubite 2.0.'; exit 1
fi
if [[ $INSTALL_PLATFORM == false && $INSTALL_SEARCH == false && $INSTALL_VAULT == false && $INSTALL_VPN == false && $INSTALL_WRITING == false ]]; then
 echo 'Компоненты не выбраны. Изменений нет.'; exit 0
fi
if [[ $INSTALL_VPN == true ]]; then
 export SERVICES_VPN_ENABLED=true
 echo 'VPN настраивается старым мастер-установщиком: он меняет Nginx, Caddy, firewall и sing-box.'
 echo 'Для занятой машины рекомендуем отдельный proxy node. Перед продолжением проверь существующие сервисы.'
 read -r -p 'Ввести VPN для установки с изменением сетевой конфигурации: ' confirm_vpn
 [[ $confirm_vpn == VPN ]] || exit 1
 bash "$REPO_DIR/deploy/proxy/setup-master-server.sh"
fi
bash "$REPO_DIR/deploy/services/install.sh"
