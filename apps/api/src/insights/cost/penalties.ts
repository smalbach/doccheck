import { Destination } from '@doccheck/schemas';
import { z } from 'zod';

/**
 * What a finding would have cost had it reached customs: the assumptions behind the "cost avoided"
 * estimate. Every amount is an assumption the organization can edit; the page always shows them next to
 * the figure, labelled as an estimate. Amounts are decimal strings, never floats.
 */

const Amount = z.string().trim().regex(/^\d{1,9}(\.\d{1,2})?$/, 'A positive amount with up to 2 decimals');
const Currency = z.string().trim().regex(/^[A-Z]{3}$/);
const RuleId = z.string().trim().regex(/^[A-Z][A-Z0-9]{0,5}$/);

export const Penalty = z.object({
  id: z.string().trim().min(1).max(40),
  destination: Destination,
  /** Rules whose findings would draw it; charged once per shipment however many findings. */
  ruleIds: z.array(RuleId).min(1).max(40),
  label: z.string().trim().min(1).max(200),
  /** Where the amount comes from: contravention or regulation, and the page to check it on. */
  reference: z.string().trim().max(300),
  url: z.string().trim().url().max(500).optional(),
  amount: Amount,
  currency: Currency,
});
export type Penalty = z.infer<typeof Penalty>;

export const CostAssumptions = z.object({
  penalties: z.array(Penalty).max(50),
  delay: z.object({
    /** Findings of these severities are assumed to hold the shipment at the border. */
    severities: z.array(z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'])).max(4),
    /** Days a held shipment waits (examination, corrected documents). */
    days: z.coerce.number().int().min(0).max(60),
    /** Demurrage and storage per container (or per shipment without containers) and day; a destination without one counts no hold. */
    perDay: z.partialRecord(Destination, z.object({ amount: Amount, currency: Currency })),
  }),
  /** Days from shipped on board (or, without a B/L date, from the shipment's creation) to arrival. */
  transitDays: z.object({ SEA: z.coerce.number().int().min(0).max(120), AIR: z.coerce.number().int().min(0).max(30), ROAD: z.coerce.number().int().min(0).max(30) }),
});
export type CostAssumptions = z.infer<typeof CostAssumptions>;

const AMPS_C005 = 'https://www.cbsa-asfc.gc.ca/trade-commerce/amps/contraventions-infractions/c005-eng.html';
const ISF_MITIGATION = 'https://www.cbp.gov/sites/default/files/assets/documents/2020-Feb/Mitigation-Guidelines-advance-electronic-cargo-information-requirement-2018.pdf';

/**
 * Defaults, checked on 2026-10-16 against the sources linked. AMPS C005 (Customs Act s. 7.1,
 * information not true, accurate and complete) is CAD 150 per document for a first occurrence,
 * 225 and 450 after. ISF liquidated damages are USD 5,000 per violation under the bond (19 CFR
 * 113.62 as amended for 19 CFR Part 149); CBP's mitigation guidelines often settle a first one for
 * 1,000 to 2,000. 19 CFR 141.86 sets no fixed amount for an incomplete invoice: its cost is the hold.
 * Mexico, the EU and the UK have no penalty entry yet (their sanctions depend on the duty at stake or
 * the case): their findings count the hold only, and the estimate lists them as "no penalty mapped".
 */
export const DEFAULT_COST_ASSUMPTIONS: CostAssumptions = {
  penalties: [
    {
      id: 'cbsa-amps-c005',
      destination: 'CA',
      // Invoice, B/L and certificate data reported to CBSA. Not X10 (container check digit, a carrier
      // matter), X23 (a price unusual for the account is not inaccurate) or X24 (purchase order).
      ruleIds: ['X1', 'X2', 'X3', 'X4', 'X5', 'X6', 'X7', 'X8', 'X9', 'X12', 'X13', 'X14', 'X16', 'X17', 'X18', 'X22', 'C1', 'C2', 'C3', 'T7', 'T8', 'T9'],
      label: 'CBSA AMPS C005: information on the invoice not true, accurate and complete (first occurrence)',
      reference: 'Customs Act s. 7.1; AMPS contravention C005, CAD 150 per document (225 second, 450 third)',
      url: AMPS_C005,
      amount: '150.00',
      currency: 'CAD',
    },
    {
      id: 'cbp-isf-ld',
      destination: 'US',
      // An inaccurate (X11), incomplete (U2) or late (U3) ISF.
      ruleIds: ['X11', 'U2', 'U3'],
      label: 'CBP ISF liquidated damages: inaccurate, incomplete or late Importer Security Filing',
      reference: '19 CFR Part 149; bond condition, 19 CFR 113.62: USD 5,000 per violation before mitigation',
      url: ISF_MITIGATION,
      amount: '5000.00',
      currency: 'USD',
    },
  ],
  delay: {
    severities: ['CRITICAL', 'HIGH'],
    days: 2,
    perDay: {
      CA: { amount: '200.00', currency: 'CAD' },
      US: { amount: '200.00', currency: 'USD' },
      MX: { amount: '200.00', currency: 'USD' },
      EU: { amount: '200.00', currency: 'EUR' },
      GB: { amount: '200.00', currency: 'GBP' },
    },
  },
  transitDays: { SEA: 14, AIR: 2, ROAD: 3 },
};
