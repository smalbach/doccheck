import { isScacFormat, isValidImo, OCEAN_CARRIER_SCACS } from '../reference';
import type { Rule, RuleResult } from '../types';

/**
 * X15: the BL identifies the vessel and carrier properly. An IMO number must pass its check digit,
 * a SCAC must be 2–4 letters and either a known ocean carrier or one the account added, and a BL
 * that names a vessel must give the voyage (manifests and ISF match on vessel and voyage).
 */
export const x15VesselCarrier: Rule = {
  definition: {
    id: 'X15',
    title: 'Vessel, voyage and carrier SCAC are valid',
    appliesTo: 'ALL',
    requires: ['BILL_OF_LADING'],
    kind: 'DETERMINISTIC',
    severity: 'LOW',
  },
  run(ctx, params) {
    if (!ctx.billOfLading) return [];
    const { id, data: bl } = ctx.billOfLading;
    const results: RuleResult[] = [];

    // An IMO number in its own field, or printed with the vessel name ("MSC ANNA / IMO 9930038").
    const inName = bl.vessel?.match(/IMO\s*:?\s*(\d{6,8})/i)?.[1];
    const imo = bl.vesselImo ?? inName;
    if (imo && !isValidImo(imo)) {
      const field = bl.vesselImo ? 'vesselImo' : 'vessel';
      results.push({
        severity: 'MEDIUM',
        message: `Vessel IMO number ${imo} fails its check digit; it is probably mistyped.`,
        evidence: [{ documentId: id, field, value: bl.vesselImo ?? bl.vessel! }],
        suggestedFix: 'Check the IMO number against the carrier booking or a ship register.',
      });
    }

    if (bl.vessel && !bl.voyage?.trim()) {
      results.push({
        message: `The BL names vessel ${bl.vessel} but no voyage number.`,
        evidence: [{ documentId: id, field: 'voyage', value: '' }],
        suggestedFix: 'Ask the carrier or forwarder for the voyage; the manifest and the ISF are matched on vessel and voyage.',
      });
    }

    const scac = bl.carrier?.scac?.trim();
    if (scac) {
      const s = scac.toUpperCase();
      const evidence = [{ documentId: id, field: 'carrier.scac', value: scac }];
      const known = new Set([...Object.keys(OCEAN_CARRIER_SCACS), ...params.knownScacs.map((k) => k.trim().toUpperCase())]);
      if (!isScacFormat(s)) {
        results.push({
          severity: 'MEDIUM',
          message: `Carrier SCAC "${scac}" is not a valid Standard Carrier Alpha Code (2 to 4 letters).`,
          evidence,
          suggestedFix: 'Ask the carrier for its SCAC; CBP rejects manifests and ISF filings with a wrong one.',
        });
      } else if (!known.has(s)) {
        results.push({
          message: `Carrier SCAC ${s} is not a known ocean carrier code.`,
          evidence,
          suggestedFix: 'Confirm the code with the carrier. If it is right (an NVOCC or a regional line), add it to the known SCACs in the rule settings.',
        });
      }
    }
    return results;
  },
};
