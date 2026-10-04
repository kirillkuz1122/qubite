#!/bin/bash
set -euo pipefail
umask 077
exec "$HOME/.hermes/venvs/kwork-parser/bin/python3" "$HOME/.hermes/scripts/kwork_runner.py"
