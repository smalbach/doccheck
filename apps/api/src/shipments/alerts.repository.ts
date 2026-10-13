import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';
import { ALERT_KINDS, type Alert, type AlertKind, type AlertList } from './alerts.types';

/**
 * Every alert of the user's shipments ($1), one row each, with the moment it arose (`at`).
 * - critical: the latest validation has CRITICAL or HIGH findings not accepted nor marked false positive.
 * - failed-document: a document whose extraction failed.
 * - ocr: an extracted document read with OCR (an issue starting "Read with OCR") that the latest
 *   validation's findings cite as evidence, or whose shipment was never validated. Once validated
 *   without citing it, the scan is taken as checked.
 * - not-validated: at least one document, all extracted, and no validation yet, or one uploaded or
 *   re-extracted after the latest run.
 * - stale-destination: the latest run checked another destination than the shipment's current one.
 * - mail-reply / mail-overdue / mail-failed: a conversation about the shipment has unread replies,
 *   waits past its due date, or has a message that could not be sent.
 */
const ALERTS = `
  with owned as (
    select id, reference, destination from shipments where user_id = $1
  ), lv as (
    select distinct on (v.shipment_id) v.id, v.shipment_id, v.created_at, v.destination
    from validations v join owned o on o.id = v.shipment_id
    order by v.shipment_id, v.created_at desc
  ), alerts as (
    select 'critical' as kind, lv.shipment_id, null::uuid as document_id, null::text as file_name, lv.created_at as at,
      jsonb_build_object('critical', count(*) filter (where f.severity = 'CRITICAL'), 'high', count(*) filter (where f.severity = 'HIGH')) as detail
    from lv join findings f on f.validation_id = lv.id
    where f.severity in ('CRITICAL', 'HIGH') and not dc_finding_closed(lv.shipment_id, f.fingerprint)
    group by lv.shipment_id, lv.created_at
    union all
    select 'failed-document', d.shipment_id, d.id, d.file_name, d.created_at, jsonb_strip_nulls(jsonb_build_object('error', d.error))
    from documents d join owned o on o.id = d.shipment_id
    where d.status = 'FAILED'
    union all
    select 'ocr', d.shipment_id, d.id, d.file_name, e.created_at, jsonb_build_object('citedBy', cited.n)
    from documents d join owned o on o.id = d.shipment_id join extractions e on e.document_id = d.id
    left join lv on lv.shipment_id = d.shipment_id
    cross join lateral (
      select count(*)::int as n from findings f
      where f.validation_id = lv.id and exists (select 1 from jsonb_array_elements(f.evidence) ev where ev->>'documentId' = d.id::text)
    ) cited
    where d.status = 'EXTRACTED' and jsonb_typeof(e.issues) = 'array'
      and exists (select 1 from jsonb_array_elements_text(e.issues) i where i like 'Read with OCR%')
      and (lv.id is null or cited.n > 0)
    union all
    select 'not-validated', o.id, null, null, docs.last_at, jsonb_build_object('reason', case when lv.id is null then 'never' else 'changed' end)
    from owned o left join lv on lv.shipment_id = o.id
    cross join lateral (
      select count(*) as n, bool_and(d.status = 'EXTRACTED') as extracted, max(greatest(d.created_at, e.created_at)) as last_at
      from documents d left join extractions e on e.document_id = d.id where d.shipment_id = o.id
    ) docs
    where docs.n > 0 and docs.extracted and (lv.id is null or docs.last_at > lv.created_at)
    union all
    select 'stale-destination', o.id, null, null, lv.created_at, jsonb_strip_nulls(jsonb_build_object('validated', lv.destination, 'current', o.destination))
    from owned o join lv on lv.shipment_id = o.id
    where lv.destination is not null and lv.destination is distinct from o.destination
    union all
    select 'mail-reply', t.shipment_id, null, null, t.last_message_at, jsonb_build_object('threadId', t.id, 'subject', t.subject, 'count', t.unread)
    from mail_threads t join owned o on o.id = t.shipment_id
    where t.unread > 0 and t.status <> 'closed'
    union all
    select 'mail-overdue', t.shipment_id, null, null, t.due_at, jsonb_build_object('threadId', t.id, 'subject', t.subject, 'count', 1)
    from mail_threads t join owned o on o.id = t.shipment_id
    where t.status = 'awaiting' and t.due_at < now()
    union all
    select 'mail-failed', t.shipment_id, null, null, max(m.created_at), jsonb_build_object('threadId', t.id, 'subject', t.subject, 'count', count(*))
    from mail_threads t join owned o on o.id = t.shipment_id join mail_messages m on m.thread_id = t.id
    where m.status = 'failed' and t.status <> 'closed'
    group by t.id
  )`;

@Injectable()
export class AlertsRepository {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** The user's alerts, newest first, at most `limit`, with the count of each kind. */
  async list(userId: string, limit: number): Promise<AlertList> {
    const [{ rows }, { rows: counted }] = await Promise.all([
      this.pool.query(
        `${ALERTS} select a.*, o.reference from alerts a join owned o on o.id = a.shipment_id
         order by a.at desc, a.kind, a.shipment_id, a.document_id limit $2`,
        [userId, limit],
      ),
      this.pool.query<{ kind: AlertKind; n: number }>(`${ALERTS} select kind, count(*)::int as n from alerts group by kind`, [userId]),
    ]);
    const counts = Object.fromEntries(ALERT_KINDS.map((k) => [k, 0])) as Record<AlertKind, number>;
    for (const c of counted) counts[c.kind] = c.n;
    return {
      items: rows.map(
        (r) =>
          ({
            kind: r.kind,
            shipmentId: r.shipment_id,
            ...(r.reference ? { reference: r.reference } : {}),
            ...(r.document_id ? { documentId: r.document_id, fileName: r.file_name } : {}),
            at: new Date(r.at).toISOString(),
            detail: r.detail,
          }) as Alert,
      ),
      counts,
      total: counted.reduce((sum, c) => sum + c.n, 0),
    };
  }
}
