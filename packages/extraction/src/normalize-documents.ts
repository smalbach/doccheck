import { isValidAwbNumber } from '@doccheck/rules';
import {
  AirWaybill, Airport, ArrivalNotice, CertificateOfOrigin, CusmaCertification, DangerousGoodsDeclaration, Money, WoodPackagingCertificate,
  type Quantity,
} from '@doccheck/schemas';
import {
  clean, countryCode, currencyCode, decimal, finish, htsCode, integer, isoDate, localeFor, party, place, prune, quantityUnit, transportMode, valid, weight, withLocale,
  type NormalizeResult,
} from './normalize';
import type { RawWeight } from './raw-schemas';
import type { RawAirport, RawAirWaybill, RawArrivalNotice, RawCertificateOfOrigin, RawCusmaCertification, RawDangerousGoods, RawWoodPackagingCertificate } from './raw-schemas-documents';

/**
 * Printed text -> canonical values for the other freight documents, in the same way as normalize.ts:
 * pure functions, no model, tested.
 */

/** "176-12345675" | "176 1234 5675" | "17612345675" -> "176-12345675"; a house number that is not in the IATA format stays as printed. */
export function awbNumber(s: string | null | undefined): string | null {
  const t = clean(s)?.toUpperCase().replace(/^(MAWB|HAWB|AWB)\s*(NO\.?|#)?:?\s*/, '');
  if (!t) return null;
  const digits = t.replace(/[\s-]/g, '');
  return /^\d{11}$/.test(digits) ? `${digits.slice(0, 3)}-${digits.slice(3)}` : t.replace(/\s+/g, '');
}

/** "Shanghai Pudong (PVG)" | "PVG" | name and code apart -> { name, iata }. */
export function airport(a: RawAirport | null | undefined): Airport | undefined {
  let name = clean(a?.name);
  let code = clean(a?.code)?.toUpperCase();
  const inName = name?.match(/^(.*?)\s*[(\-–,]\s*([A-Z]{3})\)?$/);
  if (inName && !code) {
    name = inName[1] || inName[2];
    code = inName[2];
  }
  if (!name && code) name = code;
  if (name && /^[A-Z]{3}$/.test(name) && !code) code = name;
  if (!name) return undefined;
  return prune({ name, iata: code && /^[A-Z]{3}$/.test(code) ? code : undefined });
}

/** PP, PPD, PREPAID, "WT/VAL PP" -> PREPAID; CC, COLL, COLLECT -> COLLECT. */
export function freightTerms(s: string | null | undefined): 'PREPAID' | 'COLLECT' | undefined {
  const t = clean(s)?.toUpperCase() ?? '';
  if (/PREPAID|\bPPD?\b|\bP\/P\b/.test(t)) return 'PREPAID';
  if (/COLLECT|\bCOLL?\b|\bCC\b|\bC\/C\b/.test(t)) return 'COLLECT';
  return undefined;
}

/** "UN 3480" | "un3480" | "3480" -> "UN3480". */
export function unNumber(s: string | null | undefined): string | null {
  const m = clean(s)?.toUpperCase().match(/^(?:UN|NA)?[\s-]*(\d{4})$/);
  return m ? `UN${m[1]}` : null;
}

/** "Class 9" | "9" | "2.1" | "Div. 5.1" -> "9", "2.1", "5.1". */
export function hazardClass(s: string | null | undefined): string | null {
  const m = clean(s)?.match(/(\d(?:\.\d)?)/);
  return m ? m[1] : null;
}

/** "PG II" | "II" | "2" | "Packing group III" -> "II" / "III". */
export function packingGroup(s: string | null | undefined): 'I' | 'II' | 'III' | null {
  const t = clean(s)?.toUpperCase().replace(/^(PACKING GROUP|PG|P\.G\.)\s*/, '');
  if (!t) return null;
  const roman = { '1': 'I', '2': 'II', '3': 'III', I: 'I', II: 'II', III: 'III' } as const;
  return roman[t as keyof typeof roman] ?? null;
}

/** Air waybills print the weight unit as one letter in the kg/lb column: K or L. */
const awbWeight = (w: RawWeight | null) => {
  const unit = clean(w?.unit)?.toUpperCase();
  return weight(w && (unit === 'K' || unit === 'L') ? { ...w, unit: unit === 'K' ? 'KG' : 'LB' } : w);
};

const quantity = (value: string | null, unit: string | null): Quantity | undefined => {
  const v = decimal(value);
  return v ? { value: v, unit: quantityUnit(unit) ?? 'PCS' } : undefined;
};

/** Issuer conventions from the airport of departure's country is unknown on an AWB; the shipper's country decides. */
export function normalizeAirWaybill(raw: RawAirWaybill): NormalizeResult<AirWaybill> {
  return withLocale(localeFor(raw.shipper?.country), () => {
    const issues: string[] = [];
    const title = clean(raw.documentTitle)?.toUpperCase() ?? '';
    const number = awbNumber(raw.awbNumber);
    const master = awbNumber(raw.masterAwbNumber);
    const house = /HOUSE|HAWB/.test(title) || (!!master && master !== number);
    const issuer = house ? 'HAWB' : /MASTER|MAWB|AIR ?WAYBILL/.test(title) || (number && isValidAwbNumber(number)) ? 'MAWB' : undefined;
    const flights = raw.flights
      .map((f) => prune({ flight: clean(f.flight)?.toUpperCase() ?? undefined, date: isoDate(f.date) ?? undefined }))
      .filter((f) => !!f.flight);
    const routing = raw.routing.map((r) => clean(r)?.toUpperCase()).filter((r): r is string => !!r && /^[A-Z]{3}$/.test(r));
    const prefix = number?.match(/^(\d{3})-/)?.[1] ?? master?.match(/^(\d{3})-/)?.[1];
    return finish(
      AirWaybill,
      prune({
        awbNumber: number ?? '',
        issuer,
        masterAwbNumber: house && master && /^\d{3}-\d{8}$/.test(master) ? master : undefined,
        carrier: clean(raw.carrierName) ? prune({ name: clean(raw.carrierName), iataPrefix: issuer === 'MAWB' ? prefix : undefined }) : undefined,
        shipper: party(raw.shipper, 'shipper', issues),
        consignee: party(raw.consignee, 'consignee', issues),
        notifyParty: party(raw.notifyParty, 'notifyParty', issues),
        airportOfDeparture: airport(raw.airportOfDeparture),
        airportOfDestination: airport(raw.airportOfDestination),
        routing: routing.length ? routing : undefined,
        flights: flights.length ? flights : undefined,
        pieces: integer(raw.numberOfPieces) ?? undefined,
        grossWeight: awbWeight(raw.grossWeight) ?? undefined,
        chargeableWeight: awbWeight(raw.chargeableWeight) ?? undefined,
        volumeM3: decimal(raw.volume) ?? undefined,
        natureOfGoods: clean(raw.natureOfGoods) ?? '',
        freightTerms: freightTerms(raw.freightTerms),
        handlingInformation: clean(raw.handlingInformation) ?? undefined,
        references: raw.references.map((r) => clean(r)).filter((r): r is string => !!r).length ? raw.references.map((r) => clean(r)).filter((r): r is string => !!r) : undefined,
        placeOfExecution: clean(raw.placeOfExecution) ?? undefined,
        executedOn: isoDate(raw.executedOn) ?? undefined,
      }),
      issues,
    );
  });
}

const refs = (list: string[]) => {
  const kept = list.map((r) => clean(r)).filter((r): r is string => !!r && /\d/.test(r));
  return kept.length ? kept : undefined;
};

/** HS code as printed with dots ("9503.00"), digits regrouped when printed without them ("950300" -> "9503.00"). */
function hsPrinted(s: string | null | undefined): string | undefined {
  const digits = htsCode(s);
  if (!digits) return undefined;
  return digits.replace(/^(\d{4})(\d{2})(\d{0,2})(\d{0,2})$/, (_, a, b, c, d) => [a, b, c, d].filter(Boolean).join('.'));
}

/** Issuer conventions from the exporter's country. */
export function normalizeCertificateOfOrigin(raw: RawCertificateOfOrigin): NormalizeResult<CertificateOfOrigin> {
  return withLocale(localeFor(raw.exporter?.country), () => {
    const issues: string[] = [];
    const origin = countryCode(raw.countryOfOrigin);
    if (clean(raw.countryOfOrigin) && !origin) issues.push(`countryOfOrigin: could not normalize ${JSON.stringify(raw.countryOfOrigin)}`);
    return finish(
      CertificateOfOrigin,
      prune({
        certificateNumber: clean(raw.certificateNumber) ?? undefined,
        issuer: clean(raw.issuer) ?? undefined,
        exporter: party(raw.exporter, 'exporter', issues),
        producer: party(raw.producer, 'producer', issues),
        consignee: party(raw.consignee, 'consignee', issues),
        countryOfOrigin: origin ?? undefined,
        transport: clean(raw.transport) ?? undefined,
        goods: raw.goods.map((g, i) =>
          prune({
            itemNo: integer(g.itemNo) ?? i + 1,
            description: clean(g.description) ?? '',
            hsCode: hsPrinted(g.hsCode),
            quantity: quantity(g.quantity, g.unit),
            grossWeight: weight(g.grossWeight) ?? undefined,
            marks: clean(g.marks) ?? undefined,
          }),
        ),
        invoiceRefs: refs(raw.invoiceRefs),
        placeOfIssue: clean(raw.placeOfIssue) ?? undefined,
        dateOfIssue: isoDate(raw.dateOfIssue) ?? undefined,
      }),
      issues,
    );
  });
}

function certifierRole(s: string | null | undefined): CusmaCertification['certifierRole'] {
  const t = clean(s)?.toUpperCase() ?? '';
  if (/IMPORT/.test(t)) return 'IMPORTER';
  if (/EXPORT/.test(t)) return 'EXPORTER';
  if (/PRODUC/.test(t)) return 'PRODUCER';
  return undefined;
}

function originCriterion(s: string | null | undefined): 'A' | 'B' | 'C' | 'D' | undefined {
  const m = clean(s)?.toUpperCase().match(/^(?:CRITERION\s*)?\(?([A-D])\)?$/);
  return m ? (m[1] as 'A' | 'B' | 'C' | 'D') : undefined;
}

/** Issuer conventions from the certifier's country (US dates are month first). */
export function normalizeCusmaCertification(raw: RawCusmaCertification): NormalizeResult<CusmaCertification> {
  return withLocale(localeFor(raw.certifier?.country ?? raw.exporter?.country), () => {
    const issues: string[] = [];
    const producerName = clean(raw.producer?.name)?.toUpperCase() ?? '';
    const producerStatement = /^VARIOUS$/.test(producerName) ? 'VARIOUS' : /AVAILABLE UPON REQUEST/.test(producerName) ? 'AVAILABLE_UPON_REQUEST' : undefined;
    const from = isoDate(raw.blanketFrom);
    const to = isoDate(raw.blanketTo);
    const signature = prune({ name: clean(raw.signatoryName) ?? undefined, title: clean(raw.signatoryTitle) ?? undefined, date: isoDate(raw.signatureDate) ?? undefined });
    return finish(
      CusmaCertification,
      prune({
        certifierRole: certifierRole(raw.certifierRole),
        certifier: party(raw.certifier, 'certifier', issues),
        exporter: party(raw.exporter, 'exporter', issues),
        producer: producerStatement ? undefined : party(raw.producer, 'producer', issues),
        producerStatement,
        importer: party(raw.importer, 'importer', issues),
        goods: raw.goods.map((g) =>
          prune({
            description: clean(g.description) ?? '',
            hsCode: hsPrinted(g.hsCode),
            originCriterion: originCriterion(g.originCriterion),
            countryOfOrigin: countryCode(g.countryOfOrigin) ?? undefined,
          }),
        ),
        blanketPeriod: from && to ? { from, to } : undefined,
        signature: Object.keys(signature).length ? signature : undefined,
        invoiceRefs: refs(raw.invoiceRefs),
      }),
      issues,
    );
  });
}

/** Issuer conventions from the port of loading's country. */
export function normalizeArrivalNotice(raw: RawArrivalNotice): NormalizeResult<ArrivalNotice> {
  return withLocale(localeFor(raw.portOfLoading?.country ?? raw.consignee?.country), () => {
    const issues: string[] = [];
    const charges = raw.charges
      .map((c, i) => {
        const amount = decimal(c.amount);
        const currency = currencyCode(c.currency);
        return amount && currency && clean(c.description) ? valid(Money, { amount, currency }, `charges[${i}]`, issues) && { description: clean(c.description)!, amount: { amount, currency } } : undefined;
      })
      .filter((c): c is NonNullable<typeof c> => !!c);
    const containers = raw.containers
      .map((c) => prune({ number: clean(c.number)?.toUpperCase().replace(/[\s-]/g, '') ?? undefined, seal: clean(c.seal) ?? undefined, type: clean(c.type) ?? undefined }))
      .filter((c) => !!c.number);
    const number = clean(raw.transportDocumentNumber);
    return finish(
      ArrivalNotice,
      prune({
        noticeNumber: clean(raw.noticeNumber) ?? undefined,
        carrier: clean(raw.carrierName) ? prune({ name: clean(raw.carrierName), scac: clean(raw.scac) ?? undefined }) : undefined,
        mode: transportMode(raw.mode) ?? (clean(raw.flight) ? 'AIR' : undefined),
        transportDocumentNumber: number ? (awbNumber(number) ?? number) : '',
        vessel: clean(raw.vessel) ?? undefined,
        voyage: clean(raw.voyage) ?? undefined,
        flight: clean(raw.flight) ?? undefined,
        portOfLoading: place(raw.portOfLoading, 'portOfLoading', issues),
        portOfDischarge: place(raw.portOfDischarge, 'portOfDischarge', issues),
        estimatedArrival: isoDate(raw.estimatedArrival) ?? undefined,
        consignee: party(raw.consignee, 'consignee', issues),
        notifyParty: party(raw.notifyParty, 'notifyParty', issues),
        containers: containers.length ? containers : undefined,
        packages: integer(raw.packages) ?? undefined,
        grossWeight: weight(raw.grossWeight) ?? undefined,
        cargoDescription: clean(raw.cargoDescription) ?? undefined,
        freightTerms: freightTerms(raw.freightTerms),
        lastFreeDay: isoDate(raw.lastFreeDay) ?? undefined,
        charges: charges.length ? charges : undefined,
      }),
      issues,
    );
  });
}

function woodKind(title: string, statement: string, treatment: string): WoodPackagingCertificate['kind'] | undefined {
  const t = `${title} ${statement}`.toUpperCase();
  if (/\bNO(N)?[- ]?WOOD|WOOD[- ]FREE|DOES NOT CONTAIN (ANY )?WOOD|NO WOOD(EN)? PACKING/.test(t)) return 'NO_WOOD_DECLARATION';
  if (/PHYTOSANITARY/.test(title.toUpperCase())) return 'PHYTOSANITARY';
  if (/FUMIGATION/.test(title.toUpperCase())) return 'FUMIGATION';
  if (/HEAT[- ]?TREATMENT/.test(title.toUpperCase())) return 'HEAT_TREATMENT';
  if (/ISPM|PACKING DECLARATION|PACKAGING DECLARATION|WOOD PACKAGING/.test(t)) return 'ISPM15_DECLARATION';
  if (/\bMB\b|METHYL BROMIDE|SULFURYL/.test(treatment.toUpperCase())) return 'FUMIGATION';
  if (/\bHT\b|HEAT/.test(treatment.toUpperCase())) return 'HEAT_TREATMENT';
  return undefined;
}

function treatmentCode(s: string): WoodPackagingCertificate['treatment'] {
  const t = s.toUpperCase();
  if (/\bMB\b|METHYL BROMIDE/.test(t)) return 'MB';
  if (/\bSF\b|SULFURYL/.test(t)) return 'SF';
  if (/\bDH\b|DIELECTRIC/.test(t)) return 'DH';
  if (/\bHT\b|HEAT/.test(t)) return 'HT';
  return undefined;
}

/** "CN-3301 HT" | "CN 3301 HT" | "IPPC CN-3301-HT" -> { country: CN, registration: 3301, treatment: HT }. */
export function ispmMark(s: string | null | undefined): WoodPackagingCertificate['ispmMark'] {
  const m = clean(s)?.toUpperCase().replace(/^IPPC\s*/, '').match(/^([A-Z]{2})[\s-]+([A-Z0-9]+(?:-[A-Z0-9]+)*?)(?:[\s-]+(HT|MB|DH|SF|KD))?$/);
  if (!m || !countryCode(m[1])) return undefined;
  return prune({ country: m[1], registration: m[2], treatment: m[3] });
}

export function normalizeWoodPackaging(raw: RawWoodPackagingCertificate): NormalizeResult<WoodPackagingCertificate> {
  return withLocale(localeFor(raw.exporter?.country), () => {
    const issues: string[] = [];
    const title = clean(raw.documentTitle) ?? '';
    const treatment = clean(raw.treatment) ?? '';
    const kind = woodKind(title, clean(raw.statement) ?? '', treatment);
    if (!kind) issues.push(`kind: could not tell the certificate kind from ${JSON.stringify(title)}`);
    const mark = ispmMark(raw.ispmMark);
    if (clean(raw.ispmMark) && !mark) issues.push(`ispmMark: could not normalize ${JSON.stringify(raw.ispmMark)}`);
    const containers = raw.containers.map((c) => clean(c)?.toUpperCase().replace(/[\s-]/g, '')).filter((c): c is string => !!c);
    return finish(
      WoodPackagingCertificate,
      prune({
        certificateNumber: clean(raw.certificateNumber) ?? undefined,
        kind,
        treatment: kind === 'NO_WOOD_DECLARATION' ? undefined : (treatmentCode(treatment) ?? treatmentCode(mark?.treatment ?? '')),
        ispmMark: mark,
        treatmentDate: isoDate(raw.treatmentDate) ?? undefined,
        issuer: clean(raw.issuer) ?? undefined,
        exporter: party(raw.exporter, 'exporter', issues),
        consignee: party(raw.consignee, 'consignee', issues),
        packagingDescription: clean(raw.packagingDescription) ?? undefined,
        containers: containers.length ? containers : undefined,
        transportDocumentNumber: clean(raw.transportDocumentNumber) ?? undefined,
        invoiceRef: clean(raw.invoiceRef) ?? undefined,
        dateOfIssue: isoDate(raw.dateOfIssue) ?? undefined,
      }),
      issues,
    );
  });
}

function regulation(s: string | null | undefined): DangerousGoodsDeclaration['regulation'] {
  const t = clean(s)?.toUpperCase() ?? '';
  if (/IMDG|IMO/.test(t)) return 'IMDG';
  if (/IATA|ICAO/.test(t)) return 'IATA';
  if (/\bTDG\b|TRANSPORTATION OF DANGEROUS GOODS/.test(t)) return 'TDG';
  if (/49\s*CFR/.test(t)) return '49CFR';
  return undefined;
}

export function normalizeDangerousGoods(raw: RawDangerousGoods): NormalizeResult<DangerousGoodsDeclaration> {
  return withLocale(localeFor(raw.shipper?.country), () => {
    const issues: string[] = [];
    const items = raw.items.map((it, i) => {
      const un = unNumber(it.unNumber);
      if (clean(it.unNumber) && !un) issues.push(`items[${i}].unNumber: could not normalize ${JSON.stringify(it.unNumber)}`);
      const pg = packingGroup(it.packingGroup);
      if (clean(it.packingGroup) && !pg) issues.push(`items[${i}].packingGroup: could not normalize ${JSON.stringify(it.packingGroup)}`);
      const risks = (clean(it.subsidiaryRisk) ?? '').split(/[,;/ ]+/).map(hazardClass).filter((r): r is string => !!r);
      return prune({
        unNumber: un ?? undefined,
        properShippingName: clean(it.properShippingName)?.toUpperCase() ?? undefined,
        hazardClass: hazardClass(it.hazardClass) ?? undefined,
        subsidiaryRisk: risks.length ? risks : undefined,
        packingGroup: pg ?? undefined,
        quantity: quantity(it.quantity, it.unit),
        packages: clean(it.packages) ?? undefined,
      });
    });
    const signatory = prune({ name: clean(raw.signatoryName) ?? undefined, place: clean(raw.signatoryPlace) ?? undefined, date: isoDate(raw.signatureDate) ?? undefined });
    return finish(
      DangerousGoodsDeclaration,
      prune({
        shipper: party(raw.shipper, 'shipper', issues),
        consignee: party(raw.consignee, 'consignee', issues),
        transportDocumentNumber: clean(raw.transportDocumentNumber) ?? undefined,
        mode: transportMode(raw.mode) ?? undefined,
        regulation: regulation(raw.regulation),
        items,
        emergencyContact: clean(raw.emergencyContact) ?? undefined,
        signatory: Object.keys(signatory).length ? signatory : undefined,
      }),
      issues,
    );
  });
}
