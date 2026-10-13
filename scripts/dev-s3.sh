#!/usr/bin/env bash
# Local S3-compatible object storage for development, using SeaweedFS (brew install seaweedfs).
# MinIO's Homebrew build crashes on Apple M5 and the project is archived upstream; docker compose
# still offers MinIO when Docker is available. Credentials must match S3_ACCESS_KEY / S3_SECRET_KEY.
set -euo pipefail
cd "$(dirname "$0")/.."
DATA=.data/seaweedfs
mkdir -p "$DATA"
cat > "$DATA/s3.json" <<JSON
{ "identities": [ { "name": "doccheck",
    "credentials": [ { "accessKey": "${S3_ACCESS_KEY:-doccheck}", "secretKey": "${S3_SECRET_KEY:-doccheck-secret}" } ],
    "actions": ["Admin", "Read", "Write", "List", "Tagging"] } ] }
JSON
exec weed server -dir="$DATA" -ip=127.0.0.1 -ip.bind=127.0.0.1 \
  -master.port=19333 -volume.port=18080 -filer.port=18888 \
  -s3 -s3.port="${S3_PORT:-9100}" -s3.config="$DATA/s3.json"
