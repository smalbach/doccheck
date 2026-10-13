#!/usr/bin/env bash
# Starts DocCheck locally without Docker: checks every dependency, starts the S3 storage if needed,
# builds and runs the API + web app. See docs/DESPLIEGUE.md.
#
#   scripts/start-local.sh            build and start on PORT (default 3000)
#   scripts/start-local.sh --no-build start the existing build
#   scripts/start-local.sh --check    only check the dependencies
set -uo pipefail
cd "$(dirname "$0")/.."

[ -f .env ] || { echo "✗ Missing .env: cp .env.example .env and fill it in (docs/DESPLIEGUE.md)"; exit 1; }
PORT_FROM_SHELL="${PORT:-}"
set -a; . ./.env; set +a
PORT="${PORT_FROM_SHELL:-${PORT:-3000}}"
export PORT
OLLAMA="${OLLAMA_BASE_URL:-http://localhost:11434}"
fail=0
ok() { echo "✓ $1"; }
bad() { echo "✗ $1"; fail=1; }

# Node
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' && ok "Node $(node -v)" || bad "Node 22+ required (found $(node -v 2>/dev/null))"

# Postgres
if node -e "const {Client}=require('pg');const c=new Client({connectionString:process.env.DATABASE_URL});c.connect().then(()=>c.end()).catch(()=>process.exit(1))" 2>/dev/null; then
  ok "Postgres ($(node -e "const u=new URL(process.env.DATABASE_URL);console.log(u.host+u.pathname)"))"
else
  bad "Postgres not reachable with DATABASE_URL (is the server running and the database created?)"
fi

# Redis (optional: without it extraction runs in-process)
if [ -n "${REDIS_URL:-}" ]; then
  host=$(node -e "const u=new URL(process.env.REDIS_URL);console.log(u.hostname+' '+(u.port||6379))")
  if (exec 3<>/dev/tcp/${host% *}/${host#* }) 2>/dev/null; then ok "Redis ($REDIS_URL)"; else bad "Redis not reachable at $REDIS_URL (brew services start redis, or unset REDIS_URL)"; fi
else
  echo "· Redis not configured: extraction runs in-process, without retries"
fi

# S3 storage (optional: without it PDFs go to STORAGE_DIR)
if [ -n "${S3_ENDPOINT:-}" ]; then
  if curl -s -m 3 -o /dev/null "$S3_ENDPOINT"; then
    ok "S3 storage ($S3_ENDPOINT)"
  elif [[ "$S3_ENDPOINT" == *localhost:${S3_PORT:-9100}* ]] && command -v weed >/dev/null && [ "${1:-}" != "--check" ]; then
    echo "· Starting SeaweedFS (scripts/dev-s3.sh) …"
    mkdir -p .data; nohup scripts/dev-s3.sh > .data/seaweedfs.log 2>&1 &
    for _ in $(seq 1 20); do curl -s -m 1 -o /dev/null "$S3_ENDPOINT" && break; sleep 1; done
    curl -s -m 3 -o /dev/null "$S3_ENDPOINT" && ok "S3 storage started ($S3_ENDPOINT)" || bad "SeaweedFS did not start; see .data/seaweedfs.log"
  else
    bad "S3 storage not reachable at $S3_ENDPOINT"
  fi
else
  echo "· S3 not configured: PDFs are stored in ${STORAGE_DIR:-.data/uploads}"
fi

# Ollama and models
if tags=$(curl -s -m 3 "$OLLAMA/api/tags"); then
  ok "Ollama ($OLLAMA)"
  for m in "${LLM_MODEL:-qwen3.8}" "${EMBED_MODEL:-bge-m3}"; do
    echo "$tags" | grep -q "\"name\":\"$m\(:latest\)\?\"" && ok "  model $m" || bad "  model $m missing: ollama pull $m"
  done
else
  bad "Ollama not reachable at $OLLAMA (open the Ollama app or run: ollama serve)"
fi

# Regulation index
[ -f "data/corpus/index/${EMBED_MODEL:-bge-m3}.json" ] && ok "Regulation index" || bad "Regulation index missing: npm run corpus:index"

# Port
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then bad "Port $PORT is in use (set PORT in .env)"; fi

[ "${1:-}" = "--check" ] && exit $fail
[ $fail -eq 0 ] || { echo; echo "Fix the items above, then run again."; exit 1; }

if [ "${1:-}" != "--no-build" ]; then
  echo "· Building …"
  npm run build >/dev/null || { echo "✗ Build failed: run npm run build to see the errors"; exit 1; }
fi
echo "· Starting on http://localhost:$PORT (Ctrl+C to stop)"
exec node apps/api/dist/main.js
