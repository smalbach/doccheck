import { Inject, Injectable } from '@nestjs/common';
import type { NewProgressEvent, ProgressEvent } from '@doccheck/schemas';
import type { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';

/** Channel of the NOTIFY sent for every stored event (payload: the event, or { id } when too large). */
export const PROGRESS_CHANNEL = 'doccheck_progress';

/** Events replayed at most per (re)connection; a client that is further behind reloads the page data anyway. */
export const REPLAY_LIMIT = 1000;

interface Row {
  id: string;
  shipment_id: string;
  user_id: string | null;
  document_id: string | null;
  run_id: string;
  kind: ProgressEvent['kind'];
  stage: ProgressEvent['stage'];
  status: ProgressEvent['status'];
  at: Date;
  duration_ms: number | null;
  detail: Record<string, unknown>;
}

const COLUMNS = 'id, shipment_id, user_id, document_id, run_id, kind, stage, status, at, duration_ms, detail';

function toEvent(r: Row): ProgressEvent {
  return {
    id: Number(r.id),
    shipmentId: r.shipment_id,
    userId: r.user_id,
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
      `insert into progress_events (shipment_id, user_id, document_id, run_id, kind, stage, status, at, duration_ms, detail)
       select s.id, s.user_id, $2, $3, $4, $5, $6, $7, $8, $9 from shipments s where s.id = $1
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

  /** A user's events after `afterId` (all their shipments), oldest first. */
  async userAfter(userId: string, afterId: number, limit = REPLAY_LIMIT): Promise<ProgressEvent[]> {
    const { rows } = await this.pool.query<Row>(`select ${COLUMNS} from progress_events where user_id = $1 and id > $2 order by id limit $3`, [userId, afterId, limit]);
    return rows.map(toEvent);
  }

  /** The user's latest `limit` events, oldest first. */
  async userRecent(userId: string, limit: number): Promise<ProgressEvent[]> {
    const { rows } = await this.pool.query<Row>(`select * from (select ${COLUMNS} from progress_events where user_id = $1 order by id desc limit $2) e order by id`, [userId, limit]);
    return rows.map(toEvent);
  }

  /** Deletes events older than `days`; returns how many. Uses the index on at. */
  async prune(days: number): Promise<number> {
    const { rowCount } = await this.pool.query(`delete from progress_events where at < now() - make_interval(days => $1)`, [days]);
    return rowCount ?? 0;
  }
}
