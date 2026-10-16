# DocCheck

**Catch freight document errors before customs does.** DocCheck reads the commercial invoice, packing list, bill of lading and, for US ocean freight, the ISF 10+2 filing, then cross-checks them against each other and against CBSA (Canada) and CBP (US) requirements. A local model copies the values as printed, plain tested code normalizes them, and fifteen deterministic rules do the checking. The model comes back only for the narrow cases a rule cannot settle alone. Every finding links to the exact line in the PDF it comes from and to the regulation passage behind it, and the supplier can be asked for corrected documents without leaving the app. The models run locally: no document goes to an outside AI service.

<p align="center">
  <img src="docs/screenshots/flow.webp" width="900" alt="Opening a sample shipment, validating it, and clicking a finding's evidence: the invoice PDF opens with the cited line highlighted">
</p>

## Results

Measured on synthetic shipments generated from a fixed seed (there is no public labeled set of freight documents); see [Evaluation set](#evaluation-set-phase-1). The table is written by `npm run metrics` (`scripts/metrics.mjs`) from the reports in [`eval/reports`](eval/reports).

<!-- metrics:start -->
| Stage | Metric | Result |
| --- | --- | --- |
| Extraction (ollama:qwen3.8) | Field accuracy, 600 PDFs | 99.8% |
| Classification | Document type | 100.0% |
| Rules on ground truth | Recall / precision on 274 covered errors (of 293 injected) | 100.0% / 100.0% |
| Rules on extracted PDFs | Recall / precision, end to end | 100.0% / 99.7% |
| Extraction, scanned PDFs (OCR) | Field accuracy, 120 PDFs (93 complete enough for the rules) | 81.5% |
| Rules on scanned PDFs | Recall / precision, end to end | 81.8% / 67.5% |
| Extraction, scanned PDFs, Unlimited-OCR (Apple Silicon) | Field accuracy, 120 PDFs (108 complete enough for the rules) | 94.0% |
| Rules on scanned PDFs, Unlimited-OCR | Recall / precision, end to end | 100.0% / 79.6% |
| Extraction, ISF PDFs | Field accuracy, 100 PDFs | 99.9% |
| X11 on extracted ISF PDFs | Recall / precision, end to end | 100.0% / 100.0% |
| Extraction, unseen formats (v2) | Field accuracy, 180 PDFs (177 complete enough for the rules) | 98.8% |
| Rules on v2 PDFs | Recall / precision, end to end | 100.0% / 100.0% |
| Agent | Same consignee written differently (40 cases): verdict / right action | 87.5% / 100.0% (0 wrong, 5 unsure) |
| Agent | BL description vs invoice goods (40 cases): verdict / right action | 100.0% / 100.0% (0 wrong, 0 unsure) |

Details in [docs/METRICS.md](docs/METRICS.md); design and lessons in [docs/WRITEUP.md](docs/WRITEUP.md).
<!-- metrics:end -->

## Screenshots

| | |
| --- | --- |
| ![Findings on a shipment: each one cites its fields and the regulation passage](docs/screenshots/shipment-findings-light.webp) | ![The invoice PDF open on the cited line, highlighted](docs/screenshots/shipment-pdf-viewer.webp) |
| **Findings** with evidence, the fix to make and the CBP or CBSA passage behind it | **PDF viewer** that opens on the cited page with the line highlighted |
| ![Dashboard](docs/screenshots/dashboard-light.webp) | ![Shipments list with status and findings per shipment](docs/screenshots/shipments.webp) |
| **Dashboard**: shipments that need attention at a glance | **Shipments**, filtered and paged on the server |
| ![Extracted data: totals across shipments](docs/screenshots/extracted-data-summary.webp) | ![Every invoice line across shipments, with HS code and origin](docs/screenshots/extracted-data-goods.webp) |
| **Extracted data**: values, weights and origins added up | **Goods**: every invoice line, searchable by description, origin or HS code |
| ![Asking the supplier for corrected documents, drafted from the findings](docs/screenshots/request-compose.webp) | ![A conversation with the supplier: the request, the reply and its corrected PDF](docs/screenshots/conversation.webp) |
| **Ask for corrections**: the email is drafted from the findings, in English, Spanish or French, and sent from the app | **Conversation**: the supplier's reply comes back with its PDF, which goes into the shipment in one click |
| ![Inbox of conversations with suppliers](docs/screenshots/inbox.webp) | ![A company's page: addresses, related companies, products and shipments](docs/screenshots/company.webp) |
| **Inbox**: unread replies, requests awaiting an answer, overdue and failed ones | **Company**: one record however the documents spell it, with everything they say about it |
| ![A product's prices over time and per seller](docs/screenshots/product-prices.webp) | ![Every container on the bills of lading](docs/screenshots/containers.webp) |
| **Product**: price per purchase, per seller and per currency | **Containers**: seal, carrier, vessel and route |
| ![Rule catalog by destination](docs/screenshots/rules.webp) | ![Evaluation page: field accuracy and per-rule recall and precision](docs/screenshots/evaluation-results.webp) |
| **Rules**: what is checked for each destination | **Evaluation**: the measured numbers, inside the app |
| ![Dashboard in dark theme](docs/screenshots/dashboard-dark.webp) | ![Shipment findings in dark theme](docs/screenshots/shipment-findings-dark.webp) |
| Dark theme | Dark theme |

<p align="center">
  <img src="docs/screenshots/mobile-shipment.webp" width="300" alt="A shipment's findings on a phone">
  &nbsp;
  <img src="docs/screenshots/landing.webp" width="560" alt="Landing page">
</p>

Also available: [samples page](docs/screenshots/samples.webp), [companies](docs/screenshots/companies.webp), [products](docs/screenshots/products.webp). The interface is in English, Spanish and French, with light, dark or system theme, and is audited with axe-core (WCAG 2.1 AA) at phone and desktop widths. The images are regenerated with `node scripts/screenshots.mjs` against a running app (`--url`, default `http://localhost:3000`).

## What it does

- **Reads the PDFs**, text layer or scans (OCR with bundled English and French models, or optionally Unlimited-OCR on Apple Silicon), and classifies each one as invoice, packing list, bill of lading or ISF filing confirmation.
- **Extracts typed data with a local model** (Ollama, `qwen3.8`): the model fills a Zod schema with values exactly as printed, and tested code converts them to decimals, ISO dates, kilograms and ISO country codes. A required value the model fills in although the invoice leaves it blank is dropped.
- **Runs 15 deterministic rules** (listed [below](#rules-implemented)): package counts and weights across documents, invoice arithmetic, currency, quantities per SKU, dates, terms of sale vs freight terms, ISO 6346 container check digits, ISF consistency, and the invoice fields CBSA (CI1) and CBP (19 CFR 141.86) require. Money and weights use fixed-point arithmetic, never floats.
- **Asks the model narrow questions only where rules cannot decide**: is a differently written consignee the same company, does the BL cargo description match the invoice goods. Each answer comes with verdict, confidence and rationale; it acts only at confidence ≥ 0.7 (`ACT_CONFIDENCE` in [`packages/agent/src/review.ts`](packages/agent/src/review.ts)) and "unsure" never dismisses a finding.
- **Cites its sources**: every finding points to the page and line of the PDF (opened with the line highlighted), and to a CBSA memorandum or 19 CFR passage found by hybrid search (embeddings + BM25). The model never writes the legal basis.
- **Follows each finding to a decision**: open, waiting for the supplier, accepted risk or false positive (the last two need a reason), with history; a misread value is corrected from the evidence, and the next validation marks new findings and resolved ones ([docs/FINDINGS.md](docs/FINDINGS.md), in Spanish).
- **Talks to the supplier from the app**: the correction request is drafted from the findings in English, Spanish or French, sent over SMTP, and the reply comes back by IMAP or webhook into the same conversation, where its PDF is added to the shipment in one click ([docs/MESSAGING.md](docs/MESSAGING.md), in Spanish).
- **Estimates duties and the landed cost** per line and per shipment: customs value from the invoice and its Incoterm (US transaction value on an FOB basis; Canadian value for duty at the place of direct shipment), HTSUS and Customs Tariff rates loaded from USITC and CBSA, dated tables of Section 301 / 232 / 122 duties and Canadian surtaxes, MPF and HMF, GST and HST, Bank of Canada and Federal Reserve exchange rates, free trade agreement checks (the nine CUSMA data elements, possible savings) and AD/CVD or SIMA cases flagged. What the documents do not say (related party, assists, freight under CIF) becomes a question, and the result prefills a CBP 7501 or CBSA CAD draft, never transmitted ([docs/DUTIES.md](docs/DUTIES.md), in Spanish).
- **Measures itself** on a generated set of 200 labeled shipments (100 per destination, 293 injected errors), field by field and rule by rule, end to end on the extracted PDFs ([docs/METRICS.md](docs/METRICS.md)). Model answers are cached in `eval/cache`, so the evaluation reruns without a model.
- **Works for teams**: organizations with roles (owner, admin, analyst, reviewer, viewer, and clients who read only what is shared with them), invitations by email, assignments, comments with @mentions, notifications in the app and by email, two-step approval of accepted risks and false positives, due dates from the ISF deadline or the ETA with overdue filters, an append-only hash-chained audit log with CSV export, records retention per organization (CBSA 6 years, CBP 5), TOTP two-factor sign-in, OpenID Connect single sign-on and a list of signed-in devices ([docs/ORGANIZATIONS.md](docs/ORGANIZATIONS.md)).
- **Works like a product**: accounts, shipments private to their organization, validation history, JSON export and printable report, aggregated extracted data with companies, products and containers, admin settings changed without a restart, and a read-only demo mode that replays cached model answers.

## Architecture

```mermaid
flowchart LR
  subgraph Web["Web app (React + Vite + Radix UI)"]
    UI[Shipments, findings, PDF viewer, inbox]
  end
  subgraph API["API (NestJS)"]
    Upload[Upload] --> Queue[[BullMQ queue]]
    Queue --> Extract
    subgraph Extract["Extraction"]
      direction LR
      Parse["pdf.js text + positions<br/>OCR for scans"] --> Classify[Classify] --> LLM["LLM: values as printed<br/>(Zod-validated)"] --> Normalize[Normalize in code]
    end
    Normalize --> Rules["15 deterministic rules<br/>+ CA / US profiles"]
    Rules --> Agent["Agent: narrow questions<br/>(verdict, confidence, rationale)"]
    Agent --> Cite["Regulation search<br/>embeddings + BM25"]
    Mail["Supplier mail<br/>outbox, inbound, attachments"] --> Upload
  end
  UI <--> API
  API --- PG[(Postgres + pgvector)]
  API --- S3[(S3-compatible storage<br/>PDFs)]
  Queue --- Redis[(Redis)]
  Mail -.- SMTP{{"SMTP out<br/>IMAP or webhook in"}}
  LLM -.-> Ollama{{"Ollama (local)<br/>qwen3.8 · bge-m3"}}
  Agent -.-> Ollama
  Cite -.-> Ollama
  Cite --- Corpus[/"CBSA memoranda<br/>19 CFR"/]
```

## Tech stack

| Layer | Tools |
| --- | --- |
| Language | TypeScript end to end, npm workspaces monorepo |
| API | NestJS, Zod, BullMQ (Redis), Postgres with pgvector, S3-compatible storage (MinIO / SeaweedFS), nodemailer, ImapFlow and mailparser for supplier mail |
| Documents | pdf.js (text with positions), tesseract.js (OCR), optional Unlimited-OCR server on Apple Silicon, Playwright (renders the synthetic PDFs) |
| Models | Ollama, run locally: `qwen3.8` for extraction and agent decisions, `bge-m3` for embeddings |
| Web | React, Vite, Radix UI, pdf.js viewer with highlights; English, Spanish, French |
| Quality | Unit tests for every rule and normalizer, API end-to-end tests, axe-core accessibility audit in CI, evaluation set with recall and precision per rule |
| Deploy | Docker Compose (app, Postgres, Redis, MinIO; Ollama on the host for the GPU) |

## Run it locally

Needs Node 22+, Docker and [Ollama](https://ollama.com). From a clone of the repository:

```bash
npm install
cp .env.example .env
docker compose up -d                          # Postgres + pgvector, Redis, MinIO
ollama pull qwen3.8 && ollama pull bge-m3
npm run synth                                 # the 200 sample shipments as PDFs (~1 min)
scripts/start-local.sh                        # checks every dependency, builds, serves http://localhost:3000
```

Then create an account, open **Samples**, pick one and press **Validate**.

## Using the app

The landing page is public; create an account to get in. The interface is in English, Spanish and French (a finding says what is wrong and what to do in the interface language; its technical message and the regulation passages stay in English, as the API returns them) with a light, dark or system theme; both are remembered per device. `npm run a11y` audits every page with axe-core (WCAG 2.1 AA) in each language and theme, at phone and desktop widths, and fails on any violation or horizontal overflow. The app has a sidebar with a dashboard, the organization's shipments (each account starts in a personal organization and can create or join others; see [docs/ORGANIZATIONS.md](docs/ORGANIZATIONS.md)), new shipment, samples, the rule catalog by destination, the evaluation numbers and your account (profile, preferences, password, sign out, delete account). A validated shipment can be exported as JSON or printed as a report. Accounts listed in `ADMIN_EMAILS` also get an Administration section: the extraction model (among those installed in Ollama, with their measured accuracy), agent review and OCR settings, changed without a restart; user roles; and the system status. Sign-ups can be closed from Settings, and are limited to 5 per client address and hour. Create a shipment and drop its PDFs, or pick one of the synthetic samples (each lists the errors injected into it). Extraction runs in the background; then **Validate** shows each finding with its evidence, a link that opens the PDF with the cited line highlighted, the regulation passage that backs it and, when the agent was involved, its rationale. When the model misread a value, the extracted-data panel of a document has an **Edit** mode to correct it by hand: the corrected document must still pass its schema, every change is recorded with who made it, the model's values can be restored, and findings that cite a corrected value say so. `DEMO_READONLY=true` runs the same app as a public read-only demo with no model: curated samples from `data/demo` (`npm run demo:build`), model answers replayed from `eval/cache`, and every write refused except loading and validating a sample (see [docs/DESPLIEGUE.md](docs/DESPLIEGUE.md), section 4). For frontend work, `npm run dev:web` serves the app on :5173 with hot reload and proxies the API.

Needs Postgres, Ollama with `qwen3.8` and `bge-m3`, and optionally Redis and S3 storage (see below).

Self-hosted with Docker: `docker compose --profile app up -d --build` runs the app with Postgres, Redis and MinIO; Ollama stays on the host for GPU access. Deployment guide (Spanish): [docs/DESPLIEGUE.md](docs/DESPLIEGUE.md), covering local setup, backups, Docker, a GPU server behind an authenticating proxy, and a planned static read-only demo.

## Development

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

## Repository layout

| Path | What it is |
| --- | --- |
| `packages/schemas` | Zod schemas and TypeScript types for every document and entity, plus a clean sample shipment |
| `packages/rules` | Pure validation rules (no NestJS, no I/O), country profiles (CA, US) and the rule engine |
| `packages/extraction` | PDF text with positions (pdf.js), document classification, LLM extraction with Zod-validated output (Ollama), deterministic normalization, field-level scoring |
| `packages/regulations` | Regulation corpus: chunking, local embeddings (bge-m3 via Ollama), hybrid search (vectors + BM25) with citations |
| `packages/agent` | Citations on findings and model decisions on ambiguous cases (same consignee written differently, BL description vs invoice goods) |
| `packages/duties` | Duty and tax estimate, customs value, landed cost, trade agreement checks and draft entry summaries (CBP 7501, CBSA CAD), pure functions over the rate tables in `data/duties` |
| `packages/synth` | Synthetic shipment generator: ground-truth JSON, labeled error injection, HTML templates rendered to PDF |
| `apps/api` | NestJS API; also serves the web app |
| `apps/web` | Web app (Vite + React + Radix UI): shipments, PDF upload, findings with citations, PDF viewer with highlights. `src/features/<page>` holds one component per file, `src/components/ui` the Radix-based primitives, `src/lib` one helper per file |
| `data/reference` | UN/LOCODE, ISO 3166, ISO 4217 tables (phase 2) |
| `data/corpus` | CBSA memoranda (invoices D1-4-1, marking D11-3-1, proof of origin D11-4-2, valuation D13-4-3 and D13-4-7) and 19 CFR (141.83, 141.86, 141.89, Parts 134 and 149, Part 152 subpart E) as Markdown with URL and effective date, plus the embedding index |
| `data/duties` | Rate tables with source and date: HTSUS and Customs Tariff (`npm run duties:fetch`), Bank of Canada and Federal Reserve exchange rates, and hand-edited additional duties, fees, taxes, AD/CVD cases and trade agreements |
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
| X9 | Invoice shipment date within 7 days of the BL shipped-on-board date | CA, US | Low |
| X10 | Container numbers have a valid ISO 6346 check digit | CA, US | Medium |
| X11 | ISF agrees with the invoice: seller, buyer, country of origin, HTS heading | US | High |
| X12 | Terms of sale agree with the BL freight terms (CIF/CFR: prepaid, FOB/FCA/EXW: collect) | CA, US | Low |
| C1 | Invoice has the fields CBSA requires (CI1 fields 1–17: vendor, consignee, origin, terms of sale, currency, packages, description, quantity, price, total, weights) | CA | per field |
| C2 | Invoice is in English or French | CA | Medium |
| U1 | Invoice has the information 19 CFR 141.86(a) requires (port of entry, time of sale, parties, description, quantity, price, currency, origin) | US | per field |

Completeness rules report one finding per missing field, citing the CI1 field or the 141.86 paragraph. Regulation excerpts are attached by the agent in phase 4.

Money and weights are decimal strings and use fixed-point arithmetic — never JavaScript floats.

## Evaluation set (phase 1)

`npm run synth` builds 200 shipments from a fixed seed: 100 to Canada, 100 to the US (with ISF), 25 clean per country and 75 with 1–3 injected errors. Every shipment has an invoice, packing list and bill of lading rendered to PDF from one of three templates per document (classic, modern, legacy), with English/French invoices for Quebec buyers and BL weights in pounds for part of the US set.

Each injected error has a label with the document, field path, before/after values and the rules expected to flag it for that destination. 274 of the 293 injected errors are covered by a rule; the rest are fields the destination does not require (for example terms of sale on a US invoice) or an error hidden by another one. A test checks that the engine flags exactly the expected rules on all 200 shipments and nothing on the clean versions; `npm run eval:extraction` measures recall and precision per rule on the extracted documents.

`npm run synth -- --set v2` builds a second, smaller set (60 shipments, 16 clean) to check that extraction holds up on formats the prompt was never tuned on: two new layouts per document (a European letterhead with "48.600,00", "1 140,50 kg" and "14.03.2026", and a numbered-box form), line tables of 6 to 40 rows that run onto a second page, and parties with accented, non-English names (French, German, Spanish, Vietnamese, Portuguese, Turkish). The v1 layouts stay in the mix as a control group. Set v1 does not change: a test checks every `truth.json` against the published files.

PDF rendering uses Playwright's Chromium, or the local Chrome when that build is not installed (`npx playwright install chromium`).

## Extraction (phase 2)

Extraction runs on a local model through [Ollama](https://ollama.com); nothing leaves the machine. Start Ollama, pull a model and point `LLM_MODEL` at it (default `qwen3.8`).

1. `pdf-text.ts` reads the PDF text layer with pdf.js and keeps each line's page and bounding box. Cells are padded to their column so tables stay aligned for the model. Pages without a text layer (scans) are rendered and read with OCR (tesseract.js with bundled English and French models, no system install), and come back in the same shape, so citations and highlighting work on scans too.
2. `classify.ts` detects invoice, packing list, bill of lading or ISF filing confirmation from the title and vocabulary.
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
| GET | `/health` | Service status (public) |
| POST | `/auth/register`, `/auth/login`, `/auth/logout` | Accounts: `{ email, password, name }` / `{ email, password }`; the session is an httpOnly cookie. Every other route needs it |
| GET / PATCH | `/auth/me` | The signed-in user; PATCH `{ name }` |
| POST | `/auth/password` | `{ currentPassword, newPassword }`; signs out the other sessions |
| DELETE | `/auth/me` | `{ password }`: deletes the account with its shipments and PDFs (409 while a document is extracting) |
| GET / PUT | `/admin/settings` | Admin: model and OCR settings with where each value comes from; PUT `{ llmModel?, agentEnabled?, ocrLanguages?, ocrScale?, ocrPsm? }` validates all, saves and applies without a restart |
| DELETE | `/admin/settings/:key` | Admin: back to the `.env` value |
| GET | `/admin/models`, `/admin/system` | Admin: installed Ollama models with their measured accuracy; what the server runs with |
| GET / PATCH | `/admin/users`, `/admin/users/:id` | Admin: accounts and `{ role }` (nobody changes their own; the last admin stays) |
| GET | `/rules?destination=CA` | Active rules for a destination |
| POST | `/shipments` | Create a shipment: `{ reference?, destination: "CA" \| "US", transportMode? }` |
| GET | `/shipments` | The user's shipments, a page at a time: `?status=all\|open\|attention\|done&destination=CA\|US&q=text&limit=25&offset=0` → `{ items, total, limit, offset, summary }` (`summary` counts every shipment per status group) |
| GET | `/shipments/:id` | Shipment and status |
| PATCH | `/shipments/:id` | `{ reference?, destination?, transportMode? }`. The destination is refused while documents extract and, leaving the US, while the ISF was entered by hand (409); one read from a PDF is set aside and comes back with the US |
| DELETE | `/shipments/:id` | Delete the shipment with its documents, PDFs, extractions, ISF and findings (409 while extracting) |
| GET | `/insights/summary` | The extracted data of all the user's shipments added up: invoiced value per currency, gross and net kg, packages, containers, quantities per unit, and lines and value per country of origin and per HS subheading (`?destination=`) |
| GET | `/insights/lines` | Every commercial invoice line with its shipment: `?q=text&origin=CN&hs=9503&destination=CA&limit=50&offset=0` |
| GET | `/insights/shipments` | Per shipment: invoice, parties, incoterm, value, packages, weights, B/L, vessel, ports and containers (`?q=` also finds a container or B/L number) |
| GET | `/results` | Summary of the evaluation reports in `eval/reports`, for the web app's results page |
| PUT / GET / DELETE | `/shipments/:id/isf` | The shipment's ISF (10+2) as JSON, used by X11 on US shipments. GET says where it came from (`source`: `upload`, `sample` or `pdf` with `documentId`) |
| POST | `/shipments/:id/documents` | Upload PDFs (multipart field `files`): invoice, packing list, bill of lading or ISF filing confirmation (stored as the shipment's ISF). Returns 202 with the documents `QUEUED`; `?wait=true` waits for extraction |
| POST | `/shipments/:id/documents/:documentId/reextract` | Extract again as a given type `{ type }` (including `ISF`) when classification got it wrong. Values corrected by hand and their history are dropped |
| GET | `/shipments/:id/documents/:documentId` | Document status (`QUEUED`, `EXTRACTING`, `EXTRACTED`, `FAILED`) and, once extracted, values as printed, normalized document (with corrections), issues and `corrected` (paths corrected by hand, with the model's value) |
| PATCH | `/shipments/:id/documents/:documentId/data` | Correct extracted values by hand: `{ changes: [{ path: "/lines/0/quantity/value", value: "120" }] }` (JSON pointers; `null` removes an optional field). The whole document must still pass its schema (400 with `issues`, nothing saved); 409 while extracting. Each change is recorded, an ISF read from this PDF follows, and the shipment goes back to `RECEIVED` until validated again. Findings mark evidence on a corrected value with `corrected: true` |
| GET | `/shipments/:id/documents/:documentId/corrections` | History of the corrections, oldest first: path, old and new value, `edit` or `revert`, who and when |
| POST | `/shipments/:id/documents/:documentId/data/revert` | Put back the values the model read (recorded in the history as `revert`) |
| POST | `/shipments/:id/validate` | Run the rules on the extracted documents (409 while any is still extracting), or on normalized JSON documents in the body `{ invoice?, packingList?, billOfLading?, isf? }`; then citations and agent review (`?agent=false` skips the model) |
| GET | `/shipments/:id/validation` | The last validation run with its findings and the destination it ran against |
| GET | `/shipments/:id/validations` | Every validation run, newest first, with findings counted by severity; `/validations/:validationId` is one run with its findings |
| GET | `/shipments/:id/findings` | Findings from the last validation |
| GET | `/shipments/:id/duties` | Duty, taxes and landed cost per line and in total, with the findings that need an answer and the draft entry summary (`entry`, never transmitted) |
| PUT / POST | `/shipments/:id/duties/inputs`, `/duties/preview` | Save the answers the documents do not give (related party, assists, freight, preference claimed, full tariff numbers…) and recalculate, or recalculate without saving |

Documents passed as JSON in the body of `/validate` take precedence over extracted ones, which keeps the phase 0 flow working for tests.

Finding decisions (`POST /shipments/:id/findings/review`) are described in [docs/FINDINGS.md](docs/FINDINGS.md), and the supplier mail routes (`/mail/...`) in [docs/MESSAGING.md](docs/MESSAGING.md).

## Roadmap

| Phase | Weeks | Deliverable |
| --- | --- | --- |
| 0 · Foundation | 1 | Monorepo, schemas, CI — done |
| 1 · Synthetic data | 2–3 | 200 labeled shipments (100 per country) — done |
| 2 · Parsing + extraction | 4–5 | Typed extraction from PDFs, field-level accuracy measured, Postgres, object storage, queue — done |
| 3 · Rule engine | 6–7 | Shared rules + CA and US completeness profiles, recall and precision measured — done |
| 4 · Agent + RAG | 8–10 | Agent for ambiguous rules, regulation search with citations, local call tracing — done (evaluation running) |
| 5 · Portfolio | 11–12 | Deployed demo, metrics table, write-up — metrics, write-up and results page done; demo pending |

## Disclaimer

DocCheck is a portfolio and learning project. It is not customs advice and does not file anything with CBSA or CBP.

## License

[MIT](LICENSE) © 2026 Snheidert Smalbach
