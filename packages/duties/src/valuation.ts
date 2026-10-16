import type { CommercialInvoice, Destination, Evidence } from '@doccheck/schemas';
import { CITATIONS } from './citations';
import { add, dec, type Fixed, fmt, sub, sum } from './decimal';
import { type DutyFinding, DUTY_FINDINGS, type DutyFindingCode, type DutyInputs } from './types';

/** Seller pays the main carriage: the price includes international freight. */
export const SELLER_CARRIAGE = new Set(['CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP']);
/** Seller also insures the main carriage. */
export const SELLER_INSURANCE = new Set(['CIF', 'CIP']);

export function finding(code: DutyFindingCode, f: Omit<DutyFinding, 'code' | 'title'>): DutyFinding {
  return { code, title: DUTY_FINDINGS[code], ...f };
}

export interface ValuationAmount {
  /** Destination currency, full precision. */
  value: Fixed;
  original: { amount: string; currency: string };
  from: 'invoice' | 'input';
}

export interface ValuationInput {
  destination: Destination;
  invoiceId: string;
  invoice: CommercialInvoice;
  /** Converted to the destination currency; undefined when the currency has no rate. */
  lineValues: Fixed[];
  toDest: (amount: string, currency: string) => Fixed | undefined;
  inputs: DutyInputs;
  /** BL port of loading / place of shipment names, to tell an FCA place inland from the port. */
  placesOfShipment: string[];
  /** Air shipment: the air waybill prints no freight amount, so it cannot fill one in. */
  air?: boolean;
}

export interface ValuationResult {
  method: string;
  basis: string;
  chargesOnInvoice: 'separate' | 'included' | 'none';
  /** What the buyer pays the seller, destination currency. */
  pricePaid: Fixed;
  /** Charges added on top of the line totals (allocated to lines as part of the price). */
  chargesOnTop: Fixed;
  freightIncluded: Fixed;
  insuranceIncluded: Fixed;
  /** Paid by the buyer outside the invoice (E/F terms), for the landed cost. */
  buyerFreight: Fixed;
  buyerInsurance: Fixed;
  /** Paid by the buyer to the place of direct shipment (CA, EXW); part of value and landed cost. */
  inlandFreight: Fixed;
  /** Added to / deducted from the line totals, shipment level (allocated to lines by value). */
  adjustments: { kind: AdjustmentKind; value: Fixed; original: { amount: string; currency: string }; from: 'invoice' | 'input'; note: string }[];
  findings: DutyFinding[];
}

type AdjustmentKind = 'deduct-freight' | 'deduct-insurance' | 'add-packing' | 'add-inland-freight' | 'add-assists' | 'add-royalties';

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

/**
 * Customs value of the shipment from the invoice and its Incoterm.
 *
 * US (19 U.S.C. 1401a, 19 CFR 152.103): transaction value = price actually paid or payable, without
 * international freight and insurance (deducted from a C or D price when shown), plus packing,
 * assists and royalties paid as a condition of sale. An FOB / FCA / EXW price is used as is.
 *
 * CA (Customs Act s. 48): value for duty = price paid or payable, plus transportation and insurance
 * up to the place of direct shipment to Canada (s. 48(5)(a)(vi); added to an EXW price), minus
 * transportation and insurance from that place (s. 48(5)(b)(i); deducted from a C or D price when
 * shown separately), plus packing, assists and royalties.
 */
export function valuation(v: ValuationInput): ValuationResult {
  const { invoice, invoiceId, destination, inputs } = v;
  const code = invoice.incoterm?.code;
  const findings: DutyFinding[] = [];
  const adjustments: ValuationResult['adjustments'] = [];
  const ev = (field: string, value: string): Evidence => ({ documentId: invoiceId, field, value });
  const toDest = (m: { amount: string; currency: string }) => v.toDest(m.amount, m.currency) ?? 0n;

  const lineSum = sum(v.lineValues);
  const charges = invoice.charges ?? {};
  const chargeValues = (['freight', 'insurance', 'packing'] as const).map((k) => (charges[k] ? toDest(charges[k]!) : 0n));
  const chargesTotal = sum(chargeValues);
  const invoiceTotal = toDest(invoice.invoiceTotal);
  // Charges are on top when the total is the lines plus the charges; otherwise they are a breakdown
  // of what the line prices already include.
  const onTop = chargesTotal > 0n && abs(sub(invoiceTotal, add(lineSum, chargesTotal))) <= dec('0.01') * 2n;
  const chargesOnInvoice: ValuationResult['chargesOnInvoice'] = chargesTotal === 0n ? 'none' : onTop ? 'separate' : 'included';
  const pricePaid = onTop ? add(lineSum, chargesTotal) : lineSum;

  const sellerCarriage = code ? SELLER_CARRIAGE.has(code) : false;
  const sellerInsurance = code ? SELLER_INSURANCE.has(code) : false;
  const regulation = destination === 'US' ? CITATIONS.usPricePaid : CITATIONS.caTransportDeducted;
  const terms = code ? `${code}${invoice.incoterm?.place ? ' ' + invoice.incoterm.place : ''}` : undefined;

  let freightIncluded = 0n;
  let insuranceIncluded = 0n;
  let buyerFreight = 0n;
  let buyerInsurance = 0n;
  let inlandFreight = 0n;

  const deduct = (kind: 'freight' | 'insurance', fromInvoice: { amount: string; currency: string } | undefined, fromInput: { amount: string; currency: string } | undefined) => {
    const label = kind === 'freight' ? 'International freight' : 'Insurance';
    if (fromInvoice) {
      const value = toDest(fromInvoice);
      if (!onTop) adjustments.push({ kind: kind === 'freight' ? 'deduct-freight' : 'deduct-insurance', value: -value, original: fromInvoice, from: 'invoice', note: `${label} included in the ${terms} price, shown on the invoice` });
      return value;
    }
    if (fromInput) {
      const value = toDest(fromInput);
      adjustments.push({ kind: kind === 'freight' ? 'deduct-freight' : 'deduct-insurance', value: -value, original: fromInput, from: 'input', note: `${label} included in the ${terms} price, as entered` });
      return value;
    }
    findings.push(
      finding('D1', {
        severity: 'MEDIUM',
        message: `The terms of sale are ${terms}, so the price includes ${kind === 'freight' ? 'international freight' : 'insurance'}, but the invoice does not show how much. It cannot be deducted, and the ${destination === 'US' ? 'entered value' : 'value for duty'} below is overstated by that amount.`,
        suggestedFix: `Ask the seller to show the ${kind} amount on the invoice, or enter it from the freight bill${v.air ? ' (the air waybill does not give it)' : ''}.`,
        evidence: [ev('incoterm.code', code!), ev('invoiceTotal.amount', invoice.invoiceTotal.amount)],
        regulation,
        asks: kind,
      }),
    );
    return 0n;
  };

  if (sellerCarriage) {
    freightIncluded = deduct('freight', charges.freight, inputs.freight);
    if (sellerInsurance) insuranceIncluded = deduct('insurance', charges.insurance, inputs.insurance);
    else if (charges.insurance) insuranceIncluded = deduct('insurance', charges.insurance, undefined);
    if (code === 'DDP') {
      findings.push(
        finding('D1', {
          severity: 'LOW',
          message: 'The terms of sale are DDP: the price may include duties, taxes and delivery after import, which are not part of the customs value. Only the charges shown on the invoice were deducted.',
          suggestedFix: 'Ask the seller for the duties, taxes and post-import costs included in the price.',
          evidence: [ev('incoterm.code', code)],
          regulation,
        }),
      );
    }
  } else {
    // E and F terms: freight and insurance on the invoice (rare) are on top or a breakdown; what the buyer pays the carrier is outside the price.
    if (charges.freight && !onTop) freightIncluded = deduct('freight', charges.freight, undefined);
    if (charges.insurance && !onTop) insuranceIncluded = deduct('insurance', charges.insurance, undefined);
    if (inputs.freight) buyerFreight = toDest(inputs.freight);
    if (inputs.insurance) buyerInsurance = toDest(inputs.insurance);
  }
  if (onTop) {
    // Charges listed after the lines: freight and insurance are not in the line prices.
    if (charges.freight) freightIncluded = toDest(charges.freight);
    if (charges.insurance) insuranceIncluded = toDest(charges.insurance);
    if (charges.packing) adjustments.push({ kind: 'add-packing', value: toDest(charges.packing), original: charges.packing, from: 'invoice', note: 'Packing charged on the invoice, outside the line prices' });
  }

  // Canada: costs up to the place of direct shipment are part of the value for duty.
  if (destination === 'CA' && (code === 'EXW' || code === 'FCA')) {
    const place = invoice.incoterm?.place ?? '';
    const atPort = code === 'FCA' && v.placesOfShipment.some((p) => norm(p) && (norm(p).includes(norm(place)) || norm(place).includes(norm(p))));
    if (!atPort) {
      if (inputs.inlandFreight) {
        inlandFreight = toDest(inputs.inlandFreight);
        adjustments.push({ kind: 'add-inland-freight', value: inlandFreight, original: inputs.inlandFreight, from: 'input', note: `Transport from ${place || 'the seller'} to the place of direct shipment, as entered` });
      } else {
        findings.push(
          finding('D2', {
            severity: code === 'EXW' ? 'MEDIUM' : 'LOW',
            message: `The terms of sale are ${terms}: transport and handling from ${place || 'the seller'} to the place where the goods start their direct journey to Canada are part of the value for duty, and the invoice does not give them.`,
            suggestedFix: 'Enter the inland freight to the port or airport of export from the forwarder’s invoice.',
            evidence: [ev('incoterm.code', code), ...(place ? [ev('incoterm.place', place)] : [])],
            regulation: CITATIONS.caTransportAdded,
            asks: 'inlandFreight',
          }),
        );
      }
    }
  }

  // Assists and royalties: the documents never say; ask once.
  for (const [kind, money] of [
    ['add-assists', inputs.assists],
    ['add-royalties', inputs.royalties],
  ] as const) {
    if (money && dec(money.amount) > 0n) {
      adjustments.push({ kind, value: toDest(money), original: money, from: 'input', note: kind === 'add-assists' ? 'Assists supplied by the buyer, as entered' : 'Royalties or licence fees paid as a condition of sale, as entered' });
    }
  }
  if (!inputs.assists || !inputs.royalties) {
    findings.push(
      finding('D4', {
        severity: 'LOW',
        message: 'The documents do not say whether the buyer supplied moulds, tools, materials or designs free or at reduced cost (assists), or pays royalties or licence fees as a condition of sale. Either one is added to the customs value.',
        suggestedFix: 'Answer the assists and royalties questions (enter 0 when there are none).',
        evidence: [ev('seller.name', invoice.seller.name), ev('buyer.name', invoice.buyer.name)],
        regulation: destination === 'US' ? CITATIONS.usAdditions : CITATIONS.caAssistsRoyalties,
        asks: !inputs.assists ? 'assists' : 'royalties',
      }),
    );
  }

  if (inputs.relatedParty === undefined) {
    findings.push(
      finding('D3', {
        severity: 'LOW',
        message: `The documents do not say whether ${invoice.seller.name} and ${invoice.buyer.name} are related. The ${destination === 'US' ? '7501 (box 32)' : 'declaration (VFD code)'} needs the answer, and a related-party price is accepted only when the relationship did not influence it.`,
        suggestedFix: 'Answer the related-party question.',
        evidence: [ev('seller.name', invoice.seller.name), ev('buyer.name', invoice.buyer.name)],
        ...(destination === 'US' ? { regulation: CITATIONS.usRelated } : {}),
        asks: 'relatedParty',
      }),
    );
  } else if (inputs.relatedParty) {
    findings.push(
      finding('D3', {
        severity: 'MEDIUM',
        message: `${invoice.seller.name} and ${invoice.buyer.name} are related. The invoice price is the customs value only if the relationship did not influence it: keep the circumstances of sale or test values ready.`,
        suggestedFix: 'Document how the price was set (transfer pricing study, prices to unrelated buyers) before filing.',
        evidence: [ev('seller.name', invoice.seller.name), ev('buyer.name', invoice.buyer.name)],
        ...(destination === 'US' ? { regulation: CITATIONS.usRelated } : {}),
      }),
    );
  }

  return {
    method: destination === 'US' ? 'Transaction value (19 U.S.C. 1401a)' : 'Transaction value (Customs Act s. 48)',
    basis: destination === 'US' ? 'Price actually paid or payable, without international freight and insurance (FOB basis)' : 'Price paid or payable at the place of direct shipment to Canada (freight and insurance to the Canadian border excluded)',
    chargesOnInvoice,
    pricePaid,
    chargesOnTop: onTop ? chargesTotal : 0n,
    freightIncluded,
    insuranceIncluded,
    buyerFreight,
    buyerInsurance,
    inlandFreight,
    adjustments,
    findings,
  };
}

const abs = (x: Fixed): Fixed => (x < 0n ? -x : x);

export const fmtMoney = (x: Fixed): string => fmt(x, 2);
