#!/usr/bin/env bash
# Opens the ngrok tunnel to the local app with basic auth, using NGROK_URL and NGROK_BASIC_AUTH
# ("user:password", 8+ character password) from .env. See docs/DESPLIEGUE.md.
#
#   scripts/tunnel.sh          start in the background (log in .data/ngrok.log)
#   scripts/tunnel.sh stop
set -euo pipefail
cd "$(dirname "$0")/.."
if [ "${1:-}" = "stop" ]; then pkill -f "ngrok http" && echo "Tunnel stopped." || echo "No tunnel running."; exit 0; fi
set -a; . ./.env; set +a
: "${NGROK_URL:?Set NGROK_URL in .env}"
: "${NGROK_BASIC_AUTH:?Set NGROK_BASIC_AUTH=user:password in .env (the app has no login of its own)}"
pkill -f "ngrok http" 2>/dev/null || true
mkdir -p .data
nohup ngrok http "${PORT:-3000}" --url "$NGROK_URL" --basic-auth "$NGROK_BASIC_AUTH" --log stdout > .data/ngrok.log 2>&1 &
for _ in $(seq 1 20); do grep -q "started tunnel" .data/ngrok.log && break; sleep 0.5; done
grep -q "started tunnel" .data/ngrok.log || { echo "ngrok did not start; see .data/ngrok.log"; exit 1; }
echo "Tunnel: $NGROK_URL -> localhost:${PORT:-3000} (user: ${NGROK_BASIC_AUTH%%:*}, password in .env)"
