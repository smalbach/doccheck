import { Inject, Injectable } from '@nestjs/common';
import type { ActivityLabels, NewProgressEvent, ProgressEvent } from '@doccheck/schemas';
import type { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';

/** Channel of the NOTIFY sent for every stored event (payload: the event, or { id } when too large). */
export const PROGRESS_CHANNEL = 'doccheck_progress';

/** Channel of the NOTIFY asking whichever process runs a document's extraction to stop it (payload: document id). */
export const CANCEL_CHANNEL = 'doccheck_cancel';

/** Events replayed at most per (re)connection; a client that is further behind reloads the page data anyway. */
export const REPLAY_LIMIT = 1000;

interface Row {
  id: string;
  shipment_id: string;
  user_id: string | null;
  org_id: string | null;
  document_id: string | null;
  run_id: string;
  kind: ProgressEvent['kind'];
  stage: ProgressEvent['stage'];
  status: ProgressEvent['status'];
  at: Date;
  duration_ms: number | null;
  detail: Record<string, unknown>;
}

/** A run whose last event is one of these has ended (a `saved` failure the queue retries has not). */
const RUN_ENDED = `stage = 'saved' and (status = 'done' or (status = 'failed' and coalesce(detail->>'willRetry', 'false') <> 'true'))`;

/** Grouped durations of one kind of step, for the estimates. */
export interface DurationRow {
  kind: string;
  stage: string;
  model: string;
  cached: boolean;
  samples: number;
  ms: number;
}

const COLUMNS = 'id, shipment_id, user_id, org_id, document_id, run_id, kind, stage, status, at, duration_ms, detail';

/** A stored event carries the shipment's organization, for the organization-wide stream. */
export type OrgProgressEvent = ProgressEvent & { orgId?: string | null };

function toEvent(r: Row): ProgressEvent {
  return {
    id: Number(r.id),
    shipmentId: r.shipment_id,
    userId: r.user_id,
    orgId: r.org_id,
    ...(r.document_id ? { documentId: r.document_id } : {}),
    runId: r.run_id,
    kind: r.kind,
    stage: r.stage,
    status: r.status,
    at: r.at.toISOString(),
    ...(r.duration_ms !== null ? { durationMs: r.duration_ms } : {}),
    detail: r.detail,
  } as ProgressEvent;
}

/** progress_events: insert (with the shipment's owner), replay after an id, prune. */
@Injectable()
export class ProgressRepository {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /**
   * Stores an event and notifies listeners, in one statement. The owner comes from the shipment; null
   * when the shipment (or the document) is gone, in which case nothing is stored.
   */
  async insert(e: NewProgressEvent, notifyMax: number): Promise<ProgressEvent | null> {
    const { rows } = await this.pool.query<Row>(
      `insert into progress_events (shipment_id, user_id, org_id, document_id, run_id, kind, stage, status, at, duration_ms, detail)
       select s.id, s.user_id, s.org_id, $2, $3, $4, $5, $6, $7, $8, $9 from shipments s where s.id = $1
       returning ${COLUMNS}`,
      [e.shipmentId, e.documentId ?? null, e.runId, e.kind, e.stage, e.status, e.at ?? new Date().toISOString(), e.durationMs ?? null, JSON.stringify(e.detail ?? {})],
    );
    if (!rows[0]) return null;
    const event = toEvent(rows[0]);
    const full = JSON.stringify(event);
    // NOTIFY payloads must stay under 8000 bytes: a large event is sent by id and read back.
    await this.pool.query('select pg_notify($1, $2)', [PROGRESS_CHANNEL, Buffer.byteLength(full) < notifyMax ? full : JSON.stringify({ id: event.id })]);
    return event;
  }

  /**
   * Announces an ephemeral event without storing it (id 0, no owner: the shipment stream filters by
   * shipment). Returns it, or null when it is too large for a NOTIFY payload (it cannot be read back).
   */
  async notifyEphemeral(e: NewProgressEvent, notifyMax: number): Promise<ProgressEvent | null> {
    const event = { ...e, id: 0, userId: null, at: e.at ?? new Date().toISOString(), detail: e.detail ?? {}, ephemeral: true } as ProgressEvent;
    const payload = JSON.stringify(event);
    if (Buffer.byteLength(payload) >= notifyMax) return null;
    await this.pool.query('select pg_notify($1, $2)', [PROGRESS_CHANNEL, payload]);
    return event;
  }

  async find(id: number): Promise<ProgressEvent | null> {
    const { rows } = await this.pool.query<Row>(`select ${COLUMNS} from progress_events where id = $1`, [id]);
    return rows[0] ? toEvent(rows[0]) : null;
  }

  /** Events stored after `afterId`, oldest first, for every listener (a LISTEN connection that was down). */
  async listAfter(afterId: number, limit = REPLAY_LIMIT): Promise<ProgressEvent[]> {
    const { rows } = await this.pool.query<Row>(`select ${COLUMNS} from progress_events where id > $1 order by id limit $2`, [afterId, limit]);
    return rows.map(toEvent);
  }

  /** Highest id stored, 0 when empty. */
  async lastId(): Promise<number> {
    const { rows } = await this.pool.query<{ id: string | null }>('select max(id) as id from progress_events');
    return Number(rows[0]?.id ?? 0);
  }

  /** A shipment's events after `afterId`, oldest first. */
  async shipmentAfter(shipmentId: string, afterId: number, limit = REPLAY_LIMIT): Promise<ProgressEvent[]> {
    const { rows } = await this.pool.query<Row>(`select ${COLUMNS} from progress_events where shipment_id = $1 and id > $2 order by id limit $3`, [shipmentId, afterId, limit]);
    return rows.map(toEvent);
  }

  /**
   * What a page opening the stream needs: every event of the latest run of each document and of the
   * latest validation, oldest first (DISTINCT ON groups validation runs together: document_id is null).
   */
  async shipmentLatestRuns(shipmentId: string, limit = REPLAY_LIMIT): Promise<ProgressEvent[]> {
    const { rows } = await this.pool.query<Row>(
      `select ${COLUMNS} from progress_events
       where shipment_id = $1 and run_id in (
         select distinct on (kind, document_id) run_id from progress_events where shipment_id = $1 order by kind, document_id, id desc
       )
       order by id limit $2`,
      [shipmentId, limit],
    );
    return rows.map(toEvent);
  }

  /** An organization's events after `afterId` (all its shipments), oldest first. */
  async orgAfter(orgId: string, afterId: number, limit = REPLAY_LIMIT): Promise<ProgressEvent[]> {
    const { rows } = await this.pool.query<Row>(`select ${COLUMNS} from progress_events where org_id = $1 and id > $2 order by id limit $3`, [orgId, afterId, limit]);
    return rows.map(toEvent);
  }

  /**
   * What an activity panel needs when it opens: every event of the organization's runs still going (with
   * an event in the last `runningHours`) and of its `finished` latest ended runs, oldest first.
   */
  async orgActivity(orgId: string, finished: number, runningHours = 6, limit = REPLAY_LIMIT): Promise<ProgressEvent[]> {
    const { rows } = await this.pool.query<Row>(
      `with last as (
         select distinct on (run_id) run_id, id, at, (${RUN_ENDED}) as ended
         from progress_events where org_id = $1 and at > now() - interval '1 day'
         order by run_id, id desc
       ), chosen as (
         (select run_id from last where not ended and at > now() - make_interval(hours => $3))
         union
         (select run_id from last where ended order by id desc limit $2)
       )
       select ${COLUMNS} from progress_events
       where org_id = $1 and run_id in (select run_id from chosen)
       order by id limit $4`,
      [orgId, finished, runningHours, limit],
    );
    return rows.map(toEvent);
  }

  /**
   * The latest extraction run of a document: its id, when it was queued, and whether it ended.
   * Undefined when the document has no events (e.g. they were pruned).
   */
  async latestExtractionRun(shipmentId: string, documentId: string): Promise<{ runId: string; queuedAt?: Date; ended: boolean } | undefined> {
    const { rows } = await this.pool.query<{ run_id: string; ended: boolean; queued_at: Date | null }>(
      `select e.run_id, (${RUN_ENDED}) as ended,
         (select q.at from progress_events q where q.shipment_id = $1 and q.run_id = e.run_id and q.stage = 'queued' and q.status = 'started' order by q.id desc limit 1) as queued_at
       from progress_events e where e.shipment_id = $1 and e.document_id = $2 and e.kind = 'extraction'
       order by e.id desc limit 1`,
      [shipmentId, documentId],
    );
    const r = rows[0];
    return r && { runId: r.run_id, ended: r.ended, ...(r.queued_at ? { queuedAt: r.queued_at } : {}) };
  }

  /** Asks every API process (LISTEN on CANCEL_CHANNEL) to stop its extraction of this document. */
  async notifyCancel(documentId: string): Promise<void> {
    await this.pool.query('select pg_notify($1, $2)', [CANCEL_CHANNEL, documentId]);
  }

  /**
   * Median durations of the stages that ended in the last `days`, grouped by kind and stage (and model
   * and cache use for the model call). A skipped stage counts as 0 ms; `reading` leaves out scans
   * (their OCR time is estimated per page, see ocrPageDurations).
   */
  async stageDurations(days: number): Promise<DurationRow[]> {
    const { rows } = await this.pool.query<DurationRow>(
      `select kind, stage,
         case when stage = 'extracting' then coalesce(detail->>'model', '') else '' end as model,
         coalesce(detail->>'cached', 'false') = 'true' as cached,
         count(*)::int as samples,
         round(percentile_cont(0.5) within group (order by coalesce(duration_ms, 0)))::int as ms
       from progress_events
       where status in ('done', 'skipped') and at > now() - make_interval(days => $1)
         and not (stage = 'reading' and detail ? 'ocrPages')
         and not (kind = 'validation' and stage = 'started')
       group by 1, 2, 3, 4`,
      [days],
    );
    return rows;
  }

  /** Median time of one OCR page, and of one agent question (asked and answered), in the last `days`. */
  async perItemDurations(days: number): Promise<{ ocrPage?: { samples: number; ms: number }; agentQuestion?: { samples: number; ms: number } }> {
    const { rows } = await this.pool.query<{ item: 'ocrPage' | 'agentQuestion'; samples: number; ms: number | null }>(
      `select 'ocrPage' as item, count(*)::int as samples,
         round(percentile_cont(0.5) within group (order by duration_ms::float / greatest(coalesce((detail->>'ocrPages')::int, 1), 1)))::int as ms
       from progress_events
       where stage = 'ocr' and status = 'done' and duration_ms is not null and at > now() - make_interval(days => $1)
       union all
       select 'agentQuestion', count(*)::int, round(percentile_cont(0.5) within group (order by d.duration_ms::float / q.n))::int
       from progress_events d
       join (
         select run_id, count(*) as n from progress_events
         where kind = 'validation' and stage = 'agent' and status = 'progress' and detail ? 'answer' and at > now() - make_interval(days => $1)
         group by run_id
       ) q on q.run_id = d.run_id
       where d.kind = 'validation' and d.stage = 'agent' and d.status = 'done' and d.duration_ms is not null`,
      [days],
    );
    const out: { ocrPage?: { samples: number; ms: number }; agentQuestion?: { samples: number; ms: number } } = {};
    for (const r of rows) if (r.samples > 0 && r.ms !== null) out[r.item] = { samples: r.samples, ms: r.ms };
    return out;
  }

  /** Median time of the extraction model calls that were not cached, per model, from llm_calls (the older history). */
  async modelCallDurations(days: number): Promise<{ model: string; samples: number; ms: number }[]> {
    const { rows } = await this.pool.query<{ model: string; samples: number; ms: number }>(
      `select provider as model, count(*)::int as samples, round(percentile_cont(0.5) within group (order by ms))::int as ms
       from llm_calls
       where not cached and error is null and prompt_version like 'extract-%' and created_at > now() - make_interval(days => $1)
       group by provider`,
      [days],
    );
    return rows;
  }

  /** References of the organization's shipments and names of their documents among these ids (others are left out). */
  async labels(orgId: string, shipmentIds: string[], documentIds: string[]): Promise<ActivityLabels> {
    const [shipments, documents] = await Promise.all([
      this.pool.query<{ id: string; reference: string | null; destination: string | null }>('select id, reference, destination from shipments where org_id = $1 and id = any($2::uuid[])', [orgId, shipmentIds]),
      this.pool.query<{ id: string; shipment_id: string; file_name: string; status: string }>(
        'select d.id, d.shipment_id, d.file_name, d.status from documents d join shipments s on s.id = d.shipment_id where s.org_id = $1 and d.id = any($2::uuid[])',
        [orgId, documentIds],
      ),
    ]);
    return {
      shipments: shipments.rows,
      documents: documents.rows.map((d) => ({ id: d.id, shipmentId: d.shipment_id, fileName: d.file_name, status: d.status })),
    };
  }

  /** Deletes events older than `days`; returns how many. Uses the index on at. */
  async prune(days: number): Promise<number> {
    const { rowCount } = await this.pool.query(`delete from progress_events where at < now() - make_interval(days => $1)`, [days]);
    return rowCount ?? 0;
  }
}
