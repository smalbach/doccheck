import type { AirWaybill, BillOfLading } from '@doccheck/schemas';
import type { Rule, RuleDefinition, RuleResult } from '../types';
import { x12IncotermFreight } from './x12-incoterm-freight';
import { x1ConsigneeMatch } from './x1-consignee-match';
import { x9ShipmentDate } from './x9-shipment-date';

/** The date the goods left: the first flight's, or the date the air waybill was executed. */
const flightDate = (awb: AirWaybill) => awb.flights?.[0]?.date ?? awb.executedOn;

/** The fields of the air waybill that the ocean rules read from a bill of lading. */
function asBillOfLading(awb: AirWaybill): BillOfLading {
  return {
    blNumber: awb.awbNumber,
    shipper: awb.shipper,
    consignee: awb.consignee,
    portOfLoading: { name: awb.airportOfDeparture.name },
    portOfDischarge: { name: awb.airportOfDestination.name },
    containers: [],
    totalPackages: awb.pieces,
    totalGrossWeight: awb.grossWeight,
    cargoDescription: awb.natureOfGoods,
    freightTerms: awb.freightTerms,
    shippedOnBoardDate: flightDate(awb),
  };
}

const wording = (s: string) =>
  s.replace(/\bthe BL was shipped on board on\b/g, 'the goods flew on').replace(/\bthe BL\b/g, 'the air waybill').replace(/\bBL\b/g, 'air waybill').replace(/\bocean freight\b/g, 'air freight');

/**
 * An ocean rule (X1, X9, X12) run on the air waybill of an air shipment: the AWB is read as the
 * bill of lading would be, and the findings cite the AWB's own fields.
 */
function onAirWaybill(rule: Rule, definition: Omit<RuleDefinition, 'requires' | 'kind' | 'appliesTo' | 'optional'>, field: (f: string, awb: AirWaybill) => string): Rule {
  return {
    definition: { ...definition, appliesTo: rule.definition.appliesTo, kind: 'DETERMINISTIC', optional: true, requires: rule.definition.requires.map((t) => (t === 'BILL_OF_LADING' ? 'AIR_WAYBILL' : t)) },
    run(ctx, params) {
      const awb = ctx.airWaybill;
      if (!awb) return [];
      const results = rule.run({ ...ctx, billOfLading: { id: awb.id, data: asBillOfLading(awb.data) } }, params);
      return results.map(
        (r): RuleResult => ({
          ...r,
          message: wording(r.message),
          suggestedFix: r.suggestedFix && wording(r.suggestedFix),
          evidence: r.evidence.map((ev) => (ev.documentId === awb.id ? { ...ev, field: field(ev.field, awb.data) } : ev)),
        }),
      );
    },
  };
}

/** T4: X1 on the air waybill: the consignee is the invoice's. */
export const t4AwbConsignee = onAirWaybill(x1ConsigneeMatch, { id: 'T4', title: 'Consignee matches between invoice and air waybill', severity: 'MEDIUM' }, (f) => f);

/** T5: X9 on the air waybill: the invoice shipment date is within a week of the flight. */
export const t5AwbShipmentDate = onAirWaybill(x9ShipmentDate, { id: 'T5', title: 'Invoice shipment date matches the flight date', severity: 'LOW' }, (f, awb) =>
  f === 'shippedOnBoardDate' ? (awb.flights?.[0]?.date ? 'flights[0].date' : 'executedOn') : f,
);

/** T6: X12 on the air waybill: terms of sale agree with freight prepaid or collect. */
export const t6AwbFreightTerms = onAirWaybill(x12IncotermFreight, { id: 'T6', title: 'Terms of sale agree with the air waybill freight terms', severity: 'LOW' }, (f) => f);
