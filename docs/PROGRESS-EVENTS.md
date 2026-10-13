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
| Web: hook, state, UI | `apps/web/src/features/shipment/useShipmentEvents.ts`, `apps/web/src/lib/progressTimeline.ts`, `liveFindings.ts`, `validationCaption.ts`, `progressSteps.ts`, `progressAnnouncement.ts`, `RunSteps.tsx`, `DocumentProgress.tsx`, `ValidationProgress.tsx`, `AgentQuestionList.tsx`, `AgentQuestionItem.tsx`, `LiveFindingList.tsx`, `LiveFindingItem.tsx`, `DismissedFindings.tsx`, `ProgressAnnouncer.tsx` |

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
  ephemeral?: true;       // live only, never stored: the model's answer as it is written (id is then 0)
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
| `extracting` | `extractFromText`: the model call | started `{ model, documentType }`; **ephemeral** progress while the answer is written `{ delta, offset, tokens, tokensPerSecond?, restart?, replay? }` (see [Live model output](#live-model-output-ephemeral-events)); done adds `{ cached, inputTokens?, outputTokens? }` |
| `normalizing` | `extractFromText` | done: `{ normalized, issues }` |
| `saved` | `DocumentProcessor` around `saveExtraction` | done: `{ documentType, normalized, pages }` |

A blank PDF (no text even with OCR) or an unsupported type goes from `reading` straight to `saved`.

### Validation (`kind: 'validation'`, no `documentId`, `runId` = validation id)

| Stage | Detail |
| --- | --- |
| `started` | Instant marker, status `started` only: `{ agent, destination }` |
| `rules` | started: `{ documents }` (how many documents the rules read); progress per rule, in order: `{ rule, index, total, skipped, findings, found? }` (skipped: a document is missing; `found`: previews of the findings it produced, see below); done: `{ ran, skipped, total, findings }` |
| `citations` | started: `{ findings }` (how many will be looked up); progress per finding that got a regulation quote: `{ findingId, title }` (passage title cut to 120 chars); done: `{ citations }`; skipped `reason: 'no-index'`; failed when the index or embedder fails (then `agent` is skipped with `reason: 'citations-failed'`) |
| `agent` | started `{ model, total }` (questions it will ask); progress per question, twice: asked `{ index, total, ruleId, question, findingId? }`, then answered with `answer: { verdict, confidence, rationale, effect }` (rationale cut to 500 chars); `findingId` is the finding the question is about (X1); a finding the agent adds comes on the answer as `findingId` + `added` (a preview); done `{ decisions }`; skipped `reason: 'disabled'`; failed with `error` (the validation still ends with `saved` done: the rule findings stand) |
| `saved` | done: `{ validationId, findings, skipped, agent: 'done' | 'skipped' | 'failed' }` |

**Finding previews** (`FindingPreview`, `findingPreview()` in `@doccheck/schemas`): `{ id, severity, message }`,
the message cut to 200 chars (`FINDING_MESSAGE_CHARS`), at most 8 per rule (`FINDING_PREVIEWS_PER_RULE`; `findings`
keeps the full count). The `id` is the one the stored finding keeps (`<shipmentId>:<ruleId>:<n>`), so the web
can follow a finding through citations and the agent, and match it with the saved validation. With these
limits a rule event stays around 2 KB, well under the NOTIFY limit.

## Publishing from code

Packages never import Nest. Pipeline functions take an optional callback typed
`ProgressCallback<ExtractionDetail>` or `ProgressCallback<Pick<ValidationDetail, 'agent'>>`:

- `extractDocument(bytes, llm, type?, { onProgress })`, `extractFromText(pdf, type, llm, onProgress?)`,
  `readPdfText(bytes, { onProgress })` (`@doccheck/extraction`)
- `reviewFindings(ctx, findings, llm, index?, onProgress?)` and `countAgentQuestions(ctx, findings)` (`@doccheck/agent`)
- `runRules(ctx, params, { onRule })` (`@doccheck/rules`): a plain per-rule hook (with the rule's `found` findings), mapped to `rules` progress by the API.
- `attachRegulations(findings, destination, index, onCited?)` (`@doccheck/agent`): called and awaited per finding that got a passage, mapped to `citations` progress.

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
- `GET /events`: every shipment of the signed-in user (for an activity panel). Without a position, the
  backlog is the user's latest 50 events.

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
- `applyEvent` also builds `run.findings` for a validation (`liveFindings.ts`, `applyFindingEvent`): each rule's
  previews, the regulation title from the citations, the question and effect from the agent (kept / dismissed /
  added, with the rationale). Agent questions keep `askedAt` / `answeredAt` and the `findingId`.
- Findings card: while a validation runs, and after it is saved until the stored validation is fetched
  (`liveValidationRun`), the card shows the live findings instead of the stored ones (`LiveFindingList`): a card
  slides in when its rule finds it, its regulation line fades in, a dismissed one fades and is struck through
  with the agent's reason, an added one slides in. Once the stored validation (the source of truth) has the
  run's id, the stored cards replace them in the same order; the findings the agent dismissed, which the
  stored validation does not keep, are listed under them from the events (`DismissedFindings`). The stored
  validation and the shipment's status are fetched together, so no stale banner flashes in between.
- `ValidationProgress` shows one plain-language line per stage (`validationCaption`: "Checking 13 rules across
  the 3 documents", "Looking up the regulation behind each finding", "Asking the local model about 1 ambiguous
  case", "Saving the results") and the agent's questions (`AgentQuestionItem`): rule, question, "Thinking… 4 s",
  then the verdict with a confidence bar, rationale, effect and a "Show the finding" button that scrolls to the
  finding card, focuses it and flashes it (`showFinding`). One line says when the agent was off, failed or had
  nothing to ask. The card is not a live region while findings arrive (`aria-live="off"`); the announcer keeps
  speaking only milestones. Entrance, fade and flash animations are off under `prefers-reduced-motion`.
- UI: `DocumentProgress` under each document (steps while running; "Extracted in 32 s · OCR 4.2 s · Model 28 s"
  afterwards, expandable); `ValidationProgress` at the top of the findings card (live panel, then "Last run
  took 41 s", expandable with the agent's questions and answers). Neither is a live region:
  `ProgressAnnouncer` (polite) speaks only milestones (a document going to the model and ending, a validation
  starting, reaching the agent, ending). Spinners stop under `prefers-reduced-motion`.
- Notifications (`apps/web/src/features/notifications/`): `RunNotifications`, in the signed-in shell, opens
  `GET /events` and, for **live** events only (after `ready`, never the backlog), tells when a run ends
  (`saved`; a failure with `willRetry` is not an end): a radix toast unless that shipment's page is open,
  and a browser notification when the tab is hidden and the viewer opted in (Account → Preferences,
  `localStorage` `doccheck.notifyInBackground`, permission asked on that click only). Runs ending within
  ~1 s of each other, or while the previous toast of the same shipment is up, become one toast
  ("3 documents of CA-014 extracted"). The tab title counts runs under way ("(2) DocCheck") and shows
  "✓ DocCheck" after one ended in the background.
- Validate: the stream is open for the whole shipment page, so the blocking `POST /shipments/:id/validate`
  (unchanged for scripts and tests) shows its stages live while it runs.

## Live model output (ephemeral events)

While the model writes its answer (stage `extracting`), the shipment page shows the JSON forming.

- **LLM client** (`packages/extraction/src/llm.ts`): `llm.call(version, req, { onChunk })` streams. The
  Ollama provider then uses `stream: true` and reads the newline-delimited JSON (`readNdjson`); without
  `onChunk` nothing changes (`stream: false`, as the evaluation CLIs call it). The cache is unchanged: it
  stores the final, schema-checked answer only. A cache hit with `onChunk` is replayed as a stream
  (`replayAsStream`: the answer's indented JSON in chunks, with the cached output token count spread over
  them), at once, or over `llm.replayMs` (the read-only demo sets 2.5 s). A retry after an answer that did
  not match the schema sends a `restart` chunk first.
- **Throttle** (`packages/extraction/src/stream.ts`, `throttleOutput`): the chunks (one per token) become
  progress updates of `extracting`: the first at once, then at most one every 300 ms, each carrying the
  text written since the previous one (`delta`), where it starts (`offset`), the tokens so far and the
  speed. A delta is at most 1500 characters (longer ones are split), so its NOTIFY payload stays far below
  the 8000-byte limit; the last one is sent before the stage's `done`.
- **Not stored** (the choice): these updates are marked `ephemeral`. `ProgressService.publish` only
  NOTIFYs them (same queue, so they never overtake earlier events), with `id: 0` and `userId: null`; they
  are never inserted, so they are not replayed on reconnect, never fill a backlog (the 1000-event replay, the
  activity panel's latest 50) and need no pruning. An ephemeral event too large for a NOTIFY payload is
  dropped (it could not be read back by id). The SSE frame has no `id:` line, so it does not move the
  client's `Last-Event-ID`. Only `GET /shipments/:id/events` sends them; `GET /events` filters them out.
  Trade-off: a page opened or reloaded mid-answer sees the text from the next delta on (shown after "…").
- **Web**: `applyEvent` routes ephemeral events to `state.outputs[documentId]` (`lib/liveOutput.ts`:
  `applyOutput` joins deltas by offset, skips repeats, starts over on `restart`, a new run or a gap), never
  to the run's steps; a new `extracting` start or the run's `saved` end drops it. `useShipmentEvents` does
  not pass them to `lastLive`, so the announcer never sees them. `LiveOutputPanel` (under the steps in
  `DocumentProgress`) shows the text in monospace with the token count and tokens/s (or "replayed from
  cache"); it is open by default (the choice is remembered), follows the end unless the user scrolled up,
  is a labelled focusable region and **not** a live region; its caret stops blinking under reduced motion.
- **PDF viewer**: opened on a document that is being extracted, it outlines where the value the model just
  finished is printed: the last completed string value of the JSON so far (`lastCompletedValue`), searched
  in the page lines that pdf.js reads from the PDF in the browser (`groupLines`, `findValue`: from the
  previous match on, as the model mostly follows the reading order; values shorter than 3 characters are
  skipped). The stored `pdfLines` cannot be used: they are saved with the extraction, after the model is
  done. Values are copied as printed, so most are found; a normalized or multi-line value is not, and the
  outline stays where it was.
- **Agent answers** (validation stage `agent`) do not stream yet: `reviewFindings` could pass `onChunk` the
  same way, but its questions are short JSON verdicts and the agent's live panel belongs to the findings
  card; the client and the throttle are ready for it.

## Read-only demo pacing

The demo replays model answers from a cache, so stages end in milliseconds. With `DEMO_READONLY=true` (and
unless `DEMO_PACING=false`), a run waits before reporting the end of some stages and adds the wait to their
duration: reading 0.5 s, OCR 0.8 s, classifying 0.3 s, normalizing 0.3 s; rules 0.3 s, citations 0.3 s,
each answered agent question 1.8 s, the agent's end 1.2 s (so its last answer stays on screen); and, so
findings appear one at a time, each rule 0.15 s (0.5 s when it found something) and each regulation quote
0.35 s (`apps/api/src/progress/demo-pacing.ts`). The model stage has no wait: the cached answer is replayed
as a stream over 2.5 s (`DEMO_REPLAY_MS`), so visitors see it written. A paced run reports its updates in
line (`ProgressRun`), so waits add up even for the rule hook, which does not await; the time spent in line
counts in the stage's duration. The work itself is slowed the same way, so the timeline and the results stay
consistent. The e2e suite sets `DEMO_PACING=false`.

## Tests

- `packages/schemas/src/progress.test.ts`: stage helpers, envelope schema.
- `packages/extraction`, `packages/agent`, `packages/rules`: the events each pipeline reports.
- `packages/extraction/src/stream.test.ts`: the NDJSON parser and Ollama streaming, the throttle, the cache
  replayed as a stream, the ephemeral deltas of `extractFromText`.
- `apps/api/test/progress.test.mjs`: NOTIFY parsing, SSE framing (ephemeral too), resume position, pacing
  (and paced updates in line), failing a run.
- `apps/api/test/e2e.test.mjs` (`progress events`): live order of a validation, rule finding previews with the stored ids, one citation event per cited finding, Last-Event-ID / `?after=`
  replay, 404 for another user, 401 without a session, `/events` limited to the user's shipments, and the
  extraction stages of uploaded PDFs (when the evaluation PDFs are present); `PDF upload`: the deltas of a
  live extraction add up to the stored answer, without SSE ids, and are neither stored nor sent on `/events`.
- `apps/web/src/lib/progressTimeline.test.ts`: the web's state, steps and announcements.
- `apps/web/src/lib/liveOutput.test.ts`: joining deltas, the last completed value, PDF lines and matching.
- `apps/web/src/lib/liveFindings.test.ts`, `validationCaption.test.ts`: live findings, agent status, captions,
  and when the card shows the live run.
