# DocCheck API + web app in one image. Models are not included: point OLLAMA_BASE_URL at an
# Ollama server with the extraction model (LLM_MODEL, default qwen3.8) and bge-m3 pulled, or run
# the read-only demo (DEMO_READONLY=true), which replays the cached answers and needs no model
# (fly.toml, docker-compose.demo.yml, docs/DESPLIEGUE.md section 4).
#
#   docker build -t doccheck .                      full app (OCR for scanned PDFs included)
#   docker build --build-arg OCR=false -t doccheck .  demo image: ~65 MB smaller, no OCR

# --- build: compile every workspace (API, web, shared packages) ---
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
RUN npm ci --no-audit --no-fund && npm run build

# --- deps: production dependencies of the API only (no web, Vite or Playwright) ---
FROM node:22-bookworm-slim AS deps
ARG OCR=true
WORKDIR /app
COPY package.json package-lock.json ./
COPY --from=build /app/packages/agent/package.json packages/agent/
COPY --from=build /app/packages/duties/package.json packages/duties/
COPY --from=build /app/packages/extraction/package.json packages/extraction/
COPY --from=build /app/packages/regulations/package.json packages/regulations/
COPY --from=build /app/packages/rules/package.json packages/rules/
COPY --from=build /app/packages/schemas/package.json packages/schemas/
COPY --from=build /app/packages/screening/package.json packages/screening/
COPY --from=build /app/packages/synth/package.json packages/synth/
COPY --from=build /app/apps/api/package.json apps/api/
COPY --from=build /app/apps/web/package.json apps/web/
RUN npm ci --omit=dev --no-audit --no-fund -w @doccheck/api \
 # OCR (Tesseract) only runs on scanned uploads; the read-only demo never uploads, so it can go.
 && if [ "$OCR" = "false" ]; then rm -rf node_modules/tesseract.js node_modules/tesseract.js-core node_modules/@tesseract.js-data; fi \
 && npm cache clean --force

# --- runtime ---
FROM node:22-bookworm-slim
# The demo builds (fly.toml, render.yaml, docker-compose.demo.yml) set this so an image without the
# curated samples fails here instead of publishing an empty demo.
ARG REQUIRE_DEMO_SAMPLES=false
ENV NODE_ENV=production \
    PORT=3000 \
    STORAGE_DIR=/data/uploads
WORKDIR /app
COPY --from=deps /app/package.json ./
COPY --from=deps /app/node_modules ./node_modules
# Workspace packages: node_modules/@doccheck/* link here; only package.json and dist are needed.
COPY --from=build /app/packages/agent/package.json packages/agent/
COPY --from=build /app/packages/agent/dist packages/agent/dist
COPY --from=build /app/packages/duties/package.json packages/duties/
COPY --from=build /app/packages/duties/dist packages/duties/dist
COPY --from=build /app/packages/extraction/package.json packages/extraction/
COPY --from=build /app/packages/extraction/dist packages/extraction/dist
COPY --from=build /app/packages/regulations/package.json packages/regulations/
COPY --from=build /app/packages/regulations/dist packages/regulations/dist
COPY --from=build /app/packages/rules/package.json packages/rules/
COPY --from=build /app/packages/rules/dist packages/rules/dist
COPY --from=build /app/packages/schemas/package.json packages/schemas/
COPY --from=build /app/packages/schemas/dist packages/schemas/dist
COPY --from=build /app/packages/screening/package.json packages/screening/
COPY --from=build /app/packages/screening/dist packages/screening/dist
COPY --from=build /app/apps/api/package.json apps/api/
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/api/migrations apps/api/migrations
COPY --from=build /app/apps/web/dist apps/web/dist
# Regulation corpus and its embedding index (data/corpus/index/*.queries.json holds the citation
# query vectors the demo replays). Evaluation reports feed the Results page.
COPY data/corpus data/corpus
# Duty, tax and exchange-rate tables read by the duty estimate (packages/duties).
COPY data/duties data/duties
COPY eval/reports eval/reports
# Read-only demo: curated samples (npm run demo:build) and the model answers they replay.
COPY data/demo data/demo
COPY eval/cache eval/cache
RUN if [ "$REQUIRE_DEMO_SAMPLES" = "true" ] && [ ! -f data/demo/manifest.json ]; then \
      echo 'data/demo has no samples: run npm run demo:build and commit data/demo, eval/cache and data/corpus/index/*.queries.json' >&2; exit 1; \
    fi
COPY scripts/docker-entrypoint.sh /usr/local/bin/doccheck-entrypoint
# Uploaded PDFs (and the PDFs of the demo samples a visitor loads) go to STORAGE_DIR; mount a volume
# there to keep them across restarts. Everything in /app stays read-only for the app user.
RUN mkdir -p /data/uploads && chown -R node:node /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
# Starts as root only to hand a freshly mounted (root-owned) volume to the node user, then runs the
# API as node (scripts/docker-entrypoint.sh). With --user node it runs as node from the start.
ENTRYPOINT ["doccheck-entrypoint"]
CMD ["node", "apps/api/dist/main.js"]
