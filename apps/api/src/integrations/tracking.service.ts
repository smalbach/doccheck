import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  HttpTrackingProvider, MockTrackingProvider, trackingFindings, TRACKING_PROVIDERS, type ContainerEvent, type FetchLike, type MockScenario, type TrackingProvider, type TrackingProviderId,
} from '@doccheck/integrations';
import type { BillOfLading } from '@doccheck/schemas';
import type { Pool } from 'pg';
import { AuditService } from '../audit/audit.service';
import { PG_POOL } from '../db/db.module';
import { open, seal, type Sealed } from '../messaging/secret-box';
import { ShipmentsRepository } from '../shipments/shipments.repository';
import { checkUrl, safeRequest } from './safe-fetch';

export interface TrackingSettingsView {
  enabled: boolean;
  provider: TrackingProviderId;
  endpoint: string | null;
  hasApiKey: boolean;
  mockScenario: MockScenario;
  providers: readonly TrackingProviderId[];
}

export interface TrackingSettingsInput {
  enabled: boolean;
  provider: TrackingProviderId;
  endpoint?: string | null;
  /** A new key; undefined keeps the saved one, null removes it. */
  apiKey?: string | null;
  mockScenario?: MockScenario;
}

/** Fetches through the address-checked request (the endpoint is typed by a user). */
const guardedFetch: FetchLike = async (url, init) => {
  const res = await safeRequest(url, { headers: init.headers, timeoutMs: 15_000, maxBytes: 5 * 1024 * 1024 });
  return { ok: res.status >= 200 && res.status < 300, status: res.status, json: async () => JSON.parse(res.body) };
};

/**
 * Container tracking (off by default): after a validation, the BL's containers are looked up with
 * the account's provider and the T1-T3 consistency findings are added to that validation, so they
 * show, get reviewed and reach the supplier like any other finding. The events are kept with the
 * validation (tracking_snapshots).
 */
@Injectable()
export class TrackingService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly shipments: ShipmentsRepository,
    private readonly audit: AuditService,
  ) {}

  async settings(orgId: string): Promise<TrackingSettingsView> {
    const { rows } = await this.pool.query('select * from tracking_settings where org_id = $1', [orgId]);
    const r = rows[0];
    return {
      enabled: r?.enabled ?? false,
      provider: r?.provider ?? 'mock',
      endpoint: r?.endpoint ?? null,
      hasApiKey: !!r?.api_key,
      mockScenario: r?.mock_scenario ?? 'consistent',
      providers: TRACKING_PROVIDERS,
    };
  }

  async save(orgId: string, userId: string, input: TrackingSettingsInput): Promise<TrackingSettingsView> {
    const before = await this.settings(orgId);
    if (input.provider !== 'mock' && input.enabled) {
      if (!input.endpoint) throw new BadRequestException('Set the endpoint the provider serves container events at');
      const reason = checkUrl(input.endpoint.replace(/\{(container|bl|scac)\}/g, 'x'));
      if (reason) throw new BadRequestException(reason);
    }
    const key = input.apiKey === undefined ? undefined : input.apiKey === null || input.apiKey === '' ? null : JSON.stringify(seal(input.apiKey));
    await this.pool.query(
      `insert into tracking_settings (org_id, enabled, provider, endpoint, api_key, mock_scenario, updated_at, updated_by)
       values ($1, $2, $3, $4, $5, $6, now(), $8)
       on conflict (org_id) do update set enabled = $2, provider = $3, endpoint = $4,
         api_key = case when $7 then excluded.api_key else tracking_settings.api_key end, mock_scenario = $6, updated_at = now(), updated_by = $8`,
      [orgId, input.enabled, input.provider, input.endpoint || null, key ?? null, input.mockScenario ?? 'consistent', key !== undefined, userId],
    );
    const saved = await this.settings(orgId);
    // Never the provider key: only whether one is saved.
    const pick = ({ providers: _p, ...v }: TrackingSettingsView) => v;
    this.audit.note({ orgId, action: 'tracking.settings', entity: 'tracking_settings', entityId: orgId, before: pick(before), after: pick(saved) });
    if (saved.enabled && saved.provider !== 'mock' && !saved.hasApiKey) throw new BadRequestException('Enter the provider API key');
    return saved;
  }

  private async provider(orgId: string, bl: BillOfLading): Promise<TrackingProvider | null> {
    const { rows } = await this.pool.query('select * from tracking_settings where org_id = $1 and enabled', [orgId]);
    const r = rows[0];
    if (!r) return null;
    if (r.provider === 'mock') return new MockTrackingProvider(bl, r.mock_scenario);
    const key = r.api_key ? open(r.api_key as Sealed) : undefined;
    if (!key || !r.endpoint) return null;
    return new HttpTrackingProvider(r.provider, r.endpoint, key, guardedFetch);
  }

  /** Adds the tracking findings to a stored validation. Nothing when tracking is off or the validation read no BL. */
  async afterValidation(orgId: string, shipmentId: string, validationId: string): Promise<number> {
    const validation = await this.shipments.findValidation(shipmentId, validationId);
    const blId = validation?.inputs.billOfLading;
    if (!validation || !blId || blId === 'body') return 0;
    const ext = await this.shipments.findExtraction(shipmentId, blId);
    const bl = ext?.data as BillOfLading | undefined;
    if (!bl?.containers?.length) return 0;
    const provider = await this.provider(orgId, bl);
    if (!provider) return 0;
    const events: ContainerEvent[] = [];
    let error: string | null = null;
    try {
      for (const c of bl.containers) events.push(...(await provider.events({ containerNumber: c.number, blNumber: bl.blNumber, scac: bl.carrier?.scac })));
    } catch (err) {
      error = (err as Error).message.slice(0, 500);
    }
    const findings = error ? [] : trackingFindings(shipmentId, { id: blId, data: bl }, events, provider.id);
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const done = await client.query(
        `insert into tracking_snapshots (validation_id, shipment_id, provider, events, findings, error) values ($1, $2, $3, $4, $5, $6) on conflict do nothing`,
        [validationId, shipmentId, provider.id, JSON.stringify(events), findings.length, error],
      );
      if (done.rowCount) {
        for (const f of findings) {
          await client.query(
            `insert into findings (id, validation_id, shipment_id, rule_id, severity, decided_by, message, evidence, regulation, suggested_fix, agent_rationale)
             values ($1, $2, $3, $4, $5, $6, $7, $8, null, $9, null) on conflict do nothing`,
            [f.id, validationId, shipmentId, f.ruleId, f.severity, f.decidedBy, f.message, JSON.stringify(f.evidence), f.suggestedFix ?? null],
          );
        }
      }
      await client.query('commit');
    } catch (err) {
      await client.query('rollback');
      throw err;
    } finally {
      client.release();
    }
    return findings.length;
  }

  /** The events of the shipment's latest tracked validation, for display. */
  async latest(shipmentId: string) {
    const { rows } = await this.pool.query('select * from tracking_snapshots where shipment_id = $1 order by created_at desc limit 1', [shipmentId]);
    const r = rows[0];
    return r ? { validationId: r.validation_id, provider: r.provider, events: r.events as ContainerEvent[], findings: r.findings, error: r.error, createdAt: new Date(r.created_at).toISOString() } : null;
  }
}
