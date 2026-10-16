import { Inject, Injectable } from '@nestjs/common';
import type { DutyInputs } from '@doccheck/duties';
import type { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';

/** The duty answers of a shipment, always read and written within the active organization. */
@Injectable()
export class DutiesRepository {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async inputs(shipmentId: string, orgId: string): Promise<{ inputs: DutyInputs; updatedAt?: string }> {
    const { rows } = await this.pool.query<{ inputs: DutyInputs; updated_at: Date }>('select inputs, updated_at from shipment_duty_inputs where shipment_id = $1 and org_id = $2', [shipmentId, orgId]);
    return rows[0] ? { inputs: rows[0].inputs, updatedAt: rows[0].updated_at.toISOString() } : { inputs: {} };
  }

  /** The org comes from the shipment (dc_org_from_shipment); the update only touches a row of the same org. */
  async saveInputs(shipmentId: string, orgId: string, inputs: DutyInputs, userId: string): Promise<void> {
    await this.pool.query(
      `insert into shipment_duty_inputs (shipment_id, org_id, inputs, updated_by, updated_at)
       select id, org_id, $3, $4, now() from shipments where id = $1 and org_id = $2
       on conflict (shipment_id) do update set inputs = excluded.inputs, updated_by = excluded.updated_by, updated_at = now()
       where shipment_duty_inputs.org_id = $2`,
      [shipmentId, orgId, JSON.stringify(inputs), userId],
    );
  }
}
