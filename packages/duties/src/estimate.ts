import type { Destination, Evidence } from '@doccheck/schemas';
import { CITATIONS } from './citations';
import { add, allocate, clamp, dec, div, type Fixed, fmt, fmtRate, HUNDRED, max, mul, pct, round, sub, sum } from './decimal';
import { convert, type ExchangeRate, exchangeRate, manualRate } from './fx';
import { applyRate, normalizeUnit, rateLabel, type RateUnit } from './rates';
import { hsDigits, lookupTariff, type TariffLine } from './tariff';
import { type AdditionalDuty, type Agreement, type DutyTables, tableSources } from './tables';
import {
  CUSMA_ELEMENTS,
  type CusmaElement,
  type DutyContext,
  type DutyEstimate,
  type DutyFinding,
  type DutyInputs,
  type FeeLine,
  type LineEstimate,
  type TaxLine,
} from './types';
import { finding, valuation } from './valuation';

export const DISCLAIMER = 'Estimate for planning only, from the documents and the dated tables listed. It is not a customs ruling and nothing is filed with CBSA or CBP.';

const money = (x: Fixed) => fmt(x, 2);
const inRange = (date: string, from: string, to?: string | null) => date >= from && (!to || date <= to);
const hsMatches = (list: string[], digits: string) => list.some((h) => h === '*' || digits.startsWith(hsDigits(h)));
const originMatches = (list: string[], exclude: string[] | undefined, origin: string | undefined) =>
  !!origin && !(exclude ?? []).includes(origin) && (list.includes('*') || list.includes(origin));

/** Province names as addresses print them, to ISO 3166-2:CA codes. */
const PROVINCES: Record<string, string> = {
  ontario: 'ON', quebec: 'QC', québec: 'QC', 'british columbia': 'BC', 'colombie-britannique': 'BC', alberta: 'AB', manitoba: 'MB', saskatchewan: 'SK',
  'nova scotia': 'NS', 'nouvelle-écosse': 'NS', 'new brunswick': 'NB', 'nouveau-brunswick': 'NB', 'newfoundland and labrador': 'NL', 'terre-neuve-et-labrador': 'NL',
  'prince edward island': 'PE', 'île-du-prince-édouard': 'PE', yukon: 'YT', 'northwest territories': 'NT', 'territoires du nord-ouest': 'NT', nunavut: 'NU',
};
export function provinceCode(region: string | undefined): string | undefined {
  if (!region) return undefined;
  const r = region.trim();
  if (/^[A-Z]{2}$/.test(r.toUpperCase()) && Object.values(PROVINCES).includes(r.toUpperCase())) return r.toUpperCase();
  return PROVINCES[r.toLowerCase().replace(/\./g, '')];
}

export interface EstimateOptions {
  /** Today, for the default entry date and the generated-at stamp (passed in to keep the function pure). */
  today: string;
  generatedAt?: string;
}

/**
 * Duty, taxes and landed cost of a shipment, per line and in total, with the findings that
 * explain what could not be valued or classified. Pure: documents, inputs and tables in, estimate out.
 */
export function estimateDuties(ctx: DutyContext, inputsIn: DutyInputs | undefined, tables: DutyTables, opts: EstimateOptions): DutyEstimate {
  const inputs = inputsIn ?? {};
  const destination = ctx.destination;
  const currency = destination === 'CA' ? 'CAD' : 'USD';
  const entryDate = inputs.entryDate ?? opts.today;
  const findings: DutyFinding[] = [];
  const base = {
    shipmentId: ctx.shipmentId,
    destination,
    currency,
    entryDate,
    generatedAt: opts.generatedAt ?? `${opts.today}T00:00:00.000Z`,
    tables: tableSources(tables, destination),
    inputs,
    disclaimer: DISCLAIMER,
    cusma: [],
  };
  const empty = (reason: string): DutyEstimate => ({
    ...base,
    status: 'unavailable',
    unavailableReason: reason,
    exchange: [],
    valuation: { method: '', basis: '', chargesOnInvoice: 'none', priceInvoiced: '0.00', adjustments: [], dutiableValue: '0.00' },
    lines: [],
    fees: [],
    taxes: [],
    totals: zeroTotals(currency),
    findings,
  });
  if (!ctx.invoice) return empty('The shipment has no extracted commercial invoice.');
  const invoiceId = ctx.invoice.id;
  const invoice = ctx.invoice.data;
  const bl = ctx.billOfLading?.data;
  const ev = (field: string, value: string): Evidence => ({ documentId: invoiceId, field, value });

  // Exchange: the date of direct shipment (CA) / exportation (US), from the BL, else the invoice.
  const fxDate = bl?.shippedOnBoardDate ?? invoice.shipmentDate ?? bl?.dateOfIssue ?? invoice.invoiceDate ?? entryDate;
  const rates = new Map<string, ExchangeRate>();
  const missingFx = new Set<string>();
  const rateFor = (cur: string): ExchangeRate | undefined => {
    if (rates.has(cur)) return rates.get(cur);
    const manual = inputs.exchangeRates?.[cur];
    const fx = manual ? manualRate(destination, cur, manual, fxDate) : exchangeRate(tables, destination, cur, fxDate);
    if (fx) rates.set(cur, fx);
    else missingFx.add(cur);
    return fx;
  };
  const toDest = (amount: string, cur: string): Fixed | undefined => {
    const fx = rateFor(cur);
    return fx ? convert(dec(amount), fx) : undefined;
  };
  const invFx = rateFor(invoice.currency);
  if (!invFx) {
    findings.push(
      finding('D6', {
        severity: 'HIGH',
        message: `No ${destination === 'CA' ? 'Bank of Canada' : 'Federal Reserve H.10'} rate for ${invoice.currency} on or within 7 days before ${fxDate}: the invoice cannot be converted to ${currency}.`,
        suggestedFix: `Enter the exchange rate (${currency} per ${invoice.currency}) or refresh the rate tables (node scripts/fetch-duty-data.mjs --fx).`,
        evidence: [ev('currency', invoice.currency)],
        asks: 'exchangeRates',
      }),
    );
    return empty(`No exchange rate for ${invoice.currency} on ${fxDate}.`);
  }

  // Line values in the destination currency, at full precision.
  const lineValues = invoice.lines.map((l) => toDest(l.lineTotal.amount, l.lineTotal.currency) ?? toDest(l.lineTotal.amount, invoice.currency)!);
  const places = [bl?.portOfLoading?.name, bl?.placeOfReceipt?.name, invoice.transport?.placeOfShipment?.name].filter((p): p is string => !!p);
  const val = valuation({ destination, invoiceId, invoice, lineValues, toDest, inputs, placesOfShipment: places });
  findings.push(...val.findings);
  for (const cur of missingFx) {
    if (cur === invoice.currency) continue;
    findings.push(
      finding('D6', {
        severity: 'MEDIUM',
        message: `No exchange rate for ${cur} on ${fxDate}: amounts in ${cur} were left out of the estimate.`,
        suggestedFix: `Enter the exchange rate (${currency} per ${cur}).`,
        evidence: [ev('currency', invoice.currency)],
        asks: 'exchangeRates',
      }),
    );
  }

  // Shipment-level amounts split over lines in proportion to their value.
  const weights = lineValues;
  const split = (total: Fixed) => allocate(round(total, 2), weights);
  const adjustTotal = sum(val.adjustments.map((a) => a.value));
  const adjustByLine = split(adjustTotal);
  const priceByLine = split(val.pricePaid);
  const freightIncByLine = split(val.freightIncluded);
  const insuranceIncByLine = split(val.insuranceIncluded);
  const buyerFreightByLine = split(val.buyerFreight);
  const buyerInsByLine = split(val.buyerInsurance);
  const brokerage = inputs.brokerage ? (toDest(inputs.brokerage.amount, inputs.brokerage.currency) ?? 0n) : 0n;
  const otherByLine = split(add(val.inlandFreight, brokerage));

  // Net kilograms per line, for duties charged per kg, from the packing list groups that hold one SKU.
  const kgBySku = new Map<string, Fixed>();
  for (const p of ctx.packingList?.data.packages ?? []) {
    if (p.contents.length === 1 && p.contents[0].sku && p.netWeight) {
      const sku = p.contents[0].sku;
      kgBySku.set(sku, add(kgBySku.get(sku) ?? 0n, dec(p.netWeight.kg)));
    }
  }
  const singleLineKg = invoice.lines.length === 1 ? (invoice.netWeight?.kg ?? ctx.packingList?.data.totals.netWeight?.kg) : undefined;

  const claimed = inputs.preference ? tables.fta.agreements.find((a) => a.id.toLowerCase() === inputs.preference!.agreement.toLowerCase()) : undefined;
  if (inputs.preference && !claimed) {
    findings.push(
      finding('D7', {
        severity: 'MEDIUM',
        message: `"${inputs.preference.agreement}" is not an agreement DocCheck knows; the lines were estimated without a preference.`,
        evidence: [ev('lines[0].countryOfOrigin', invoice.lines[0]?.countryOfOrigin ?? '')],
        asks: 'preference',
      }),
    );
  }
  const additionalTable = destination === 'US' ? tables.usAdditional : tables.caAdditional;
  const unverified = new Map<string, AdditionalDuty>();
  const metalAsked: number[] = [];
  const adcvdCases = new Map<string, number[]>();

  const lines: LineEstimate[] = invoice.lines.map((line, i) => {
    const hsInput = inputs.tariffNumbers?.[String(line.lineNo)] ?? line.hsCode;
    const origin = line.countryOfOrigin;
    // US entered value is in whole dollars per line (7501 box 32); CA value for duty in cents.
    const rawValue = add(lineValues[i], adjustByLine[i]);
    const dutiable = destination === 'US' ? round(rawValue, 0) : round(rawValue, 2);
    const quantities: Partial<Record<RateUnit, Fixed>> = {};
    const unit = normalizeUnit(line.quantity.unit);
    if (unit) quantities[unit] = dec(line.quantity.value);
    const kg = (line.sku ? kgBySku.get(line.sku) : undefined) ?? (singleLineKg ? dec(singleLineKg) : undefined);
    if (kg !== undefined && quantities.kg === undefined) quantities.kg = kg;
    if (quantities.doz === undefined && quantities.no !== undefined) quantities.doz = div(quantities.no, dec(12));

    const out: LineEstimate = {
      lineNo: line.lineNo,
      index: i,
      description: line.description,
      ...(line.sku ? { sku: line.sku } : {}),
      ...(origin ? { origin } : {}),
      quantity: line.quantity,
      ...(hsInput ? { hsInput } : {}),
      treatment: destination === 'CA' ? { code: 'MFN', name: tables.fta.caTreatments.MFN.name, cadCode: tables.fta.caTreatments.MFN.code } : { code: 'general', name: 'General (column 1)' },
      invoiced: line.lineTotal,
      dutiableValue: money(dutiable),
      additional: [],
      additionalTotal: '0.00',
      fees: '0.00',
      taxes: '0.00',
      selfAssessedTaxes: '0.00',
      goods: money(sub(priceByLine[i], add(freightIncByLine[i], insuranceIncByLine[i]))),
      freight: money(add(freightIncByLine[i], buyerFreightByLine[i])),
      insurance: money(add(insuranceIncByLine[i], buyerInsByLine[i])),
      other: money(otherByLine[i]),
      options: [],
      adcvd: [],
      ...(kg !== undefined ? { netKg: fmt(kg, 3) } : {}),
    };

    if (!origin) {
      findings.push(
        finding('D13', {
          severity: 'MEDIUM',
          message: `Line ${line.lineNo} has no country of origin: the ${destination === 'CA' ? 'MFN' : 'general'} rate was used, and additional duties and preferences by origin could not be checked.`,
          suggestedFix: 'Ask the seller to state the country of origin of each line.',
          evidence: [ev(`lines[${i}].description`, line.description)],
          lineNo: line.lineNo,
        }),
      );
    }

    // Tariff line.
    if (!hsInput) {
      findings.push(
        finding('D5', {
          severity: 'HIGH',
          message: `Line ${line.lineNo} has no HS code: its duty cannot be estimated.`,
          suggestedFix: `Classify the goods and enter the ${destination === 'US' ? 'HTSUS' : 'Customs Tariff'} number for the line.`,
          evidence: [ev(`lines[${i}].description`, line.description)],
          asks: 'tariffNumbers',
          lineNo: line.lineNo,
        }),
      );
      return out;
    }
    const lookup = lookupTariff(tables, destination, hsInput);
    const candidates = lookup.candidates;
    if (lookup.match === 'none') {
      findings.push(
        finding('D5', {
          severity: 'HIGH',
          message: `${hsInput} on line ${line.lineNo} is not in the ${destination === 'US' ? 'HTSUS' : 'Customs Tariff'} table (${(destination === 'US' ? tables.usHts : tables.caTariff).meta.revision}).`,
          suggestedFix: 'Check the HS code; if it is right, refresh the tariff tables.',
          evidence: [ev(`lines[${i}].hsCode`, hsInput)],
          asks: 'tariffNumbers',
          lineNo: line.lineNo,
        }),
      );
      return out;
    }

    // Treatment: the claimed agreement when this line's origin is a party, otherwise MFN / general.
    const eligible = eligibleAgreements(tables.fta.agreements, destination, origin);
    const baseKey = destination === 'CA' ? 'MFN' : 'general';
    const keyFor = (a: Agreement) => (destination === 'CA' ? a.CA!.treatments[origin!] : a.US!.program);
    const dutyWith = (tl: TariffLine, key: string) => {
      const rate = tl.rates[key];
      if (!rate) return undefined;
      return { rate, app: applyRate(rate, dutiable, quantities) };
    };

    // With several lines under the subheading, take the one with the highest base duty and say so.
    let chosen: TariffLine;
    if (lookup.match === 'several') {
      const scored = candidates.map((c) => ({ c, d: dutyWith(c, baseKey)?.app.amount ?? -1n }));
      chosen = scored.reduce((a, b) => (b.d > a.d ? b : a)).c;
      const labels = candidates.map((c) => `${c.code} ${c.rates[baseKey] ? rateLabel(c.rates[baseKey]) : '?'}`);
      findings.push(
        finding('D5', {
          severity: 'MEDIUM',
          message: `${hsInput} on line ${line.lineNo} covers ${candidates.length} tariff lines with different rates (${labels.join('; ')}). The estimate uses the highest, ${chosen.code}.`,
          suggestedFix: `Classify the goods to ${destination === 'US' ? '10 digits (HTSUS)' : '10 digits (Customs Tariff)'} and enter the number for the line.`,
          evidence: [ev(`lines[${i}].hsCode`, hsInput)],
          asks: 'tariffNumbers',
          lineNo: line.lineNo,
        }),
      );
    } else {
      chosen = lookup.line!;
      if (!chosen.classification) {
        findings.push(
          finding('D5', {
            severity: 'LOW',
            message: `${hsInput} on line ${line.lineNo} gives the rate (${chosen.code}) but not the ${destination === 'US' ? 'statistical suffix' : 'classification number'} the ${destination === 'US' ? 'entry summary' : 'declaration'} needs.`,
            suggestedFix: `Enter the 10-digit ${destination === 'US' ? 'HTSUS' : 'Customs Tariff'} number for the line.`,
            evidence: [ev(`lines[${i}].hsCode`, hsInput)],
            asks: 'tariffNumbers',
            lineNo: line.lineNo,
          }),
        );
      }
    }
    out.tariff = {
      code: chosen.code,
      ...(chosen.classification ? { classification: chosen.classification } : {}),
      description: chosen.description,
      match: lookup.match,
      ...(lookup.match === 'several' ? { candidates: candidates.map((c) => ({ code: c.code, rate: c.rates[baseKey] ? rateLabel(c.rates[baseKey]) : '' })) } : {}),
      units: chosen.units,
    };

    let applied = { key: baseKey, agreement: undefined as Agreement | undefined };
    if (claimed && eligible.includes(claimed)) {
      const key = keyFor(claimed);
      if (key && chosen.rates[key]) applied = { key, agreement: claimed };
    }
    const baseDuty = dutyWith(chosen, baseKey);
    const appliedDuty = dutyWith(chosen, applied.key) ?? baseDuty;
    if (applied.agreement) {
      const t = destination === 'CA' ? tables.fta.caTreatments[applied.key] : undefined;
      out.treatment = { code: applied.key, name: t?.name ?? `${applied.agreement.name} (${applied.key})`, ...(t?.code ? { cadCode: t.code } : {}), agreement: applied.agreement.id };
    }
    if (!appliedDuty) return out;
    out.rate = rateLabel(appliedDuty.rate);
    const dutyAmount = appliedDuty.app.amount;
    if (dutyAmount === undefined) {
      findings.push(
        finding(appliedDuty.app.unparsed ? 'D5' : 'D11', {
          severity: 'MEDIUM',
          message: appliedDuty.app.unparsed
            ? `The rate of ${chosen.code} ("${appliedDuty.rate.text}") is not one DocCheck can compute: the duty of line ${line.lineNo} is left out.`
            : `The rate of ${chosen.code} is ${rateLabel(appliedDuty.rate)}, charged per ${appliedDuty.app.missingUnit}, and line ${line.lineNo} gives its quantity in ${line.quantity.unit}: its duty is left out.`,
          suggestedFix: appliedDuty.app.unparsed ? 'Compute this line by hand from the tariff text.' : `Give the quantity in ${appliedDuty.app.missingUnit} (net weight per line on the packing list).`,
          evidence: [ev(`lines[${i}].quantity.unit`, line.quantity.unit)],
          lineNo: line.lineNo,
        }),
      );
      return out;
    }
    const duty = round(dutyAmount, 2);
    out.duty = money(duty);

    // Savings: every agreement this line's origin could use, compared with what is applied.
    for (const a of eligible) {
      const key = keyFor(a);
      if (!key) continue;
      const d = dutyWith(chosen, key);
      if (!d || d.app.amount === undefined) continue;
      const pref = round(d.app.amount, 2);
      out.options.push({ agreement: a.id, treatment: key, rate: rateLabel(d.rate), duty: money(pref), saving: money(max(0n, sub(duty, pref))) });
    }

    // Additional duties in force on the entry date for this origin and line.
    const digits = hsDigits(chosen.classification ?? chosen.code);
    const active = additionalTable.entries.filter((e) => inRange(entryDate, e.effectiveFrom, e.effectiveTo) && originMatches(e.origins, e.excludeOrigins, origin) && hsMatches(e.hs, digits) && !(e.excludeHs && hsMatches(e.excludeHs, digits)) && !(e.exemptUnderPrograms ?? []).includes(applied.key));
    const groups = new Set(active.filter((e) => !e.notWith).map((e) => e.group).filter(Boolean));
    const stack = active.filter((e) => !e.notWith?.some((g) => groups.has(g)));
    const basePercent = appliedDuty.rate.free ? 0n : dutiable > 0n ? div(mul(duty, HUNDRED), dutiable) : 0n;
    for (const e of stack) {
      let baseValue = dutiable;
      let basis: 'value' | 'metalContent' = 'value';
      if (e.basis === 'metalContent') {
        const metal = inputs.metalContent?.[String(line.lineNo)];
        const m = metal ? toDest(metal.amount, metal.currency) : undefined;
        if (m !== undefined) {
          baseValue = round(m, destination === 'US' ? 0 : 2);
          basis = 'metalContent';
        } else metalAsked.push(line.lineNo);
      }
      const percent = e.kind === 'topUpTo' ? max(0n, sub(dec(e.percent), basePercent)) : dec(e.percent);
      const amount = round(pct(baseValue, percent), 2);
      if (e.kind === 'topUpTo' && amount === 0n) continue; // the regular duty already reaches the floor
      out.additional.push({ id: e.id, program: e.program, ...(e.heading ? { heading: e.heading } : {}), percent: fmtRate(percent), base: money(baseValue), amount: money(amount), basis, verified: e.verified, source: e.source });
      if (!e.verified) unverified.set(e.id, e);
    }
    out.additionalTotal = money(sum(out.additional.map((a) => dec(a.amount))));

    for (const c of tables.adcvd.cases) {
      if (c.destination === destination && origin && c.origins.includes(origin) && hsMatches(c.hs, digits) && inRange(entryDate, c.since, c.until)) {
        out.adcvd.push(c.caseNumber);
        adcvdCases.set(c.id, [...(adcvdCases.get(c.id) ?? []), line.lineNo]);
      }
    }
    if (destination === 'CA') {
      const excise = tables.caTaxes.exciseChapters.find((x) => digits.startsWith(x.chapter));
      if (excise) {
        findings.push(
          finding('D12', {
            severity: 'MEDIUM',
            message: `Line ${line.lineNo} (${chosen.code}): ${excise.note} It is not included in the estimate.`,
            evidence: [ev(`lines[${i}].hsCode`, hsInput)],
            lineNo: line.lineNo,
          }),
        );
      }
    }
    return out;
  });

  // Findings gathered across lines.
  for (const [id, lineNos] of adcvdCases) {
    const c = tables.adcvd.cases.find((x) => x.id === id)!;
    findings.push(
      finding('D9', {
        severity: 'HIGH',
        message: `${c.kind === 'SIMA' ? 'SIMA measure' : c.kind + ' order'} ${c.caseNumber} (${c.product} from ${c.origins.join(', ')}) may cover line${lineNos.length > 1 ? 's' : ''} ${lineNos.join(', ')}. ${c.kind === 'SIMA' ? 'Anti-dumping or countervailing duty' : 'A cash deposit'} would be due on top of the estimate, which does not compute it.`,
        suggestedFix: `Check the scope of ${c.caseNumber} and the producer's rate${c.url ? ` (${c.url})` : ''}.`,
        evidence: lineNos.map((n) => {
          const i = invoice.lines.findIndex((l) => l.lineNo === n);
          return ev(`lines[${i}].hsCode`, invoice.lines[i].hsCode ?? '');
        }),
      }),
    );
  }
  if (metalAsked.length) {
    findings.push(
      finding('D10', {
        severity: 'MEDIUM',
        message: `Section 232 is charged on the value of the steel or aluminium content, which the invoice does not give for line${metalAsked.length > 1 ? 's' : ''} ${metalAsked.join(', ')}: the estimate charges it on the whole line value.`,
        suggestedFix: 'Enter the metal content value per line from the supplier.',
        evidence: metalAsked.map((n) => {
          const i = invoice.lines.findIndex((l) => l.lineNo === n);
          return ev(`lines[${i}].lineTotal.amount`, invoice.lines[i].lineTotal.amount);
        }),
        asks: 'metalContent',
      }),
    );
  }
  if (unverified.size) {
    findings.push(
      finding('D10', {
        severity: 'LOW',
        message: `Additional duties applied from table entries not checked against the official list: ${[...unverified.values()].map((e) => `${e.program}${e.heading ? ' (' + e.heading + ')' : ''}`).join('; ')}.`,
        suggestedFix: `Confirm the coverage and rate in ${destination === 'US' ? 'HTSUS chapter 99' : 'the surtax order'} before relying on the amount.`,
        evidence: [ev('lines[0].hsCode', invoice.lines[0]?.hsCode ?? '')],
      }),
    );
  }
  if (additionalTable.meta.validThrough && entryDate > additionalTable.meta.validThrough) {
    findings.push(
      finding('D10', {
        severity: 'MEDIUM',
        message: `The additional-duty table was last checked on ${additionalTable.meta.validThrough} and the entry date is ${entryDate}: notices published since then are not included.`,
        suggestedFix: `Update data/duties/${destination === 'US' ? 'us-additional-duties' : 'ca-surtaxes'}.json.`,
        evidence: [ev('invoiceNumber', invoice.invoiceNumber)],
      }),
    );
  }
  if (destination === 'US' && additionalTable.originsReviewed.length) {
    const notReviewed = [...new Set(lines.map((l) => l.origin).filter((o): o is string => !!o && !additionalTable.originsReviewed.includes(o)))];
    if (notReviewed.length) {
      findings.push(
        finding('D10', {
          severity: 'LOW',
          message: `The additional-duty table has not been reviewed for origin ${notReviewed.join(', ')}: country-specific duties for it may be missing from the estimate.`,
          suggestedFix: 'Check HTSUS chapter 99 for the origin.',
          evidence: lines.filter((l) => l.origin && notReviewed.includes(l.origin)).map((l) => ev(`lines[${l.index}].countryOfOrigin`, l.origin!)),
        }),
      );
    }
  }

  // Fees (US): MPF on the entered value (not on USMCA goods), HMF on ocean cargo.
  const fees: FeeLine[] = [];
  const feeByLine = invoice.lines.map(() => 0n);
  const dutiableByLine = lines.map((l) => dec(l.dutiableValue));
  if (destination === 'US') {
    const mpf = tables.usFees.mpf.find((p) => inRange(entryDate, p.from, p.to));
    const mpfWeights = lines.map((l, i) => (l.treatment.code === 'S' ? 0n : dutiableByLine[i]));
    const mpfBase = sum(mpfWeights);
    if (mpf && mpfBase > 0n) {
      const raw = pct(mpfBase, dec(mpf.percent));
      const amount = round(clamp(raw, dec(mpf.minimum), dec(mpf.maximum)), 2);
      const informal = mpfBase < dec(tables.usFees.informalEntryLimit);
      fees.push({
        code: 'MPF',
        name: 'Merchandise processing fee',
        base: money(mpfBase),
        percent: mpf.percent,
        amount: money(amount),
        note: `${mpf.percent} % with a minimum of ${mpf.minimum} and a maximum of ${mpf.maximum} (${mpf.from} to ${mpf.to})${informal ? `; under ${tables.usFees.informalEntryLimit} USD the goods may go on an informal entry with a flat fee instead` : ''}${mpfBase < sum(dutiableByLine) ? '; USMCA-originating lines are exempt' : ''}.`,
        source: mpf.source,
      });
      allocate(amount, mpfWeights).forEach((a, i) => (feeByLine[i] += a));
    }
    const mode = ctx.transportMode ?? invoice.transport?.mode ?? (bl ? 'SEA' : undefined);
    const hmf = tables.usFees.hmf.find((h) => inRange(entryDate, h.from, h.to) && mode && h.modes.includes(mode));
    const total = sum(dutiableByLine);
    if (hmf && total > 0n) {
      const amount = round(pct(total, dec(hmf.percent)), 2);
      fees.push({ code: 'HMF', name: 'Harbor maintenance fee', base: money(total), percent: hmf.percent, amount: money(amount), note: 'Ocean cargo unloaded at a US port.', source: hmf.source });
      allocate(amount, dutiableByLine).forEach((a, i) => (feeByLine[i] += a));
    }
  }
  lines.forEach((l, i) => (l.fees = money(feeByLine[i])));

  // Taxes (CA): GST on value for duty + duties at the border; the provincial part of the HST is self-assessed.
  const taxes: TaxLine[] = [];
  let province: DutyEstimate['province'];
  const borderTaxByLine = invoice.lines.map(() => 0n);
  const selfTaxByLine = invoice.lines.map(() => 0n);
  if (destination === 'CA') {
    const fromConsignee = provinceCode((invoice.consignee ?? bl?.consignee)?.address.region);
    const fromBuyer = provinceCode(invoice.buyer.address.region);
    const code = inputs.province ?? fromConsignee ?? fromBuyer;
    const prov = code ? tables.caTaxes.provinces.find((p) => p.province === code && inRange(entryDate, p.from, p.to)) : undefined;
    if (prov) province = { code: prov.province, name: prov.name, from: inputs.province ? 'input' : fromConsignee ? 'consignee' : 'buyer' };
    const gstPercent = dec(tables.caTaxes.gst.percent);
    const gstBase = lines.map((l, i) => add(dutiableByLine[i], l.duty ? dec(l.duty) : 0n, dec(l.additionalTotal)));
    const gstByLine = gstBase.map((b) => round(pct(b, gstPercent), 2));
    gstByLine.forEach((g, i) => (borderTaxByLine[i] += g));
    taxes.push({ code: 'GST', name: 'Goods and services tax', base: money(sum(gstBase)), percent: tables.caTaxes.gst.percent, amount: money(sum(gstByLine)), atBorder: true, note: 'Collected by CBSA on the value for duty plus duties and surtaxes.', source: tables.caTaxes.gst.source });
    if (prov?.hst) {
      const provincialPercent = sub(dec(prov.hst), gstPercent);
      const byLine = gstBase.map((b) => round(pct(b, provincialPercent), 2));
      byLine.forEach((g, i) => (selfTaxByLine[i] += g));
      taxes.push({
        code: 'HST',
        name: `Provincial part of the HST (${prov.name}, ${prov.hst} % in total)`,
        base: money(sum(gstBase)),
        percent: fmtRate(provincialPercent),
        amount: money(sum(byLine)),
        atBorder: false,
        note: 'Not collected by CBSA on commercial goods: self-assessed unless the importer is a registrant entitled to a full input tax credit.',
        source: 'Excise Tax Act, s. 218.1 and 220.07',
      });
    } else if (prov?.pst) {
      taxes.push({ code: 'PST', name: `${prov.pst.name} (${prov.name})`, base: money(sum(gstBase)), percent: prov.pst.percent, atBorder: false, note: 'Provincial tax, not collected at the border; self-assessed or exempt for goods bought for resale. Not included in the totals.', source: `${prov.name} provincial sales tax legislation` });
    } else if (!prov) {
      findings.push(
        finding('D14', {
          severity: 'LOW',
          message: 'The province of the consignee is not on the documents: the provincial part of the HST could not be worked out (the 5 % GST is included).',
          suggestedFix: 'Enter the province the goods are delivered to.',
          evidence: [ev('buyer.address.region', invoice.buyer.address.region ?? '')],
          asks: 'province',
        }),
      );
    }
  }
  lines.forEach((l, i) => {
    l.taxes = money(borderTaxByLine[i]);
    l.selfAssessedTaxes = money(selfTaxByLine[i]);
    if (l.duty !== undefined) {
      l.landedCost = money(add(dec(l.goods), dec(l.freight), dec(l.insurance), dec(l.other), dec(l.duty), dec(l.additionalTotal), feeByLine[i], borderTaxByLine[i]));
    }
  });

  // Preference: claimed without (complete) proof, or not claimed where it would save duty.
  let preference: DutyEstimate['preference'];
  const cusmaHints: DutyEstimate['cusma'] = [];
  if (claimed) {
    const claimedLines = lines.filter((l) => l.treatment.agreement === claimed.id).map((l) => l.lineNo);
    const missing: CusmaElement[] = [];
    let certification: NonNullable<DutyEstimate['preference']>['certification'] = 'not-checked';
    if (claimed.certification === 'cusma') {
      const cert = inputs.preference?.certification ?? {};
      missing.push(...CUSMA_ELEMENTS.filter((e) => !cert[e]));
      certification = missing.length === CUSMA_ELEMENTS.length ? 'missing' : missing.length ? 'incomplete' : 'complete';
    } else certification = inputs.preference?.proofOnFile ? 'complete' : 'missing';
    preference = { agreement: claimed.id, name: claimed.name, lines: claimedLines, certification, missingElements: missing };
    const evidence = claimedLines.length ? claimedLines.map((n) => ev(`lines[${invoice.lines.findIndex((l) => l.lineNo === n)}].countryOfOrigin`, invoice.lines.find((l) => l.lineNo === n)?.countryOfOrigin ?? '')) : [ev('lines[0].countryOfOrigin', invoice.lines[0]?.countryOfOrigin ?? '')];
    if (claimedLines.length === 0) {
      findings.push(
        finding('D7', {
          severity: 'HIGH',
          message: `${claimed.id} is claimed, but no line has an origin that is a party to it for ${destination === 'CA' ? 'Canada' : 'the US'} (origins: ${[...new Set(lines.map((l) => l.origin ?? '?'))].join(', ')}).`,
          suggestedFix: 'Remove the claim or correct the country of origin.',
          evidence,
          asks: 'preference',
        }),
      );
    } else if (certification === 'missing' || certification === 'incomplete') {
      findings.push(
        finding('D7', {
          severity: certification === 'missing' ? 'HIGH' : 'MEDIUM',
          message:
            claimed.certification === 'cusma'
              ? certification === 'missing'
                ? `${claimed.id} treatment is claimed on line${claimedLines.length > 1 ? 's' : ''} ${claimedLines.join(', ')} without a certification of origin.`
                : `The CUSMA certification of origin lacks ${missing.length} of the 9 minimum data elements: ${missing.join(', ')}.`
              : `${claimed.id} treatment is claimed on line${claimedLines.length > 1 ? 's' : ''} ${claimedLines.join(', ')} without the proof of origin on file (${claimed.proof}).`,
          suggestedFix: `Get the ${claimed.proof.toLowerCase()} before the entry, or enter the goods at the ${destination === 'CA' ? 'MFN' : 'general'} rate.`,
          evidence,
          regulation: claimed.certification === 'cusma' || claimed.certification === 'cptpp' ? CITATIONS.cusmaCertification : CITATIONS.proofOfOrigin,
          asks: 'preference',
        }),
      );
    }
    // Shipped through a non-party: direct transport must be shown.
    const parties = new Set([...(claimed.US?.origins ?? []), ...Object.keys(claimed.CA?.treatments ?? {}), destination]);
    const loading = bl?.portOfLoading?.country;
    if (claimedLines.length && loading && !parties.has(loading)) {
      findings.push(
        finding('D7', {
          severity: 'LOW',
          message: `The goods were loaded in ${loading}, which is not a party to ${claimed.id}: the preference holds only if they stayed under customs control there (no further processing).`,
          suggestedFix: 'Keep the through bill of lading or the transit documents with the proof of origin.',
          evidence: [{ documentId: ctx.billOfLading!.id, field: 'portOfLoading.country', value: loading }],
        }),
      );
    }
  }
  const savingsByAgreement = new Map<string, { saving: Fixed; lines: number[] }>();
  for (const l of lines) {
    if (l.treatment.agreement) continue;
    for (const o of l.options) {
      const s = dec(o.saving ?? '0');
      if (s <= 0n) continue;
      const acc = savingsByAgreement.get(o.agreement) ?? { saving: 0n, lines: [] };
      acc.saving += s;
      acc.lines.push(l.lineNo);
      savingsByAgreement.set(o.agreement, acc);
    }
  }
  for (const [id, s] of savingsByAgreement) {
    const a = tables.fta.agreements.find((x) => x.id === id)!;
    findings.push(
      finding('D8', {
        severity: 'LOW',
        message: `Line${s.lines.length > 1 ? 's' : ''} ${s.lines.join(', ')} ${s.lines.length > 1 ? 'have' : 'has'} an origin covered by ${a.name}: if the goods qualify, the preference would save about ${money(s.saving)} ${currency} in duty.`,
        suggestedFix: `Check the rule of origin with the supplier and get the ${a.proof.toLowerCase()}.`,
        evidence: s.lines.map((n) => {
          const i = invoice.lines.findIndex((x) => x.lineNo === n);
          return ev(`lines[${i}].countryOfOrigin`, invoice.lines[i].countryOfOrigin ?? '');
        }),
        regulation: a.certification === 'cusma' || a.certification === 'cptpp' ? CITATIONS.cusmaCertification : CITATIONS.proofOfOrigin,
        asks: 'preference',
      }),
    );
  }
  const cusma = tables.fta.agreements.find((a) => a.id === 'CUSMA')!;
  for (const l of lines) {
    if (!l.origin || !eligibleAgreements([cusma], destination, l.origin).length) continue;
    const ch = (l.tariff?.code ?? l.hsInput ?? '').slice(0, 2);
    const hint = tables.fta.cusmaHints.find((h) => ch >= h.chapters[0] && ch <= h.chapters[1])?.hint ?? tables.fta.cusmaDefaultHint;
    cusmaHints.push({ lineNo: l.lineNo, origin: l.origin, hint });
  }

  // Totals (lines without a duty are left out of the landed cost and flagged as incomplete).
  const computed = lines.filter((l) => l.duty !== undefined);
  const t = (pick: (l: LineEstimate) => string, from = lines) => sum(from.map((l) => dec(pick(l))));
  const duty = t((l) => l.duty!, computed);
  const additional = t((l) => l.additionalTotal);
  const feeTotal = sum(fees.map((f) => dec(f.amount)));
  const taxesAtBorder = sum(taxes.filter((x) => x.atBorder && x.amount).map((x) => dec(x.amount!)));
  const selfAssessed = sum(taxes.filter((x) => !x.atBorder && x.code === 'HST' && x.amount).map((x) => dec(x.amount!)));
  const complete = computed.length === lines.length;
  const totals = {
    currency,
    invoiced: money(val.pricePaid),
    dutiableValue: money(sum(dutiableByLine)),
    duty: money(duty),
    additional: money(additional),
    fees: money(feeTotal),
    taxesAtBorder: money(taxesAtBorder),
    selfAssessedTaxes: money(selfAssessed),
    payableAtBorder: money(add(duty, additional, feeTotal, taxesAtBorder)),
    goods: money(t((l) => l.goods, computed)),
    freight: money(t((l) => l.freight, computed)),
    insurance: money(t((l) => l.insurance, computed)),
    other: money(t((l) => l.other, computed)),
    landedCost: money(t((l) => l.landedCost!, computed)),
    complete,
  };

  return {
    ...base,
    cusma: cusmaHints,
    status: complete ? 'ok' : 'partial',
    invoice: { documentId: invoiceId, number: invoice.invoiceNumber, currency: invoice.currency, ...(invoice.incoterm ? { incoterm: invoice.incoterm.code, incotermPlace: invoice.incoterm.place } : {}), total: invoice.invoiceTotal.amount },
    exchange: [...rates.values()].map((r) => ({ from: r.from, to: r.to, rate: fmtRate(r.rate), published: r.published, direction: r.direction, date: r.date, requestedDate: r.requestedDate, source: r.source, ...(r.manual ? { manual: true } : {}) })),
    valuation: {
      method: val.method,
      basis: val.basis,
      ...(invoice.incoterm ? { incoterm: `${invoice.incoterm.code} ${invoice.incoterm.place}`.trim() } : {}),
      chargesOnInvoice: val.chargesOnInvoice,
      priceInvoiced: money(val.pricePaid),
      adjustments: val.adjustments.map((a) => ({ kind: a.kind, amount: money(a.value), original: a.original, from: a.from, note: a.note })),
      dutiableValue: money(sum(dutiableByLine)),
    },
    lines,
    fees,
    taxes,
    ...(province ? { province } : {}),
    totals,
    ...(preference ? { preference } : {}),
    findings: sortFindings(findings),
  };
}

function eligibleAgreements(agreements: Agreement[], destination: Destination, origin: string | undefined): Agreement[] {
  if (!origin) return [];
  return agreements.filter((a) => (destination === 'CA' ? !!a.CA?.treatments[origin] : !!a.US?.origins.includes(origin)));
}

const SEVERITY_ORDER = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 } as const;
function sortFindings(f: DutyFinding[]): DutyFinding[] {
  return f.map((x, i) => ({ x, i })).sort((a, b) => SEVERITY_ORDER[a.x.severity] - SEVERITY_ORDER[b.x.severity] || a.i - b.i).map(({ x }) => x);
}

function zeroTotals(currency: string): DutyEstimate['totals'] {
  const z = '0.00';
  return { currency, invoiced: z, dutiableValue: z, duty: z, additional: z, fees: z, taxesAtBorder: z, selfAssessedTaxes: z, payableAtBorder: z, goods: z, freight: z, insurance: z, other: z, landedCost: z, complete: false };
}
