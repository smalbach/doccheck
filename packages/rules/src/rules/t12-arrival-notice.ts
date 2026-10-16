import type { Evidence } from '@doccheck/schemas';
import { withinTolerance } from '../decimal';
import { normalizeName } from '../normalize';
import type { Rule, RuleResult } from '../types';

const docNumber = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * T12: the arrival notice is for this shipment's transport document and agrees with it: the BL or
 * AWB number, the containers, the package count, the gross weight (X3 tolerance) and the consignee.
 * Carriers issue the notice from their own system, so a difference is a booking mix-up or an
 * amendment the commercial documents never got.
 */
export const t12ArrivalNotice: Rule = {
  definition: {
    id: 'T12',
    title: 'Arrival notice agrees with the bill of lading or air waybill',
    appliesTo: 'ALL',
    requires: ['ARRIVAL_NOTICE'],
    requiresAny: ['BILL_OF_LADING', 'AIR_WAYBILL'],
    kind: 'DETERMINISTIC',
    severity: 'MEDIUM',
    optional: true,
  },
  run(ctx, params) {
    const an = ctx.arrivalNotice;
    if (!an) return [];
    const bl = ctx.billOfLading;
    const awb = ctx.airWaybill;
    const transport = bl
      ? { id: bl.id, label: 'BL', numbers: [['blNumber', bl.data.blNumber]], packages: bl.data.totalPackages, packagesField: 'totalPackages', kg: bl.data.totalGrossWeight.kg, kgField: 'totalGrossWeight.kg', consignee: bl.data.consignee }
      : awb && {
          id: awb.id,
          label: 'air waybill',
          numbers: [['awbNumber', awb.data.awbNumber], ...(awb.data.masterAwbNumber ? [['masterAwbNumber', awb.data.masterAwbNumber]] : [])],
          packages: awb.data.pieces,
          packagesField: 'pieces',
          kg: awb.data.grossWeight.kg,
          kgField: 'grossWeight.kg',
          consignee: awb.data.consignee,
        };
    if (!transport) return [];
    const results: RuleResult[] = [];
    const ev = (field: string, value: string): Evidence => ({ documentId: an.id, field, value });

    if (!transport.numbers.some(([, n]) => docNumber(n) === docNumber(an.data.transportDocumentNumber))) {
      results.push({
        severity: 'HIGH',
        message: `The arrival notice is for ${an.data.transportDocumentNumber}, but this shipment's ${transport.label} is ${transport.numbers[0][1]}.`,
        evidence: [ev('transportDocumentNumber', an.data.transportDocumentNumber), { documentId: transport.id, field: transport.numbers[0][0], value: transport.numbers[0][1] }],
        suggestedFix: 'Check with the carrier that the notice belongs to this shipment before paying its charges.',
      });
      return results;
    }
    if (bl && an.data.containers?.length) {
      const onBl = new Set(bl.data.containers.map((c) => c.number));
      const onNotice = new Set(an.data.containers.map((c) => c.number.toUpperCase().replace(/[\s-]/g, '')));
      const extra = an.data.containers.map((c, i) => ({ c, i })).filter(({ c }) => !onBl.has(c.number.toUpperCase().replace(/[\s-]/g, '')));
      const missing = bl.data.containers.map((c, i) => ({ c, i })).filter(({ c }) => !onNotice.has(c.number));
      if (extra.length || missing.length) {
        results.push({
          message: `Containers differ: ${[extra.length && `${extra.map((x) => x.c.number).join(', ')} on the arrival notice only`, missing.length && `${missing.map((x) => x.c.number).join(', ')} on the BL only`].filter(Boolean).join('; ')}.`,
          evidence: [...extra.map((x) => ev(`containers[${x.i}].number`, x.c.number)), ...missing.map((x): Evidence => ({ documentId: bl.id, field: `containers[${x.i}].number`, value: x.c.number }))],
          suggestedFix: 'Ask the carrier which containers are on this bill; a missing box may have been rolled to another sailing.',
        });
      }
    }
    if (an.data.packages !== undefined && an.data.packages !== transport.packages) {
      results.push({
        message: `The arrival notice says ${an.data.packages} packages and the ${transport.label} ${transport.packages}.`,
        evidence: [ev('packages', String(an.data.packages)), { documentId: transport.id, field: transport.packagesField, value: String(transport.packages) }],
        suggestedFix: 'Confirm the count with the carrier; the manifest the notice comes from is what customs sees.',
      });
    }
    if (an.data.grossWeight && !withinTolerance(an.data.grossWeight.kg, transport.kg, params.grossWeightTolerance)) {
      results.push({
        message: `Gross weight is ${an.data.grossWeight.kg} kg on the arrival notice and ${transport.kg} kg on the ${transport.label}.`,
        evidence: [ev('grossWeight.kg', an.data.grossWeight.kg), { documentId: transport.id, field: transport.kgField, value: transport.kg }],
        suggestedFix: 'Ask the carrier to confirm the manifested weight.',
      });
    }
    if (normalizeName(an.data.consignee.name) !== normalizeName(transport.consignee.name) && !/^TO (THE )?ORDER\b/i.test(transport.consignee.name)) {
      results.push({
        message: `The arrival notice is addressed to "${an.data.consignee.name}", but the ${transport.label} consignee is "${transport.consignee.name}".`,
        evidence: [ev('consignee.name', an.data.consignee.name), { documentId: transport.id, field: 'consignee.name', value: transport.consignee.name }],
        suggestedFix: 'Make sure the carrier releases the goods to the right party.',
      });
    }
    return results;
  },
};
