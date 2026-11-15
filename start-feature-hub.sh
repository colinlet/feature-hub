#!/usr/bin/env bash
# Start Feature Hub local server (default: hub.config.json).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
CONFIG="${1:-$ROOT/hub.config.json}"
EXAMPLE="$ROOT/hub.config.example.json"

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required" >&2
  exit 1
fi

if [[ ! -f "$CONFIG" ]]; then
  if [[ "$CONFIG" == "$ROOT/hub.config.json" && -f "$EXAMPLE" ]]; then
    cp "$EXAMPLE" "$CONFIG"
    echo "Created $CONFIG from hub.config.example.json" >&2
    echo "Edit workspace / knowledge / tools paths, then run again." >&2
    echo "  workspace must already exist (e.g. mkdir -p ~/workspace)" >&2
    exit 1
  fi
  echo "config not found: $CONFIG" >&2
  echo "Copy the example first:" >&2
  echo "  cp hub.config.example.json hub.config.json" >&2
  exit 1
fi

HOST="$(CONFIG_PATH="$CONFIG" python3 -c 'import json,os; print(json.load(open(os.environ["CONFIG_PATH"])).get("host","127.0.0.1"))')"
PORT="$(CONFIG_PATH="$CONFIG" python3 -c 'import json,os; print(json.load(open(os.environ["CONFIG_PATH"])).get("port",9527))')"
URL="http://${HOST}:${PORT}"

if [[ "$HOST" != "127.0.0.1" && "$HOST" != "localhost" ]]; then
  echo "WARNING: host is '$HOST' (not loopback). Feature Hub has no auth;" >&2
  echo "         do not expose this service on untrusted networks." >&2
fi

echo "Starting Feature Hub..."
echo "  config: $CONFIG"
echo "  open:   $URL"

# Open browser shortly after bind (best-effort, macOS).
if command -v open >/dev/null 2>&1; then
  (sleep 0.4 && open "$URL") >/dev/null 2>&1 &
fi

exec python3 "$ROOT/server/hub_server.py" --config "$CONFIG"
