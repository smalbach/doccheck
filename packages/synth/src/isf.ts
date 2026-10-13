import type { BillOfLading, Isf } from '@doccheck/schemas';
import { SELLERS } from './catalog';
import type { DatasetEntry } from './dataset';
import type { ErrorLabel } from './errors';
import type { SyntheticShipment } from './generate';
import { address, date, esc, page, party } from './render';
import { Rng } from './rng';

/**
 * ISF filing confirmation as printed by a customs broker after the 10+2 is accepted, and the
 * data/eval/v1-isf set built from the v1 US shipments. Nothing here feeds buildDataset(): v1 and
 * its PDFs stay exactly as they are.
 */

export type IsfErrorKind = 'isf_origin_mismatch' | 'isf_hts_mismatch' | 'isf_seller_mismatch';
export type IsfLabel = Omit<ErrorLabel, 'kind'> & { kind: IsfErrorKind };

export interface IsfEntry {
  shipment: SyntheticShipment & { documents: { isf: Isf } };
  /** v1 labels of the shipment followed by the ISF error, if one was injected. */
  labels: (ErrorLabel | IsfLabel)[];
}

const ISF_TEMPLATE = 'confirmation';

/** "848180" -> "8481.80"; longer HTS numbers keep their extra digits ("8481.80.1020"). */
const htsPrinted = (h: string) => (h.length > 6 ? `${h.slice(0, 4)}.${h.slice(4, 6)}.${h.slice(6)}` : `${h.slice(0, 4)}.${h.slice(4)}`);

/** ISO date minus `days`. */
function minusDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export function renderIsf(isf: Isf, bl: BillOfLading, seed: number): string {
  const style = 'classic';
  const filed = bl.shippedOnBoardDate ? minusDays(bl.shippedOnBoardDate, 3) : undefined;
  const txn = `ISF-${String(seed % 1_000_000_000).padStart(9, '0')}`;
  const row = (n: number, label: string, value: string) => `<tr><td style="width:6%">${n}</td><td style="width:30%"><strong>${esc(label)}</strong></td><td>${value}</td></tr>`;
  const body = `<h1>ISF FILING CONFIRMATION</h1>
    <p style="text-align:center;margin:-6px 0 12px">Importer Security Filing (10+2) · 19 CFR Part 149 · Status: ACCEPTED</p>
    <table class="grid">
      <tr><td><span class="label">ISF Transaction No.</span>${esc(txn)}</td><td><span class="label">Filed</span>${date(filed, style)}</td></tr>
      <tr><td><span class="label">Importer of Record No.</span>${esc(isf.importerOfRecordNumber)}</td><td><span class="label">Consignee No.</span>${esc(isf.consigneeNumber)}</td></tr>
      <tr><td><span class="label">Bill No.</span>${esc(bl.blNumber)}</td><td><span class="label">Carrier SCAC</span>${esc(bl.carrier?.scac)}</td></tr>
    </table><br>
    <table><thead><tr><th>#</th><th>Data element</th><th>Value</th></tr></thead><tbody>
      ${row(1, 'Manufacturer (or supplier)', party(isf.manufacturer, style))}
      ${row(2, 'Seller', party(isf.seller, style))}
      ${row(3, 'Buyer', party(isf.buyer, style))}
      ${row(4, 'Ship-to party', party(isf.shipToParty, style))}
      ${row(5, 'Container stuffing location', address(isf.containerStuffingLocation, style))}
      ${row(6, 'Consolidator (stuffer)', party(isf.consolidator, style))}
      ${row(7, 'Importer of record number', esc(isf.importerOfRecordNumber))}
      ${row(8, 'Consignee number', esc(isf.consigneeNumber))}
      ${row(9, 'Country of origin', esc(isf.countryOfOrigin))}
      ${row(10, 'Commodity HTSUS number (6-digit)', esc(htsPrinted(isf.htsCode)))}
    </tbody></table>
    <div class="sign">Filed electronically through ABI. Amend this filing if any element changes before the goods arrive in the United States.</div>`;
  return page(`ISF filing confirmation ${txn}`, style, body);
}

const ORIGINS = ['CN', 'VN', 'IN', 'MX', 'TH'];
const HEADINGS = ['940360', '392690', '851660', '420292'];

/**
 * Builds the v1-isf set: every v1 US shipment with its ISF, about one in four with the ISF
 * disagreeing with the invoice on one X11 element. Labels say whether X11 can see it (an origin
 * or HTS mismatch is invisible when the invoice does not print origins or HS codes).
 */
export function buildIsfDataset(entries: DatasetEntry[]): IsfEntry[] {
  return entries
    .filter((e) => e.shipment.destination === 'US' && e.shipment.documents.isf)
    .map((e) => {
      const shipment = structuredClone(e.shipment) as IsfEntry['shipment'];
      shipment.render = { ...shipment.render, isfTemplate: ISF_TEMPLATE };
      const labels: IsfEntry['labels'] = [...e.labels];
      const rng = new Rng(shipment.seed ^ 0x15f10002);
      if (!rng.chance(0.25)) return { shipment, labels };

      const isf = shipment.documents.isf;
      const inv = shipment.documents.invoice;
      const kind = rng.pick(['isf_origin_mismatch', 'isf_hts_mismatch', 'isf_seller_mismatch'] as const);
      if (kind === 'isf_origin_mismatch') {
        const origins = inv.lines.map((l) => l.countryOfOrigin).filter(Boolean);
        const after = rng.pick(ORIGINS.filter((c) => c !== isf.countryOfOrigin && !origins.includes(c)));
        labels.push({ kind, document: 'isf', field: 'countryOfOrigin', before: isf.countryOfOrigin, after, expectedRuleIds: origins.length ? ['X11'] : [], description: `ISF country of origin ${after} instead of ${isf.countryOfOrigin}` });
        isf.countryOfOrigin = after;
      } else if (kind === 'isf_hts_mismatch') {
        const headings = inv.lines.map((l) => l.hsCode?.replace(/\D/g, '').slice(0, 6)).filter(Boolean);
        const after = rng.pick(HEADINGS.filter((h) => !headings.includes(h)));
        labels.push({ kind, document: 'isf', field: 'htsCode', before: isf.htsCode, after, expectedRuleIds: headings.length ? ['X11'] : [], description: `ISF HTS ${after} instead of ${isf.htsCode}` });
        isf.htsCode = after;
      } else {
        const after = rng.pick(SELLERS.filter((s) => s.party.name !== isf.seller.name)).party.name;
        labels.push({ kind, document: 'isf', field: 'seller.name', before: isf.seller.name, after, expectedRuleIds: ['X11'], description: `ISF seller "${after}" instead of "${isf.seller.name}"` });
        isf.seller = { ...isf.seller, name: after };
      }
      return { shipment, labels };
    });
}
