import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';
import type { AnalyticsQuery } from './analytics.dto';
import type { KpiGroup, KpiMonth, Kpis, SupplierDetail, SupplierRow } from './analytics.types';
import type { CostFinding, CostShipment } from './cost/cost';
import { median, supplierScore } from './score';

/**
 * The organization's validation history ($1 organization, $2 destination, $3 from, $4 to): every run, the
 * shipments whose first validation falls in the range (`scope`), and one row per finding of those
 * shipments across runs (`hist`, a finding being its fingerprint): rule, severity, document type,
 * whether the first and the latest run had it, when it was first seen and, if a later run no longer
 * had it, when that run happened (`resolved_at`). Supplier, origins and route come from the
 * shipment's current documents.
 */
export const HISTORY = `
  with owned as (
    select id, reference, destination, transport_mode, created_at from shipments
    where org_id = $1 and ($2::text is null or destination = $2)
  ), runs as (
    select v.id, v.shipment_id, v.created_at, v.ran,
      row_number() over (partition by v.shipment_id order by v.created_at, v.id) as n,
      count(*) over (partition by v.shipment_id) as total
    from validations v join owned o on o.id = v.shipment_id
  ), scope as (
    select o.*, r.id as first_validation_id, r.created_at as first_validated_at, r.ran as first_ran
    from owned o join runs r on r.shipment_id = o.id and r.n = 1
    where ($3::date is null or r.created_at >= $3::date) and ($4::date is null or r.created_at < $4::date + 1)
  ), hist0 as (
    select f.shipment_id, f.fingerprint,
      (array_agg(f.rule_id order by r.created_at))[1] as rule_id,
      (array_agg(f.severity order by r.created_at))[1] as severity,
      (array_agg(f.evidence->0->>'documentId' order by r.created_at))[1] as doc_id,
      min(r.created_at) as first_seen, max(r.created_at) as last_seen,
      bool_or(r.n = 1) as in_first, bool_or(r.n = r.total) as in_latest
    from findings f join runs r on r.id = f.validation_id join scope s on s.id = f.shipment_id
    group by 1, 2
  ), hist as (
    select h.*, coalesce(fs.status, 'open') as status,
      coalesce(d.detected_type, case when h.doc_id ilike 'isf%' then 'ISF' end, 'UNKNOWN') as doc_type,
      case when not h.in_latest then (select min(r.created_at) from runs r where r.shipment_id = h.shipment_id and r.created_at > h.last_seen) end as resolved_at,
      exists (select 1 from finding_reviews fr where fr.shipment_id = h.shipment_id and fr.fingerprint = h.fingerprint and fr.status = 'waiting_supplier')
        or exists (select 1 from mail_threads t where t.shipment_id = h.shipment_id and t.kind = 'correction_request' and h.fingerprint = any (t.fingerprints)) as requested
    from hist0 h
    left join finding_status fs on fs.shipment_id = h.shipment_id and fs.fingerprint = h.fingerprint
    left join documents d on d.id::text = h.doc_id
  ), cur as (
    select cd.shipment_id, cd.detected_type, cd.document_id from current_documents cd join scope s on s.id = cd.shipment_id
  ), attrs as (
    select s.id,
      coalesce(inv.seller_id, bl.shipper_id) as seller_id,
      coalesce(p.name, inv.seller_name) as seller,
      case when bl.document_id is not null then
        coalesce(bl.port_of_loading_locode, bl.port_of_loading_name, '?') || ' → ' || coalesce(bl.port_of_discharge_locode, bl.port_of_discharge_name, '?') end as route,
      array(select distinct l.country_of_origin from invoice_lines l where l.document_id = inv.document_id and l.country_of_origin is not null order by 1) as origins,
      bl.shipped_on_board_date, coalesce(bl.container_count, 0) as containers
    from scope s
    left join cur ci on ci.shipment_id = s.id and ci.detected_type = 'COMMERCIAL_INVOICE' left join invoices inv on inv.document_id = ci.document_id
    left join cur cb on cb.shipment_id = s.id and cb.detected_type = 'BILL_OF_LADING' left join bills_of_lading bl on bl.document_id = cb.document_id
    left join parties p on p.id = coalesce(inv.seller_id, bl.shipper_id)
  ), requests as (
    select t.id, t.shipment_id, t.party_id, t.subject, t.status,
      (select min(coalesce(m.sent_at, m.created_at)) from mail_messages m where m.thread_id = t.id and m.direction = 'out') as sent_at,
      (select min(coalesce(m.received_at, m.created_at)) from mail_messages m where m.thread_id = t.id and m.direction = 'in') as reply_at
    from mail_threads t join scope s on s.id = t.shipment_id where t.org_id = $1 and t.kind = 'correction_request'
  )`;

const params = (orgId: string, q: AnalyticsQuery) => [orgId, q.destination ?? null, q.from ?? null, q.to ?? null];
const hours = (ms: number) => Math.round((ms / 3_600_000) * 10) / 10;
const iso = (d: unknown) => (d instanceof Date ? d.toISOString() : typeof d === 'string' ? d : undefined);

/** A breakdown query: one group per key, with shipments, shipments with findings and findings of the first run. */
const breakdown = (keyed: string) => `
  , keyed as (${keyed}), first_hits as (
    select k.key, k.label, k.id as shipment_id, count(h.fingerprint) as findings
    from keyed k left join hist h on h.shipment_id = k.id and h.in_first and h.rule_id = coalesce(k.rule_id, h.rule_id) and h.doc_type = coalesce(k.doc_type, h.doc_type)
    group by 1, 2, 3
  )
  select key, min(label) as label, count(*)::int as shipments, count(*) filter (where findings > 0)::int as with_findings, coalesce(sum(findings), 0)::int as findings
  from first_hits group by key order by with_findings desc, findings desc, key limit 50`;

const toGroups = (rows: { key: string; label: string | null; shipments: number; with_findings: number; findings: number }[]): KpiGroup[] =>
  rows.map((r) => ({ key: r.key, ...(r.label ? { label: r.label } : {}), shipments: r.shipments, withFindings: r.with_findings, findings: r.findings }));

@Injectable()
export class AnalyticsRepository {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async kpis(orgId: string, q: AnalyticsQuery): Promise<Kpis> {
    const p = params(orgId, q);
    const run = <T>(sql: string) => this.pool.query(`${HISTORY} ${sql}`, p).then((r) => r.rows as T[]);
    const [[totals], months, resolution, response, byRule, byDoc, bySupplier, byOrigin, byRoute] = await Promise.all([
      run<{ shipments: number; clean: number; first_findings: number; open: number; resolved: number; dismissed: number }>(`
        select (select count(*)::int from scope) as shipments,
          (select count(*)::int from scope s where not exists (select 1 from hist h where h.shipment_id = s.id and h.in_first)) as clean,
          (select count(*)::int from hist where in_first) as first_findings,
          (select count(*)::int from hist where in_latest and status in ('open', 'waiting_supplier')) as open,
          (select count(*)::int from hist where resolved_at is not null) as resolved,
          (select count(*)::int from hist where in_latest and status in ('accepted', 'false_positive')) as dismissed`),
      run<{ month: string; shipments: number; clean: number; findings: number }>(`
        select to_char(s.first_validated_at, 'YYYY-MM') as month, count(*)::int as shipments,
          count(*) filter (where not exists (select 1 from hist h where h.shipment_id = s.id and h.in_first))::int as clean,
          coalesce(sum((select count(*) from hist h where h.shipment_id = s.id and h.in_first)), 0)::int as findings
        from scope s group by 1 order by 1`),
      run<{ ms: string }>(`select extract(epoch from (resolved_at - first_seen)) * 1000 as ms from hist where resolved_at is not null`),
      run<{ sent_at: Date | null; reply_at: Date | null }>(`select sent_at, reply_at from requests`),
      run<KpiRow>(`${breakdown(`select s.id, r.rule as key, null::text as label, r.rule as rule_id, null::text as doc_type from scope s cross join lateral jsonb_array_elements_text(s.first_ran) as r(rule)`)}`),
      run<KpiRow>(`${breakdown(`select s.id, t.doc_type as key, null::text as label, null::text as rule_id, t.doc_type from scope s join (select distinct shipment_id, doc_type from hist where in_first) t on t.shipment_id = s.id
                    union all select s.id, c.detected_type, null, null, c.detected_type from scope s join cur c on c.shipment_id = s.id
                      where not exists (select 1 from hist h where h.shipment_id = s.id and h.in_first and h.doc_type = c.detected_type)`)}`),
      run<KpiRow>(`${breakdown(`select s.id, coalesce(a.seller_id::text, '-') as key, a.seller as label, null::text as rule_id, null::text as doc_type from scope s join attrs a on a.id = s.id`)}`),
      run<KpiRow>(`${breakdown(`select s.id, coalesce(o.origin, '-') as key, null::text as label, null::text as rule_id, null::text as doc_type from scope s join attrs a on a.id = s.id left join lateral unnest(nullif(a.origins, '{}')) as o(origin) on true`)}`),
      run<KpiRow>(`${breakdown(`select s.id, coalesce(a.route, '-') as key, null::text as label, null::text as rule_id, null::text as doc_type from scope s join attrs a on a.id = s.id`)}`),
    ]);
    const answered = response.filter((r) => r.sent_at && r.reply_at);
    return {
      range: { ...(q.from ? { from: q.from } : {}), ...(q.to ? { to: q.to } : {}), ...(q.destination ? { destination: q.destination } : {}) },
      totals: {
        shipments: totals.shipments,
        cleanFirstPass: totals.clean,
        firstPassFindings: totals.first_findings,
        openFindings: totals.open,
        resolvedFindings: totals.resolved,
        dismissedFindings: totals.dismissed,
        medianResolutionHours: nullableHours(median(resolution.map((r) => Number(r.ms)))),
        medianResponseHours: nullableHours(median(answered.map((r) => r.reply_at!.getTime() - r.sent_at!.getTime()))),
        requests: response.length,
        answered: answered.length,
      },
      months: months as KpiMonth[],
      byRule: toGroups(byRule),
      byDocumentType: toGroups(byDoc),
      bySupplier: toGroups(bySupplier),
      byOrigin: toGroups(byOrigin),
      byRoute: toGroups(byRoute),
    };
  }

  /** Every seller (or B/L shipper) of the organization's validated shipments, scored and ranked. */
  async suppliers(orgId: string, q: AnalyticsQuery): Promise<SupplierRow[]> {
    const rows = await this.supplierRows(orgId, q);
    const ranked = [...rows].filter((r) => r.score.score !== null).sort((a, b) => b.score.score! - a.score.score! || b.validatedShipments - a.validatedShipments || a.name.localeCompare(b.name));
    ranked.forEach((r, i) => (r.rank = i + 1));
    return [...ranked, ...rows.filter((r) => r.score.score === null)];
  }

  async supplier(orgId: string, partyId: string, q: AnalyticsQuery): Promise<SupplierDetail | null> {
    const all = await this.suppliers(orgId, q);
    const row = all.find((r) => r.partyId === partyId);
    if (!row) return null;
    const p = [...params(orgId, q), partyId];
    const run = <T>(sql: string) => this.pool.query(`${HISTORY} ${sql}`, p).then((r) => r.rows as T[]);
    const [months, rules, requests] = await Promise.all([
      run<KpiMonth>(`
        select to_char(s.first_validated_at, 'YYYY-MM') as month, count(*)::int as shipments,
          count(*) filter (where not exists (select 1 from hist h where h.shipment_id = s.id and h.in_first))::int as clean,
          coalesce(sum((select count(*) from hist h where h.shipment_id = s.id and h.in_first)), 0)::int as findings
        from scope s join attrs a on a.id = s.id where a.seller_id = $5 group by 1 order by 1`),
      run<{ rule_id: string; findings: number; shipments: number }>(`
        select h.rule_id, count(*)::int as findings, count(distinct h.shipment_id)::int as shipments
        from hist h join attrs a on a.id = h.shipment_id where a.seller_id = $5 group by 1 order by 2 desc, 1 limit 10`),
      run<{ id: string; shipment_id: string | null; reference: string | null; subject: string; status: string; sent_at: Date | null; reply_at: Date | null }>(`
        select r.id, r.shipment_id, s.reference, r.subject, r.status, r.sent_at, r.reply_at
        from requests r join scope s on s.id = r.shipment_id join attrs a on a.id = s.id
        where coalesce(r.party_id, a.seller_id) = $5 order by r.sent_at desc nulls last limit 50`),
    ]);
    return {
      ...row,
      months,
      topRules: rules.map((r) => ({ ruleId: r.rule_id, findings: r.findings, shipments: r.shipments })),
      requestsList: requests.map((r) => ({
        threadId: r.id,
        ...(r.shipment_id ? { shipmentId: r.shipment_id } : {}),
        ...(r.reference ? { reference: r.reference } : {}),
        subject: r.subject,
        status: r.status,
        ...(r.sent_at ? { sentAt: r.sent_at.toISOString() } : {}),
        ...(r.reply_at ? { firstReplyAt: r.reply_at.toISOString() } : {}),
      })),
    };
  }

  private async supplierRows(orgId: string, q: AnalyticsQuery): Promise<SupplierRow[]> {
    const { rows } = await this.pool.query(
      `${HISTORY}
       , per as (
         select a.seller_id, s.id,
           exists (select 1 from hist h where h.shipment_id = s.id and h.in_first) as dirty,
           (select count(*) from hist h where h.shipment_id = s.id and h.in_first) as findings,
           (select count(*) from hist h where h.shipment_id = s.id and h.requested) as requested,
           (select count(*) from hist h where h.shipment_id = s.id and h.requested and h.resolved_at is not null) as corrected
         from scope s join attrs a on a.id = s.id where a.seller_id is not null
       )
       select p.id, p.name, p.country,
         (select count(distinct i.shipment_id)::int from invoices i join current_documents cd on cd.document_id = i.document_id
            join owned o on o.id = i.shipment_id where i.seller_id = p.id) as shipments,
         count(per.id)::int as validated, count(per.id) filter (where not per.dirty)::int as clean,
         coalesce(sum(per.findings), 0)::int as findings, coalesce(sum(per.requested), 0)::int as requested, coalesce(sum(per.corrected), 0)::int as corrected,
         coalesce((select jsonb_agg(jsonb_build_object('sent', r.sent_at, 'reply', r.reply_at)) from requests r join attrs a on a.id = r.shipment_id
            where coalesce(r.party_id, a.seller_id) = p.id and r.sent_at is not null), '[]') as requests
       from per join parties p on p.id = per.seller_id
       group by p.id order by p.name`,
      params(orgId, q),
    );
    return rows.map((r) => {
      const requests = (r.requests as { sent: string; reply: string | null }[]).map((x) => (x.reply ? hours(Date.parse(x.reply) - Date.parse(x.sent)) : null));
      const answered = requests.filter((h): h is number => h !== null);
      return {
        partyId: r.id,
        name: r.name,
        ...(r.country ? { country: r.country } : {}),
        shipments: r.shipments,
        validatedShipments: r.validated,
        cleanFirstPass: r.clean,
        findings: r.findings,
        requestedFindings: r.requested,
        correctedFindings: r.corrected,
        requests: requests.length,
        answered: answered.length,
        medianResponseHours: median(answered),
        score: supplierScore({ validatedShipments: r.validated, cleanFirstPass: r.clean, requestedFindings: r.requested, correctedFindings: r.corrected, responseHours: requests }),
      };
    });
  }

  /** Shipments and findings for the cost estimate (every finding the shipments ever had). */
  async costInputs(orgId: string, q: AnalyticsQuery): Promise<{ shipments: CostShipment[]; findings: CostFinding[] }> {
    const p = params(orgId, q);
    const [ships, finds] = await Promise.all([
      this.pool.query(`${HISTORY} select s.id, s.reference, s.destination, s.transport_mode, s.created_at, to_char(a.shipped_on_board_date, 'YYYY-MM-DD') as departure, a.containers
        from scope s join attrs a on a.id = s.id where s.destination is not null order by s.first_validated_at`, p),
      this.pool.query(`${HISTORY} select shipment_id, rule_id, severity, resolved_at, (in_latest and status in ('accepted', 'false_positive')) as dismissed from hist`, p),
    ]);
    return {
      shipments: ships.rows.map((r) => ({
        shipmentId: r.id,
        ...(r.reference ? { reference: r.reference } : {}),
        destination: r.destination,
        ...(r.transport_mode ? { transportMode: r.transport_mode } : {}),
        containers: r.containers ?? 0,
        ...(r.departure ? { departure: r.departure } : {}),
        createdAt: iso(r.created_at)!,
      })),
      findings: finds.rows.map((r) => ({ shipmentId: r.shipment_id, ruleId: r.rule_id, severity: r.severity, ...(r.resolved_at ? { resolvedAt: iso(r.resolved_at) } : {}), dismissed: r.dismissed })),
    };
  }

  /** The organization's cost assumptions, or null for the defaults. */
  async costSettings(orgId: string): Promise<unknown> {
    const { rows } = await this.pool.query('select cost from analytics_settings where org_id = $1', [orgId]);
    return rows[0]?.cost ?? null;
  }

  async saveCostSettings(orgId: string, userId: string, cost: unknown | null): Promise<void> {
    await this.pool.query(
      `insert into analytics_settings (org_id, cost, updated_by, updated_at) values ($1, $2, $3, now())
       on conflict (org_id) do update set cost = excluded.cost, updated_by = excluded.updated_by, updated_at = now()`,
      [orgId, cost === null ? null : JSON.stringify(cost), userId],
    );
  }
}

type KpiRow = { key: string; label: string | null; shipments: number; with_findings: number; findings: number };
const nullableHours = (ms: number | null) => (ms === null ? null : hours(ms));
