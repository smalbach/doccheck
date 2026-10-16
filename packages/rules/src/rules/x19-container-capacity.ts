import type { Evidence } from '@doccheck/schemas';
import { fromFixed, toFixed } from '../decimal';
import { containerTypeOf } from '../reference';
import type { Rule, RuleResult } from '../types';

/**
 * X19: the cargo fits the declared containers. Per container, the volume and gross weight the BL
 * gives must not exceed the type's inside capacity and maximum payload (20GP, 40GP, 40HC, 45HC,
 * reefers); for the whole shipment, the packing list volume must fit in the containers together.
 * More cargo than fits means a container is missing from the BL, the type is wrong, or a figure is.
 */
export const x19ContainerCapacity: Rule = {
  definition: {
    id: 'X19',
    title: 'Cargo volume and weight fit the declared containers',
    appliesTo: 'ALL',
    requires: ['BILL_OF_LADING'],
    kind: 'DETERMINISTIC',
    severity: 'MEDIUM',
  },
  run(ctx) {
    if (!ctx.billOfLading) return [];
    const { id, data: bl } = ctx.billOfLading;
    const results: RuleResult[] = [];
    let capacity = 0n;
    let allKnown = bl.containers.length > 0;
    bl.containers.forEach((c, i) => {
      const spec = containerTypeOf(c.type);
      if (!spec) {
        allKnown = false;
        return;
      }
      capacity += toFixed(spec.capacityM3);
      const type: Evidence = { documentId: id, field: `containers[${i}].type`, value: c.type! };
      if (c.volumeM3 && /^\d+(\.\d+)?$/.test(c.volumeM3) && toFixed(c.volumeM3) > toFixed(spec.capacityM3)) {
        results.push({
          message: `Container ${c.number} (${c.type}) is declared with ${c.volumeM3} m3; a ${spec.type} holds at most ${spec.capacityM3} m3.`,
          evidence: [{ documentId: id, field: `containers[${i}].volumeM3`, value: c.volumeM3 }, type],
          suggestedFix: 'Check the container type and the volume with the forwarder; the cargo may need another container.',
        });
      }
      if (c.grossWeight && toFixed(c.grossWeight.kg) > toFixed(spec.maxPayloadKg)) {
        results.push({
          severity: 'HIGH',
          message: `Container ${c.number} (${c.type}) carries ${c.grossWeight.kg} kg of cargo; a ${spec.type} takes at most ${spec.maxPayloadKg} kg.`,
          evidence: [{ documentId: id, field: `containers[${i}].grossWeight.kg`, value: c.grossWeight.kg }, type],
          suggestedFix: 'An overweight container is refused at the terminal or fined on the road; confirm the weight and the container count.',
        });
      }
    });
    const pl = ctx.packingList;
    const volume = pl?.data.totals.volumeM3;
    if (pl && volume && /^\d+(\.\d+)?$/.test(volume) && allKnown && toFixed(volume) > capacity) {
      results.push({
        message: `The packing list totals ${volume} m3, but the ${bl.containers.length} container(s) on the BL hold at most ${fromFixed(capacity, 1)} m3.`,
        evidence: [
          { documentId: pl.id, field: 'totals.volumeM3', value: volume },
          ...bl.containers.map((c, i) => ({ documentId: id, field: `containers[${i}].type`, value: c.type! })),
        ],
        suggestedFix: 'A container may be missing from the BL, or the volume is wrong; confirm with the forwarder.',
      });
    }
    return results;
  },
};
