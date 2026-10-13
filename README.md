# DocCheck

An agent that cross-checks freight documents — commercial invoice, packing list, bill of lading and (for US ocean imports) the ISF 10+2 — and flags inconsistencies **before** they reach customs in Canada (CBSA) or the United States (CBP). Every finding cites the exact document field it comes from.

> Status: **phase 4 of 6**. Schemas, rule engine, a synthetic evaluation set of 200 labeled shipments rendered to PDF, and extraction from PDF with a local model (Ollama) measured field by field. The API accepts PDFs, extracts them and runs the rules with page-level citations. Shipments, documents, extractions and findings are stored in Postgres, PDFs in S3-compatible storage, and extraction runs in a BullMQ queue. Phase 3 added country completeness rules (CBSA, CBP) and more cross-document checks. Phase 4 added regulation search with citations (CBSA D1-4-1, 19 CFR 141.86 and Part 149) and an agent that reviews ambiguous cases with the local model. The deployed demo comes next.

## How it works

```
PDFs ──► parsing ──► extraction (LLM + Zod) ──► normalization ──► rules ──► agent (ambiguous cases) ──► report
                                                                    ▲              │
                                                         country profile     CBSA / CBP regulation (RAG)
```

Deterministic rules do most of the work; the agent only decides cases where literal comparison fails (company names written differently, cargo descriptions, ISF consistency).

## Repository layout

| Path | What it is |
| --- | --- |
| `packages/schemas` | Zod schemas and TypeScript types for every document and entity, plus a clean sample shipment |
| `packages/rules` | Pure validation rules (no NestJS, no I/O), country profiles (CA, US) and the rule engine |
| `packages/extraction` | PDF text with positions (pdf.js), document classification, LLM extraction with Zod-validated output (Ollama), deterministic normalization, field-level scoring |
| `packages/regulations` | Regulation corpus: chunking, local embeddings (bge-m3 via Ollama), hybrid search (vectors + BM25) with citations |
| `packages/agent` | Citations on findings and model decisions on ambiguous cases (same consignee written differently, BL description vs invoice goods) |
| `packages/synth` | Synthetic shipment generator: ground-truth JSON, labeled error injection, HTML templates rendered to PDF |
| `apps/api` | NestJS API; also serves the web app |
| `apps/web` | Web app (Vite + React): shipments, PDF upload, findings with citations, PDF viewer with highlights |
| `data/reference` | UN/LOCODE, ISO 3166, ISO 4217 tables (phase 2) |
| `data/corpus` | CBSA D1-4-1 (en, fr), 19 CFR 141.86 and Part 149 as Markdown with URL and effective date, plus the embedding index |
| `data/eval/v1` | Evaluation set: `truth.json` + `labels.json` per shipment (committed), PDFs (generated, git-ignored) |
| `scripts/smoke.mjs` | End-to-end smoke test against the built API |

## Rules implemented

| ID | Rule | Applies to | Severity |
| --- | --- | --- | --- |
| X1 | Consignee matches between invoice and BL (after normalizing case, punctuation, abbreviations, legal form) | CA, US | Medium |
| X2 | Package count matches across invoice, packing list and BL | CA, US | High |
| X3 | Gross weight matches between packing list and BL (0.5% tolerance, configurable) | CA, US | Medium |
| X4 | Net weight is not greater than gross weight | CA, US | Medium |
| X5 | Quantity × unit price = line total; lines sum to the invoice total | CA, US | High |
| X6 | Every amount on the invoice uses the declared currency | CA, US | Medium |
| X7 | Invoice quantities match the packing list, per SKU | CA, US | High |
| X8 | Packing list refers to the invoice number | CA, US | Low |
| X10 | Container numbers have a valid ISO 6346 check digit | CA, US | Medium |
| X11 | ISF agrees with the invoice: seller, buyer, country of origin, HTS heading | US | High |
| C1 | Invoice has the fields CBSA requires (CI1 fields 1–17: vendor, consignee, origin, terms of sale, currency, packages, description, quantity, price, total, weights) | CA | per field |
| C2 | Invoice is in English or French | CA | Medium |
| U1 | Invoice has the information 19 CFR 141.86(a) requires (port of entry, time of sale, parties, description, quantity, price, currency, origin) | US | per field |

Completeness rules report one finding per missing field, citing the CI1 field or the 141.86 paragraph. Regulation excerpts are attached by the agent in phase 4.

Money and weights are decimal strings and use fixed-point arithmetic — never JavaScript floats.

## Demo

```bash
scripts/start-local.sh          # checks Postgres, Redis, S3, Ollama and models, then builds and serves http://localhost:3000
```

Create a shipment and drop its PDFs, or pick one of the synthetic samples (each lists the errors injected into it). Extraction runs in the background; then **Validate** shows each finding with its evidence, a link that opens the PDF with the cited line highlighted, the regulation passage that backs it and, when the agent was involved, its rationale. For frontend work, `npm run dev:web` serves the app on :5173 with hot reload and proxies the API.

Needs Postgres, Ollama with `qwen3.8` and `bge-m3`, and optionally Redis and S3 storage (see below).

## Results

<!-- metrics:start -->
| Stage | Metric | Result |
| --- | --- | --- |
| Extraction (ollama:qwen3.8) | Field accuracy, 18 PDFs | 99.4% |
| Classification | Document type | 100.0% |
| Rules on ground truth | Recall / precision on 274 covered errors (of 293 injected) | 100.0% / 100.0% |
| Rules on extracted PDFs | Recall / precision, end to end | 100.0% / 100.0% |
| Agent | Same consignee written differently (40 cases): verdict / right action | 87.5% / 100.0% (0 wrong, 5 unsure) |
| Agent | BL description vs invoice goods (40 cases): verdict / right action | 100.0% / 100.0% (0 wrong, 0 unsure) |

Details in [docs/METRICS.md](docs/METRICS.md); design and lessons in [docs/WRITEUP.md](docs/WRITEUP.md).
<!-- metrics:end -->

Self-hosted with Docker: `docker compose --profile app up -d --build` runs the app with Postgres, Redis and MinIO; Ollama stays on the host for GPU access. Deployment guide (Spanish): [docs/DESPLIEGUE.md](docs/DESPLIEGUE.md), covering local setup, backups, Docker, a GPU server behind an authenticating proxy, and a planned static read-only demo. The app has no authentication of its own.

## Getting started

Requires Node 22+.

```bash
npm install
npm run build
npm test          # schema and rule tests
npm run smoke     # starts the API, validates a shipment with one injected error
npm run test:e2e -w @doccheck/api   # API end to end against the doccheck_test database (reset on every run)
npm run synth     # regenerates data/eval/v1 (200 shipments + PDFs, ~1 min)
npm run eval:extraction -- --limit 10   # extracts 10 shipments with the local model and writes eval/reports
npm run dev       # API with hot reload on http://localhost:3000
```

The API needs Postgres. Copy `.env.example` to `.env` and point `DATABASE_URL` at a local server (create the database first) or start the bundled one; migrations in `apps/api/migrations` run when the API starts, or with `npm run db:migrate -w @doccheck/api`.

```bash
cp .env.example .env
docker compose up -d   # Postgres + pgvector, Redis, MinIO (optional if you run them yourself)
```

Without Docker: any local Postgres and Redis work, and `scripts/dev-s3.sh` starts SeaweedFS as S3-compatible storage on port 9100 (`brew install seaweedfs`). Without `S3_ENDPOINT` PDFs go to `.data/uploads`; without `REDIS_URL` extraction runs in-process with no retries.

## Evaluation set (phase 1)

`npm run synth` builds 200 shipments from a fixed seed: 100 to Canada, 100 to the US (with ISF), 25 clean per country and 75 with 1–3 injected errors. Every shipment has an invoice, packing list and bill of lading rendered to PDF from one of three templates per document (classic, modern, legacy), with English/French invoices for Quebec buyers and BL weights in pounds for part of the US set.

Each injected error has a label with the document, field path, before/after values and the rules expected to flag it for that destination. 274 of the 293 injected errors are covered by a rule; the rest are fields the destination does not require (for example terms of sale on a US invoice) or an error hidden by another one. A test checks that the engine flags exactly the expected rules on all 200 shipments and nothing on the clean versions; `npm run eval:extraction` measures recall and precision per rule on the extracted documents.

PDF rendering uses Playwright's Chromium, or the local Chrome when that build is not installed (`npx playwright install chromium`).

## Extraction (phase 2)

Extraction runs on a local model through [Ollama](https://ollama.com); nothing leaves the machine. Start Ollama, pull a model and point `LLM_MODEL` at it (default `qwen3.8`).

1. `pdf-text.ts` reads the PDF text layer with pdf.js and keeps each line's page and bounding box. Cells are padded to their column so tables stay aligned for the model.
2. `classify.ts` detects invoice, packing list or bill of lading from the title and vocabulary.
3. The model fills a "raw" Zod schema with values **as printed** (`"1,140.00"`, `"14-MAR-2026"`, `"2,513 LB"`). Its output is validated against the schema, with one retry on mismatch.
4. `normalize.ts` turns printed values into canonical types in plain, tested code: decimals, ISO dates, pounds to kilograms, country names to ISO codes, units.
5. Findings cite page and bbox: `findSource` locates each evidence value in the PDF lines.

`npm run eval:extraction` scores extraction field by field against `truth.json`, by document type, template and field, and reruns the rules on the extracted documents to measure detection against the injected errors. Model responses are cached in `eval/cache/<model>/`, so a rerun with the same prompt is instant and `LLM_CACHE_MODE=replay` runs the evaluation without a model.

## Agent and regulation search (phase 4)

After the rules run, `/validate` does a second pass:

1. **Citations.** Each finding gets the passage of the destination's regulations that backs it, found by hybrid search over the corpus (embeddings from `bge-m3` plus BM25, merged by reciprocal rank fusion). A passage is attached only when the keyword search also ranks it in the top 5, and rules the corpus does not cover (ISO 6346 container numbers) get none.
2. **Agent decisions** with the local model, each returned with verdict, confidence and rationale:
   - X1 found different consignee names: are they the same company written differently? A confident "yes" dismisses the finding; otherwise it stays with the rationale.
   - A1 (agent rule): is the BL cargo description consistent with the invoice goods? A confident "no" adds a finding with `decidedBy: AGENT`.

`npm run eval:agent` measures both decisions on cases with a known answer built from the synthetic set. `npm run corpus:fetch` refreshes the regulations and `npm run corpus:index` re-embeds them. Model calls are logged to the `llm_calls` table.

## API

| Method | Route | Description |
| --- | --- | --- |
| GET | `/health` | Service status |
| GET | `/rules?destination=CA` | Active rules for a destination |
| POST | `/shipments` | Create a shipment: `{ reference?, destination: "CA" \| "US", transportMode? }` |
| GET | `/shipments/:id` | Shipment and status |
| PUT / GET / DELETE | `/shipments/:id/isf` | The shipment's ISF (10+2) as JSON, used by X11 on US shipments |
| POST | `/shipments/:id/documents` | Upload PDFs (multipart field `files`). Returns 202 with the documents `QUEUED`; `?wait=true` waits for extraction |
| GET | `/shipments/:id/documents/:documentId` | Document status (`QUEUED`, `EXTRACTING`, `EXTRACTED`, `FAILED`) and, once extracted, values as printed, normalized document and issues |
| POST | `/shipments/:id/validate` | Run the rules on the extracted documents (409 while any is still extracting), or on normalized JSON documents in the body `{ invoice?, packingList?, billOfLading?, isf? }`; then citations and agent review (`?agent=false` skips the model) |
| GET | `/shipments/:id/findings` | Findings from the last validation |

Documents passed as JSON in the body of `/validate` take precedence over extracted ones, which keeps the phase 0 flow working for tests.

## Roadmap

| Phase | Weeks | Deliverable |
| --- | --- | --- |
| 0 · Foundation | 1 | Monorepo, schemas, CI — done |
| 1 · Synthetic data | 2–3 | 200 labeled shipments (100 per country) — done |
| 2 · Parsing + extraction | 4–5 | Typed extraction from PDFs, field-level accuracy measured, Postgres, object storage, queue — done |
| 3 · Rule engine | 6–7 | Shared rules + CA and US completeness profiles, recall and precision measured — done |
| 4 · Agent + RAG | 8–10 | Agent for ambiguous rules, regulation search with citations, local call tracing — done (evaluation running) |
| 5 · Portfolio | 11–12 | Deployed demo, metrics table, write-up |

## Disclaimer

DocCheck is a portfolio and learning project. It is not customs advice and does not file anything with CBSA or CBP.
