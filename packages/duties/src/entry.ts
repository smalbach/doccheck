import type { Party } from '@doccheck/schemas';
import { add, dec, fmt, sum } from './decimal';
import { manufacturerId } from './mid';
import type { DutyContext, DutyEstimate, DutyInputs } from './types';

export const DRAFT_STATUS = 'Draft, not transmitted';

/** A party as the forms print it: name and one-line address. */
export interface FormParty {
  name: string;
  address: string;
}

const formParty = (p: Party | undefined): FormParty | undefined =>
  p ? { name: p.name, address: [...p.address.lines, p.address.city, p.address.region, p.address.postalCode, p.address.country].filter(Boolean).join(', ') } : undefined;

/** CBP Form 7501 (Entry Summary), prefilled from the documents and the estimate. Blank where only the filer knows. */
export interface Cbp7501Draft {
  form: 'CBP Form 7501';
  status: typeof DRAFT_STATUS;
  shipmentId: string;
  reference?: string;
  generatedAt: string;
  header: {
    /** Box 1: assigned by the filer. */
    filerCodeEntryNumber: string;
    /** Box 2. */
    entryType: string;
    /** Box 7. */
    entryDate: string;
    /** Box 8: vessel name. */
    importingCarrier: string;
    /** Box 9: 11 = vessel, container; 10 = vessel, non-container; 40 = air. */
    modeOfTransport: string;
    /** Box 10: one country, or MULTI. */
    countryOfOrigin: string;
    /** Box 12. */
    blOrAwbNumber: string;
    /** Box 13: when every line has the same manufacturer. */
    manufacturerId?: string;
    /** Box 14. */
    exportingCountry: string;
    /** Box 15. */
    exportDate: string;
    /** Box 19 (the Schedule K code is added by the filer). */
    foreignPortOfLading: string;
    /** Box 20 (the Schedule D code is added by the filer). */
    usPortOfUnlading: string;
    /** Box 24. */
    referenceNumber: string;
    /** Box 25. */
    ultimateConsignee?: FormParty;
    /** Box 26. */
    importerOfRecord?: FormParty;
  };
  lines: {
    /** Box 27. */
    lineNo: string;
    /** Box 28. */
    description: string;
    /** Box 29: 10-digit HTSUS (".__" where the statistical suffix is still missing), chapter 99 numbers below it. */
    htsus: string;
    chapter99: { number: string; rate: string; amount: string }[];
    adCvdCase?: string;
    /** Box 29 / 33: special program indicator ("S" = USMCA). */
    spi?: string;
    /** Box 31: net quantity in HTSUS units. */
    netQuantity: string;
    /** Box 32: entered value (whole dollars), charges (freight, insurance), relationship. */
    enteredValue: string;
    charges: string;
    relationship: 'Y' | 'N' | '';
    /** Box 33. */
    htsusRate: string;
    /** Box 34. */
    duty: string;
    manufacturerId?: string;
    countryOfOrigin: string;
  }[];
  /** Boxes 37-40: duty, tax, other fees by class code (499 MPF, 501 HMF), total. */
  totals: { duty: string; tax: string; other: { classCode: string; name: string; amount: string }[]; otherTotal: string; total: string };
  notes: string[];
}

/** CBSA Commercial Accounting Declaration (CARM; replaced the B3-3), prefilled. */
export interface CbsaCadDraft {
  form: 'CBSA CAD (formerly B3-3)';
  status: typeof DRAFT_STATUS;
  shipmentId: string;
  reference?: string;
  generatedAt: string;
  header: {
    /** Assigned on submission in the CARM portal / by the broker. */
    transactionNumber: string;
    importer?: FormParty;
    importerBusinessNumber: string;
    vendor: FormParty;
    countryOfExport: string;
    placeOfExport: string;
    directShipmentDate: string;
    modeOfTransport: string;
    portOfEntry: string;
    cargoControlNumber: string;
    currency: string;
    exchangeRate: string;
    exchangeRateSource: string;
    province?: string;
  };
  lines: {
    lineNo: string;
    description: string;
    countryOfOrigin: string;
    tariffTreatment: string;
    tariffTreatmentCode?: string;
    /** 10-digit classification number (".__" where the statistical suffix is missing). */
    classification: string;
    tariffItem: string;
    quantity: string;
    unitOfMeasure: string;
    /** 13 = transaction value, unrelated; 23 = transaction value, related (to confirm). */
    vfdCode: string;
    valueForCurrencyConversion: string;
    valueForDuty: string;
    customsDutyRate: string;
    customsDuty: string;
    surtax: string;
    simaFlag?: string;
    exciseTax: string;
    valueForTax: string;
    gstRate: string;
    gst: string;
  }[];
  totals: { customsDuty: string; surtax: string; exciseTax: string; gst: string; total: string; selfAssessedHst: string };
  notes: string[];
}

export type EntryDraft = Cbp7501Draft | CbsaCadDraft;

const missingSuffix = (code: string, digits = 10): string => {
  const have = code.replace(/\D/g, '').length;
  return have >= digits ? code : `${code}${'.__'.repeat(Math.ceil((digits - have) / 2))}`;
};

/**
 * The draft entry summary of the destination, built only from the estimate and the documents.
 * It is never transmitted: DocCheck has no ABI or CARM connection.
 */
export function entryDraft(ctx: DutyContext, estimate: DutyEstimate, inputs: DutyInputs = estimate.inputs): EntryDraft | undefined {
  if (!ctx.invoice || estimate.status === 'unavailable') return undefined;
  return ctx.destination === 'US' ? cbp7501(ctx, estimate, inputs) : cbsaCad(ctx, estimate, inputs);
}

function cbp7501(ctx: DutyContext, e: DutyEstimate, inputs: DutyInputs): Cbp7501Draft {
  const inv = ctx.invoice!.data;
  const bl = ctx.billOfLading?.data;
  const origins = [...new Set(e.lines.map((l) => l.origin).filter(Boolean))];
  const manufacturer = inv.seller;
  const mid = manufacturerId(manufacturer);
  const relationship = inputs.relatedParty === undefined ? '' : inputs.relatedParty ? 'Y' : 'N';
  const mode = ctx.transportMode ?? inv.transport?.mode ?? (bl ? 'SEA' : undefined);
  const modeCode = mode === 'AIR' ? '40 Air' : mode === 'ROAD' ? '30 Truck' : bl?.containers.length ? '11 Vessel, container' : '10 Vessel, non-container';
  const fees = e.fees.map((f) => ({ classCode: f.code === 'MPF' ? '499' : '501', name: f.name, amount: f.amount }));
  const otherTotal = sum(fees.map((f) => dec(f.amount)));
  const duty = add(dec(e.totals.duty), dec(e.totals.additional));
  const notes = [
    'Prefilled by DocCheck from the documents and its duty estimate. Not transmitted to CBP: the filer completes the codes, bond and port details and files through ABI.',
    ...(e.status === 'partial' ? ['Some lines have no duty: see the estimate findings.'] : []),
    ...(relationship === '' ? ['Box 32 relationship left blank: the related-party question is unanswered.'] : []),
    ...(e.lines.some((l) => !l.tariff?.classification) ? ['Lines marked ".__" need the statistical suffix.'] : []),
  ];
  return {
    form: 'CBP Form 7501',
    status: DRAFT_STATUS,
    shipmentId: ctx.shipmentId,
    ...(ctx.reference ? { reference: ctx.reference } : {}),
    generatedAt: e.generatedAt,
    header: {
      filerCodeEntryNumber: '',
      entryType: '01 Consumption',
      entryDate: e.entryDate,
      importingCarrier: [bl?.vessel, bl?.voyage].filter(Boolean).join(' / '),
      modeOfTransport: modeCode,
      countryOfOrigin: origins.length === 1 ? origins[0]! : origins.length > 1 ? 'MULTI' : '',
      blOrAwbNumber: bl?.blNumber ?? '',
      ...(mid ? { manufacturerId: mid } : {}),
      exportingCountry: bl?.portOfLoading.country ?? inv.transport?.placeOfShipment?.country ?? inv.seller.address.country ?? '',
      exportDate: bl?.shippedOnBoardDate ?? inv.shipmentDate ?? '',
      foreignPortOfLading: bl ? `${bl.portOfLoading.name}${bl.portOfLoading.unLocode ? ` (${bl.portOfLoading.unLocode})` : ''}` : '',
      usPortOfUnlading: bl ? `${bl.portOfDischarge.name}${bl.portOfDischarge.unLocode ? ` (${bl.portOfDischarge.unLocode})` : ''}` : (inv.portOfEntry?.name ?? ''),
      referenceNumber: ctx.reference ?? inv.invoiceNumber,
      ...(formParty(inv.consignee ?? bl?.consignee) ? { ultimateConsignee: formParty(inv.consignee ?? bl?.consignee) } : {}),
      ...(formParty(inv.buyer) ? { importerOfRecord: formParty(inv.buyer) } : {}),
    },
    lines: e.lines.map((l) => ({
      lineNo: String(l.lineNo).padStart(3, '0'),
      description: l.description,
      htsus: l.tariff ? (l.tariff.classification ?? missingSuffix(l.tariff.code)) : (l.hsInput ?? ''),
      chapter99: l.additional.map((a) => ({ number: a.heading ?? a.program, rate: `${a.percent}%`, amount: a.amount })),
      ...(l.adcvd.length ? { adCvdCase: l.adcvd.join(', ') } : {}),
      ...(l.treatment.code !== 'general' ? { spi: l.treatment.code } : {}),
      netQuantity: `${l.quantity.value} ${l.tariff?.units[0] ?? l.quantity.unit}`,
      enteredValue: fmt(dec(l.dutiableValue), 0),
      charges: fmt(add(dec(l.freight), dec(l.insurance)), 0),
      relationship,
      htsusRate: l.rate ?? '',
      duty: l.duty ?? '',
      ...(mid ? { manufacturerId: mid } : {}),
      countryOfOrigin: l.origin ?? '',
    })),
    totals: { duty: fmt(duty, 2), tax: '0.00', other: fees, otherTotal: fmt(otherTotal, 2), total: fmt(add(duty, otherTotal), 2) },
    notes,
  };
}

function cbsaCad(ctx: DutyContext, e: DutyEstimate, inputs: DutyInputs): CbsaCadDraft {
  const inv = ctx.invoice!.data;
  const bl = ctx.billOfLading?.data;
  const fx = e.exchange.find((r) => r.from === inv.currency);
  const vfd = inputs.relatedParty === undefined ? '' : inputs.relatedParty ? '23' : '13';
  const gst = e.taxes.find((t) => t.code === 'GST');
  const mode = ctx.transportMode ?? inv.transport?.mode ?? (bl ? 'SEA' : undefined);
  const lineGst = (l: DutyEstimate['lines'][number]) => l.taxes;
  const duty = dec(e.totals.duty);
  const surtax = dec(e.totals.additional);
  const gstTotal = dec(e.totals.taxesAtBorder);
  const notes = [
    'Prefilled by DocCheck from the documents and its duty estimate. Not transmitted to CBSA: the importer or broker completes the business number, cargo control number and release office and submits it in the CARM Client Portal or by EDI.',
    ...(e.status === 'partial' ? ['Some lines have no duty: see the estimate findings.'] : []),
    ...(vfd === '' ? ['VFD code left blank: the related-party question is unanswered.'] : []),
    ...(e.lines.some((l) => !l.tariff?.classification) ? ['Lines marked ".__" need the classification number (last two digits).'] : []),
    'Tariff treatment and VFD codes other than MFN, UST and MXT are named, not coded: check them against Memorandum D17-1-10.',
  ];
  return {
    form: 'CBSA CAD (formerly B3-3)',
    status: DRAFT_STATUS,
    shipmentId: ctx.shipmentId,
    ...(ctx.reference ? { reference: ctx.reference } : {}),
    generatedAt: e.generatedAt,
    header: {
      transactionNumber: '',
      ...(formParty(inv.consignee ?? inv.buyer) ? { importer: formParty(inv.consignee ?? inv.buyer) } : {}),
      importerBusinessNumber: (inv.consignee ?? inv.buyer).taxId ?? '',
      vendor: formParty(inv.seller)!,
      countryOfExport: bl?.portOfLoading.country ?? inv.transport?.placeOfShipment?.country ?? inv.seller.address.country ?? '',
      placeOfExport: bl?.portOfLoading.name ?? inv.transport?.placeOfShipment?.name ?? '',
      directShipmentDate: bl?.shippedOnBoardDate ?? inv.shipmentDate ?? '',
      modeOfTransport: mode === 'AIR' ? 'Air' : mode === 'ROAD' ? 'Highway' : 'Marine',
      portOfEntry: bl ? `${bl.portOfDischarge.name}${bl.portOfDischarge.unLocode ? ` (${bl.portOfDischarge.unLocode})` : ''}` : (inv.portOfEntry?.name ?? ''),
      cargoControlNumber: '',
      currency: inv.currency,
      exchangeRate: fx?.rate ?? '',
      exchangeRateSource: fx ? `${fx.source}, ${fx.date}` : '',
      ...(e.province ? { province: e.province.code } : {}),
    },
    lines: e.lines.map((l) => ({
      lineNo: String(l.lineNo),
      description: l.description,
      countryOfOrigin: l.origin ?? '',
      tariffTreatment: l.treatment.name,
      ...(l.treatment.cadCode ? { tariffTreatmentCode: l.treatment.cadCode } : {}),
      classification: l.tariff ? (l.tariff.classification ?? missingSuffix(l.tariff.code)) : (l.hsInput ?? ''),
      tariffItem: l.tariff?.code ?? '',
      quantity: l.quantity.value,
      unitOfMeasure: l.tariff?.units[0] ?? l.quantity.unit,
      vfdCode: vfd,
      valueForCurrencyConversion: l.invoiced.amount,
      valueForDuty: l.dutiableValue,
      customsDutyRate: l.rate ?? '',
      customsDuty: l.duty ?? '',
      surtax: l.additionalTotal,
      ...(l.adcvd.length ? { simaFlag: l.adcvd.join(', ') } : {}),
      exciseTax: '0.00',
      valueForTax: fmt(add(dec(l.dutiableValue), l.duty ? dec(l.duty) : 0n, dec(l.additionalTotal)), 2),
      gstRate: gst?.percent ?? '5',
      gst: lineGst(l),
    })),
    totals: { customsDuty: fmt(duty, 2), surtax: fmt(surtax, 2), exciseTax: '0.00', gst: fmt(gstTotal, 2), total: fmt(add(duty, surtax, gstTotal), 2), selfAssessedHst: e.totals.selfAssessedTaxes },
    notes,
  };
}
