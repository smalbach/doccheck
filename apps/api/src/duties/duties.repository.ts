import { Inject, Injectable } from '@nestjs/common';
import type { DutyInputs } from '@doccheck/duties';
import type { Pool } from 'pg';
import { PG_POOL } from '../db/db.module';

@Injectable()
export class DutiesRepository {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async inputs(shipmentId: string): Promise<{ inputs: DutyInputs; updatedAt?: string }> {
    const { rows } = await this.pool.query<{ inputs: DutyInputs; updated_at: Date }>('select inputs, updated_at from shipment_duty_inputs where shipment_id = $1', [shipmentId]);
    return rows[0] ? { inputs: rows[0].inputs, updatedAt: rows[0].updated_at.toISOString() } : { inputs: {} };
  }

  async saveInputs(shipmentId: string, inputs: DutyInputs, userId: string): Promise<void> {
    await this.pool.query(
      `insert into shipment_duty_inputs (shipment_id, inputs, updated_by, updated_at) values ($1, $2, $3, now())
       on conflict (shipment_id) do update set inputs = excluded.inputs, updated_by = excluded.updated_by, updated_at = now()`,
      [shipmentId, JSON.stringify(inputs), userId],
    );
  }
}
