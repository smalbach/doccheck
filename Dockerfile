# DocCheck API + web app in one image. Models are not included: point OLLAMA_BASE_URL at an
# Ollama server with the extraction model (LLM_MODEL, default qwen3.8) and bge-m3 pulled.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
RUN npm ci
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=3000
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/migrations ./apps/api/migrations
COPY --from=build /app/apps/web/dist ./apps/web/dist
# Regulation corpus and its embedding index; the evaluation set enables the demo samples when mounted.
COPY data/corpus ./data/corpus
EXPOSE 3000
USER node
CMD ["node", "apps/api/dist/main.js"]
