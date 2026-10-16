import { fromFixed, toFixed, withinTolerance } from '../decimal';
import { containerTypeOf } from '../reference';
import type { Rule, RuleResult } from '../types';

/**
 * X20: each container's verified gross mass (SOLAS VI/2) agrees with the cargo weight the BL declares
 * for it plus the container's tare: the tare printed with the container, else the type's typical tare.
 * With one container and no per-container weight, the BL total is the cargo weight. A VGM below the
 * cargo weight alone is impossible and always reported.
 */
export const x20Vgm: Rule = {
  definition: {
    id: 'X20',
    title: 'VGM agrees with the BL gross weight',
    appliesTo: 'ALL',
    requires: ['BILL_OF_LADING'],
    kind: 'DETERMINISTIC',
    severity: 'MEDIUM',
    params: [{ key: 'vgmTolerance', unit: 'percent', min: 0, max: 0.5 }],
  },
  run(ctx, params) {
    if (!ctx.billOfLading) return [];
    const { id, data: bl } = ctx.billOfLading;
    const results: RuleResult[] = [];
    bl.containers.forEach((c, i) => {
      if (!c.vgm) return;
      const cargo = c.grossWeight ?? (bl.containers.length === 1 ? bl.totalGrossWeight : undefined);
      if (!cargo) return;
      const cargoField = c.grossWeight ? `containers[${i}].grossWeight.kg` : 'totalGrossWeight.kg';
      const tare = c.tareWeight?.kg ?? containerTypeOf(c.type)?.tareKg;
      const vgmEv = { documentId: id, field: `containers[${i}].vgm.kg`, value: c.vgm.kg };
      const cargoEv = { documentId: id, field: cargoField, value: cargo.kg };
      if (toFixed(c.vgm.kg) < toFixed(cargo.kg)) {
        results.push({
          severity: 'HIGH',
          message: `Container ${c.number} has a VGM of ${c.vgm.kg} kg, less than the ${cargo.kg} kg of cargo the BL declares in it.`,
          evidence: [vgmEv, cargoEv],
          suggestedFix: 'The VGM includes cargo, packing and the container itself; ask the shipper for the weighing certificate.',
        });
        return;
      }
      if (!tare) return;
      const expected = fromFixed(toFixed(cargo.kg) + toFixed(tare), 2);
      if (withinTolerance(c.vgm.kg, expected, params.vgmTolerance)) return;
      results.push({
        message: `Container ${c.number} has a VGM of ${c.vgm.kg} kg; the BL cargo weight ${cargo.kg} kg plus ${c.tareWeight ? 'its' : 'a typical'} tare of ${tare} kg is ${expected} kg (tolerance ${params.vgmTolerance * 100}%).`,
        evidence: [vgmEv, cargoEv, ...(c.tareWeight ? [{ documentId: id, field: `containers[${i}].tareWeight.kg`, value: c.tareWeight.kg }] : [])],
        suggestedFix: 'Either the declared cargo weight or the VGM is wrong; the carrier loads on the VGM, customs assesses on the declared weight.',
      });
    });
    return results;
  },
};
