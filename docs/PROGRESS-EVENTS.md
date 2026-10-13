# Progress events

DocCheck reports what it is doing while it extracts a document or validates a shipment. Each step is a
**progress event**: stored in Postgres, delivered live over server-sent events (SSE), and replayed to a
client that reconnects or reloads. This document is the contract between the code that publishes events,
the API that delivers them, and the web app that shows them.

## Where things live

| Piece | File |
| --- | --- |
| Types, Zod envelope, stage helpers (`startStage`, `withStage`, `report`) | `packages/schemas/src/progress.ts` |
| Table | `apps/api/migrations/012_progress_events.sql` (`progress_events`) |
| Publishing, LISTEN/NOTIFY fan-out, pruning | `apps/api/src/progress/progress.service.ts` |
| A run being reported (ids, open stages, demo pacing) | `apps/api/src/progress/progress-run.ts` |
| SQL | `apps/api/src/progress/progress.repository.ts` |
| SSE routes | `apps/api/src/progress/progress.controller.ts`, framing in `sse.ts` |
| Estimates (typical stage durations) | `apps/api/src/progress/progress-estimates.service.ts` |
| Cancelling an extraction | `ShipmentsService.cancelExtraction`, `DocumentProcessor.cancel`, `ExtractionQueue.remove` |
| Web: activity panel (user-wide stream) | `apps/web/src/features/activity/` (`ActivityProvider`, `ActivityIndicator`, `ActivityPanel`, `ActivityItem`), `apps/web/src/lib/activity.ts` (state, place in line, time left), `activityAnnouncement.ts`, `eventStream.ts` |
| Web: hook, state, UI | `apps/web/src/features/shipment/useShipmentEvents.ts`, `apps/web/src/lib/progressTimeline.ts`, `progressSteps.ts`, `progressAnnouncement.ts`, `RunSteps.tsx`, `DocumentProgress.tsx`, `ValidationProgress.tsx`, `ProgressAnnouncer.tsx` |

The types are defined once, in `@doccheck/schemas`. The web imports them with `import type` (re-exported
from `apps/web/src/api/types.ts`), so no runtime code or Zod reaches its bundle. The stage order the web
needs at runtime is in `apps/web/src/lib/progressSteps.ts`, checked against the types with `satisfies`.

## Event shape

```ts
{
  id: number;             // bigserial: storage order, the SSE id, what Last-Event-ID / ?after= refer to
  shipmentId: string;
  userId: string | null;  // owner of the shipment (filled by the API)
  documentId?: string;    // extraction events only
  runId: string;          // one extraction of a document, or one validation (= the stored validation's id)
  kind: 'extraction' | 'validation';
  stage: string;          // see below; must belong to the kind
  status: 'started' | 'progress' | 'done' | 'failed' | 'skipped';
  at: string;             // ISO time the event happened
  durationMs?: number;    // on done and failed: time since the stage started
  detail: object;         // small, typed per stage (see below)
}
```

- **started**: the stage began. **progress**: a step inside it (an OCR page, a rule, an agent question).
  **done / failed / skipped**: the stage ended. A stage ends once.
- Every detail may also carry `error` (on failed), `reason` (on skipped: `'type-given'`, `'no-index'`,
  `'disabled'`, `'citations-failed'`, or `'retry'` on a re-queued extraction) and `willRetry` (on a failed
  extraction the queue will run again).
- **Every run ends with a `saved` event**, `done` or `failed`. When an error happens outside a stage, the
  run fails its open stages and then `saved`. A `saved` failure with `willRetry: true` is followed by a
  `queued` start (reason `'retry'`) of the same run; the web keeps such a run "running".

## Stages

### Extraction (`kind: 'extraction'`, with `documentId`)

| Stage | Who reports | Detail |
| --- | --- | --- |
| `queued` | started by `ExtractionQueue.enqueue` (`{ position }`, 1 = next); done by the processor when it picks the job up (`durationMs` = time in line) | `{ position? }` |
| `reading` | `extractDocument` around `readPdfText`. Includes OCR time | done: `{ pages, ocrPages? }` |
| `ocr` | `readPdfText`, **only if a page had no text layer** | started `{ pages }`; progress `{ page, pages }` per page (PDF page numbers); done `{ pages, ocrPages, confidence }` |
| `classifying` | `extractDocument`; skipped with `reason: 'type-given'` when the user chose the type | done/skipped: `{ documentType, confidence }` |
| `extracting` | `extractFromText`: the model call | started `{ model, documentType }`; done adds `{ cached, inputTokens?, outputTokens? }` |
| `normalizing` | `extractFromText` | done: `{ normalized, issues }` |
| `saved` | `DocumentProcessor` around `saveExtraction` | done: `{ documentType, normalized, pages }` |

A blank PDF (no text even with OCR) or an unsupported type goes from `reading` straight to `saved`.

### Validation (`kind: 'validation'`, no `documentId`, `runId` = validation id)

| Stage | Detail |
| --- | --- |
| `started` | Instant marker, status `started` only: `{ agent, destination }` |
| `rules` | progress per rule, in order: `{ rule, index, total, skipped, findings }` (skipped: a document is missing); done: `{ ran, skipped, total, findings }` |
| `citations` | done: `{ citations }` (findings that got a regulation quote); skipped `reason: 'no-index'`; failed when the index or embedder fails (then `agent` is skipped with `reason: 'citations-failed'`) |
| `agent` | started `{ model, total }` (questions it will ask); progress per question, twice: asked `{ index, total, ruleId, question }`, then answered with `answer: { verdict, confidence, rationale, effect }` (rationale cut to 500 chars); done `{ decisions }`; skipped `reason: 'disabled'`; failed with `error` (the validation still ends with `saved` done: the rule findings stand) |
| `saved` | done: `{ validationId, findings, skipped, agent: 'done' | 'skipped' | 'failed' }` |

## Publishing from code

Packages never import Nest. Pipeline functions take an optional callback typed
`ProgressCallback<ExtractionDetail>` or `ProgressCallback<Pick<ValidationDetail, 'agent'>>`:

- `extractDocument(bytes, llm, type?, { onProgress })`, `extractFromText(pdf, type, llm, onProgress?)`,
  `readPdfText(bytes, { onProgress })` (`@doccheck/extraction`)
- `reviewFindings(ctx, findings, llm, index?, onProgress?)` and `countAgentQuestions(ctx, findings)` (`@doccheck/agent`)
- `runRules(ctx, params, { onRule })` (`@doccheck/rules`): a plain per-rule hook, mapped to `rules` progress by the API.

Inside a package, report a stage with the helpers from `@doccheck/schemas`:

```ts
const result = await withStage(onProgress, 'extracting', () => llm.call(...), (r) => ({ model, cached: r.cached }), { model });

const ocr = await startStage(onProgress, 'ocr', { pages });
await ocr.progress({ page: 2, pages });
await ocr.done({ confidence: 87 });   // or ocr.fail(err) / ocr.skip({ reason })
```

The helpers time the stage (`durationMs`), end it only once, await the callback (so the API can pace the
demo) and swallow anything the callback throws: progress never breaks the work.

In the API, get a run and hand its `report` to the packages:

```ts
const run = this.progress.run('extraction', shipmentId, { documentId, runId });   // ProgressService
await extractDocument(bytes, llm, type, { onProgress: run.report });
await run.emit({ stage: 'saved', status: 'done', detail: { ... } });
// on error:
await run.fail(err, 'saved', { willRetry });   // fails open stages, then saved
```

`ProgressService.publish(event)` stores the event and NOTIFYs; calls are chained so ids follow call order
within a process, and it never throws (a failed insert is logged and dropped). `flush()` waits for the
pending ones. Adding a stage or a detail field: extend the types in `packages/schemas/src/progress.ts`
(and `EXTRACTION_STAGES` / `VALIDATION_STAGES` plus the web's step lists if it is a new stage). Detail
fields are optional by design; keep them small (a NOTIFY payload must stay under 8000 bytes; larger events
are announced by id and read back from the table).

## Delivery

- Every API process `LISTEN`s on channel `doccheck_progress` with a dedicated `pg` client (the extraction
  worker may be another process: BullMQ with `EXTRACTION_WORKER=false`). The payload is the event JSON, or
  `{ "id": n }` when too large. Events fan out in memory through an RxJS `Subject` (`ProgressService.events`).
- The LISTEN client reconnects with backoff (1 s doubling to 30 s) and, once back, reads the events stored
  meanwhile from the table. An event delivered twice is dropped by id.
- Rows older than `PROGRESS_RETENTION_DAYS` (default 7) are deleted at start and every hour (index on `at`).
  Rows also go with their shipment or document (`on delete cascade`).

## SSE endpoints

Both need a session (global `AuthGuard`, 401 otherwise). They are GETs, so the same-origin guard and the
read-only demo guard let them through.

- `GET /shipments/:id/events`: one shipment, behind `ShipmentOwnerGuard` (404 for someone else's shipment).
  Without a position, the backlog is **the latest run of each document and the latest validation**, enough
  to draw the timelines on page load.
- `GET /events`: every shipment of the signed-in user (the activity panel). Without a position, the
  backlog is every event of the user's runs still going (an event in the last 6 hours) and of their 10
  latest ended runs (in the last day): whole runs, oldest event first.
- `GET /events/estimates` (JSON, not a stream): typical stage durations on this server, for "about 40 s
  left" (`ProgressEstimates` in `@doccheck/schemas`). Medians over the last 7 days of progress events
  that ended (`done`; `skipped` counts as 0 ms): per extraction stage (`reading` without scans), per OCR
  page, per validation stage, per agent question, and the model call per model id (`models`) with the
  model the next extraction will use (`model`). The model call only counts calls that ran the model
  (`cached: false`), from progress events when there are 3 or more, else from `llm_calls` (30 days); in
  the read-only demo only the cached, paced calls count. Durations only, no ids; computed at most once a
  minute. Clients decide how many `samples` are enough (the web wants 3).
- `GET /events/labels?shipments=<ids>&documents=<ids>` (JSON): reference and destination of the user's
  shipments, file name and status of their documents, among the comma-separated ids given (100 each at
  most). Other users' ids are left out silently.

Position: the `Last-Event-ID` header (sent by `EventSource` on its own reconnects) wins over `?after=<id>`.
With either, the backlog is every event after that id (at most 1000).

Stream format (`text/event-stream`, `Cache-Control: no-cache, no-transform`, `X-Accel-Buffering: no`,
headers flushed at once):

```
retry: 3000

id: 1234
data: {"id":1234,"kind":"validation","stage":"rules",...}

event: ready
data: {"lastId":1240}

: ping
```

Progress events are unnamed messages (`onmessage`). `ready` comes once the backlog is sent: what follows is
live. A `: ping` comment every 20 s keeps proxies from closing the connection. Live events that arrive while
the backlog is read are held and sent after it, without duplicates. On shutdown every stream is ended so the
HTTP server can close.

## Cancelling an extraction

`POST /shipments/:id/documents/:documentId/cancel` (owner only, 404 otherwise; 409 unless the document is
QUEUED or EXTRACTING; 403 in the read-only demo like every write) answers the document as it is then.

- **Waiting in line**: `documents.status` goes QUEUED → FAILED with error `Cancelled by the user` in one
  statement (only if still QUEUED), the BullMQ job is removed if it is waiting or delayed (in-process: the
  job is dropped from the in-memory line), and the run ends: `queued` failed, then `saved` failed with
  `{ error: 'Cancelled by the user', reason: 'cancelled' }`. A worker that already took the job finds the
  document not QUEUED (`claimDocument`) and leaves it.
- **Running**: the API asks every process to stop it: `NOTIFY doccheck_cancel, '<documentId>'` (heard on
  the progress LISTEN connection, `ProgressService.cancelRequests`), and aborts it at once if it runs in
  this process. `DocumentProcessor` gives each extraction an `AbortController`, registered before it
  claims the document; its signal goes to `extractDocument(..., { signal })`, which checks it between
  stages and OCR pages and passes it to the model call (`fetch` to Ollama is aborted). The stage in
  progress fails, the document ends FAILED (`Cancelled by the user`), `saved` fails with `reason:
  'cancelled'`, and the job is not retried (BullMQ: `UnrecoverableError`). When the extraction runs in
  this process the response waits for it to stop (5 s at most); a worker elsewhere stops on its own.
- A document is FAILED rather than a new status, so everything that reads `DocumentStatus` keeps working;
  re-extracting it starts a new run.
- Limit: a cancel NOTIFY sent while a worker's LISTEN connection is down is lost; that extraction ends normally.

On start, the in-process mode marks documents a previous process left QUEUED or EXTRACTING as FAILED and
ends their open runs with a failed `saved` (so no panel shows them running forever).

Known limit: events from two processes can be committed out of id order, so a client resuming after id N
could miss an event with a smaller id committed later. The safety poll on the web covers it.

## Consuming it in the web

- `useShipmentEvents(shipmentId, onEvent)` opens an `EventSource` on `/shipments/:id/events` (same origin;
  the Vite dev server proxies `/events` and `/shipments`). The browser reconnects by itself with
  `Last-Event-ID`; when the server refuses or ends the stream, the hook opens a new one with `?after=`.
  After two failed attempts in a row `connection` becomes `'fallback'`.
- `useShipment` refreshes the shipment when a live event says a document started or ended, and the
  validation when one ends (from another tab, too). It polls every 2 s while documents extract and the
  stream is not open, every 15 s as a safety net when it is.
- `applyEvent(state, event)` (pure, idempotent) keeps the latest run per document and the latest validation;
  `stepsOf(run)` turns a run into stepper rows (pending / running / done / failed / skipped with a note and a
  duration). A retry (`queued` or `reading` started again in the same run) starts the steps over.
- UI: `DocumentProgress` under each document (steps while running; "Extracted in 32 s · OCR 4.2 s · Model 28 s"
  afterwards, expandable); `ValidationProgress` at the top of the findings card (live panel, then "Last run
  took 41 s", expandable with the agent's questions and answers). Neither is a live region:
  `ProgressAnnouncer` (polite) speaks only milestones (a document going to the model and ending, a validation
  starting, reaching the agent, ending). Spinners stop under `prefers-reduced-motion`.
- Activity panel: `ActivityProvider` (in `AppShell`, signed-in pages only) opens the one `/events`
  stream of the app (`openEventStream`, same reconnection rules) and keeps `ActivityState`: one
  `RunTimeline` per run id (with its shipment), every running run and the 10 latest finished. Other
  components can listen to that stream with `useActivityEvents(handler)` instead of opening another one
  (the shipment page still opens its own `/shipments/:id/events`, whose backlog is different). Names come
  from `/events/labels`, asked once per new id. `ActivityIndicator` (sidebar; mobile top bar) shows "2
  running" while anything runs, with the accessible name "2 tasks running", and opens a radix Popover
  (focus moves to the panel; Escape closes): per run "CA-014 · invoice.pdf", what it does now with the
  time in that step ("Extracting with the model (28 s)", "Agent question 2 of 4", "Waiting in line, #2"),
  the time left and a Cancel button (extractions, not in the demo); then the recently finished runs with
  their outcome, each linking to its shipment. Its polite live region speaks only when runs start ("2 tasks
  running") or end, and stays quiet about the shipment page being shown (that page has its own announcer).
- Time left (`remainingMs`, from `/events/estimates`, fetched when the panel opens and every minute while
  something runs): the rest of the current step plus the typical time of each step ahead (the model call
  of the run's model; OCR per page; agent questions left). None while queued, when any step ahead has
  fewer than 3 samples, when the current step runs over 1.25 times its usual time (+5 s), or above an hour;
  never negative. Shown rounded ("about 40 s left", "a few seconds left" under 10 s).
- Place in line: the `position` given when queued, minus the user's runs queued before it that have left
  the line since (other users' jobs are not visible, so it can only be too high).
- Validate: the stream is open for the whole shipment page, so the blocking `POST /shipments/:id/validate`
  (unchanged for scripts and tests) shows its stages live while it runs.

## Read-only demo pacing

The demo replays model answers from a cache, so stages end in milliseconds. With `DEMO_READONLY=true` (and
unless `DEMO_PACING=false`), a run waits before reporting the end of some stages and adds the wait to their
duration: reading 0.5 s, OCR 0.8 s, classifying 0.3 s, model 2.5 s, normalizing 0.3 s; rules 0.7 s,
citations 0.5 s, each answered agent question 1.8 s (`apps/api/src/progress/demo-pacing.ts`). The work
itself is slowed the same way, so the timeline and the results stay consistent. The e2e suite sets
`DEMO_PACING=false`.

## Tests

- `packages/schemas/src/progress.test.ts`: stage helpers, envelope schema.
- `packages/extraction`, `packages/agent`, `packages/rules`: the events each pipeline reports.
- `apps/api/test/progress.test.mjs`: NOTIFY parsing, SSE framing, resume position, pacing, failing a run.
- `apps/api/test/e2e.test.mjs` (`progress events`): live order of a validation, Last-Event-ID / `?after=`
  replay, 404 for another user, 401 without a session, `/events` limited to the user's shipments, and the
  extraction stages of uploaded PDFs (when the evaluation PDFs are present).
- `apps/web/src/lib/progressTimeline.test.ts`: the web's state, steps and announcements.
- `apps/web/src/lib/activity.test.ts`: activity state, place in line, time left, announcements.
- `apps/api/test/progress.test.mjs` (`progress estimates`): which model calls count.
- `apps/api/test/e2e.test.mjs` (`cancel extraction`, `activity`): cancelling a queued document and a
  running one in another process (a worker built from the API's classes, NOTIFY), owner only and blocked in
  the demo; the `/events` backlog (runs still going and the 10 latest ended); labels limited to the user;
  estimates (median per model, no ids, 401 without a session).
- `packages/extraction` (`progress`): an aborted model call rejects at once with the reason.
