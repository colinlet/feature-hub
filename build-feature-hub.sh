#!/usr/bin/env bash
# Rebuild web/data/tasks.json from workspace + archive folders.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
CONFIG="${1:-$ROOT/hub.config.json}"
OUT="${2:-$ROOT/web/data/tasks.json}"

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required" >&2
  exit 1
fi

if [[ ! -f "$CONFIG" ]]; then
  echo "config not found: $CONFIG" >&2
  exit 1
fi

exec python3 "$ROOT/server/hub_lib.py" --config "$CONFIG" --out "$OUT"
