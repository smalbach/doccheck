#!/bin/sh
# Container entrypoint (Dockerfile). Volumes on Fly.io and fresh bind mounts are owned by root: when
# started as root, make STORAGE_DIR writable for the node user, then run the command as node.
set -e
if [ "$(id -u)" = "0" ]; then
  dir="${STORAGE_DIR:-/data/uploads}"
  mkdir -p "$dir"
  chown node:node "$dir"
  exec setpriv --reuid=node --regid=node --init-groups -- "$@"
fi
exec "$@"
