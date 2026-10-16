import type { Attestation, Party } from '@doccheck/schemas';
import type { DocsDocumentKey, DocsShipment } from './documents';
import { date, esc, page, party } from './render';

/**
 * HTML for the other documents of set v1-docs, one layout each (the classic style of render.ts).
 * Certificates are signed with a drawn signature (an SVG path, not text) and stamped with a coloured
 * seal, unless the shipment's attestations say otherwise, so the signature check reads real ink.
 */

const style = 'classic' as const;
const cell = (label: string, value: string) => `<td><span class="label">${esc(label)}</span>${value}</td>`;

/** A handwritten-looking signature in dark blue ink. */
const SIGNATURE = `<svg width="190" height="48" viewBox="0 0 190 48" aria-hidden="true"><path d="M6 36 C 20 4, 30 44, 46 22 S 70 6, 82 30 S 108 40, 118 16 S 146 8, 152 30 S 176 34, 186 18" fill="none" stroke="#1b2a6b" stroke-width="2.4" stroke-linecap="round"/></svg>`;
/** A round stamp in red-violet ink, with the issuer's name around it. */
const stamp = (text: string) =>
  `<svg width="104" height="104" viewBox="0 0 104 104" aria-hidden="true" style="opacity:.85"><circle cx="52" cy="52" r="48" fill="none" stroke="#a3183d" stroke-width="3"/><circle cx="52" cy="52" r="36" fill="none" stroke="#a3183d" stroke-width="1.5"/><path d="M30 60 L74 44" stroke="#a3183d" stroke-width="2.5"/><text x="52" y="56" font-size="9" text-anchor="middle" fill="#a3183d">${esc(text.slice(0, 18).toUpperCase())}</text></svg>`;

function signatureBlock(label: string, signer: string, at: Attestation | undefined, stampText?: string): string {
  const signed = at?.signature ?? true;
  const stamped = stampText && (at?.stamp ?? true);
  return `<table style="margin-top:28px"><tr><td style="width:55%;border:none"></td><td style="border:none">
    <div style="height:56px;position:relative">${signed ? SIGNATURE : ''}${stamped ? `<span style="position:absolute;left:150px;top:-30px">${stamp(stampText!)}</span>` : ''}</div>
    <div style="border-top:1px solid #333;padding-top:3px">${esc(label)}</div><div>${esc(signer)}</div></td></tr></table>`;
}

const parties = (cells: [string, Party | undefined][]) =>
  `<table class="grid">${cells
    .reduce<[string, Party | undefined][][]>((rows, c, i) => (i % 2 ? rows[rows.length - 1].push(c) : rows.push([c]), rows), [])
    .map((row) => `<tr>${row.map(([l, p]) => cell(l, p ? party(p, style) : '')).join('')}</tr>`)
    .join('')}</table>`;

export function renderAirWaybill(s: DocsShipment): string {
  const a = s.documents.airWaybill!;
  const title = a.issuer === 'HAWB' ? 'HOUSE AIR WAYBILL' : 'AIR WAYBILL';
  const f = a.flights?.[0];
  const body = `<h1>${title}</h1><p style="text-align:center;margin:-6px 0 10px">Not negotiable · ${esc(a.awbNumber)}${a.masterAwbNumber ? ` · MAWB ${esc(a.masterAwbNumber)}` : ''}</p>
    ${parties([["Shipper's name and address", a.shipper], ["Consignee's name and address", a.consignee], ['Notify', a.notifyParty], ['Issuing carrier', undefined]])}
    <table class="grid">
      <tr>${cell('Issuing carrier', esc(a.carrier?.name))}${cell('Air waybill no.', esc(a.awbNumber))}</tr>
      <tr>${cell('Airport of departure', `${esc(a.airportOfDeparture.name)} (${esc(a.airportOfDeparture.iata)})`)}${cell('Airport of destination', `${esc(a.airportOfDestination.name)} (${esc(a.airportOfDestination.iata)})`)}</tr>
      <tr>${cell('Requested flight / date', `${esc(f?.flight)} / ${date(f?.date, 'legacy')}`)}${cell('Charges code', a.freightTerms === 'PREPAID' ? 'PP' : 'CC')}</tr>
    </table><br>
    <table><thead><tr><th>No. of pieces</th><th>Gross weight</th><th>kg / lb</th><th>Rate class</th><th>Chargeable weight</th><th>Nature and quantity of goods</th></tr></thead>
    <tbody><tr><td class="num">${a.pieces}</td><td class="num">${esc(a.grossWeight.raw.value)}</td><td>${a.grossWeight.raw.unit === 'KG' ? 'K' : 'L'}</td><td>Q</td><td class="num">${esc(a.chargeableWeight?.raw.value)}</td><td>${esc(a.natureOfGoods)}<br>VOL ${esc(a.volumeM3)} M3</td></tr></tbody></table>
    <p>Handling information: invoice ${esc(a.references?.join(', '))}</p>
    <table class="grid"><tr>${cell('Executed on (date)', date(a.executedOn, 'legacy'))}${cell('At (place)', esc(a.placeOfExecution))}</tr></table>
    ${signatureBlock('Signature of issuing carrier or its agent', a.carrier?.name ?? '', undefined)}`;
  return page(`${title} ${a.awbNumber}`, style, body);
}

export function renderCertificateOfOrigin(s: DocsShipment): string {
  const c = s.documents.certificateOfOrigin!;
  const body = `<h1>CERTIFICATE OF ORIGIN</h1><p style="text-align:center;margin:-6px 0 10px">No. ${esc(c.certificateNumber)} · issued by ${esc(c.issuer)}</p>
    ${parties([['1. Exporter', c.exporter], ['2. Consignee', c.consignee]])}
    <table class="grid"><tr>${cell('3. Means of transport and route', esc(c.transport))}${cell('4. Country of origin', esc(c.countryOfOrigin))}</tr></table><br>
    <table><thead><tr><th>Item</th><th>Description of goods</th><th>HS code</th><th>Quantity</th></tr></thead><tbody>
    ${c.goods.map((g) => `<tr><td>${g.itemNo}</td><td>${esc(g.description)}</td><td>${esc(g.hsCode)}</td><td class="num">${esc(g.quantity?.value)} ${esc(g.quantity?.unit)}</td></tr>`).join('')}
    </tbody></table>
    <p>Invoice no. ${esc(c.invoiceRefs?.join(', '))}</p>
    <p>The undersigned authority hereby certifies that the goods described above originate in the country shown in box 4.</p>
    <p>Place and date of issue: ${esc(c.placeOfIssue)}, ${date(c.dateOfIssue, style)}</p>
    ${signatureBlock('Signature and stamp of the certifying authority', c.issuer ?? '', s.attestations.certificateOfOrigin, c.issuer)}`;
  return page(`Certificate of origin ${c.certificateNumber}`, style, body);
}

export function renderCusmaCertification(s: DocsShipment): string {
  const c = s.documents.cusmaCertification!;
  const box = (role: string) => `${c.certifierRole === role ? '[X]' : '[ ]'} ${role.charAt(0)}${role.slice(1).toLowerCase()}`;
  const body = `<h1>CUSMA / USMCA CERTIFICATION OF ORIGIN</h1>
    <p>1. Certifier: ${box('IMPORTER')} &nbsp; ${box('EXPORTER')} &nbsp; ${box('PRODUCER')}</p>
    ${parties([['2. Certifier', c.certifier], ['3. Exporter', c.exporter], ['4. Producer', c.producer], ['5. Importer', c.importer]])}<br>
    <table><thead><tr><th>6. Description of good</th><th>HS tariff classification</th><th>7. Origin criterion</th><th>Country of origin</th></tr></thead><tbody>
    ${c.goods.map((g) => `<tr><td>${esc(g.description)}</td><td>${esc(g.hsCode)}</td><td>${esc(g.originCriterion ?? '')}</td><td>${esc(g.countryOfOrigin)}</td></tr>`).join('')}
    </tbody></table>
    <p>8. Blanket period: ${c.blanketPeriod ? `from ${date(c.blanketPeriod.from, style)} to ${date(c.blanketPeriod.to, style)}` : 'N/A'}</p>
    <p>Invoice no. ${esc(c.invoiceRefs?.join(', '))}</p>
    <p>I certify that the goods described in this document qualify as originating and the information contained in this document is true and accurate.</p>
    <p>9. Authorized signature · Name: ${esc(c.signature?.name)} · Title: ${esc(c.signature?.title)} · Date: ${date(c.signature?.date, style)}</p>
    ${signatureBlock('Authorized signature', c.signature?.name ?? '', s.attestations.cusmaCertification)}`;
  return page('CUSMA certification of origin', style, body);
}

export function renderArrivalNotice(s: DocsShipment): string {
  const n = s.documents.arrivalNotice!;
  const air = n.mode === 'AIR';
  const body = `<h1>ARRIVAL NOTICE</h1><p style="text-align:center;margin:-6px 0 10px">Notice ${esc(n.noticeNumber)} · ${esc(n.carrier?.name)}</p>
    ${parties([['Consignee', n.consignee], ['Notify party', n.notifyParty]])}
    <table class="grid">
      <tr>${cell(air ? 'Air waybill no.' : 'B/L no.', esc(n.transportDocumentNumber))}${cell(air ? 'Flight' : 'Vessel / voyage', air ? esc(n.flight) : `${esc(n.vessel)} / ${esc(n.voyage)}`)}</tr>
      <tr>${cell('ETA', date(n.estimatedArrival, style))}${cell('Last free day', date(n.lastFreeDay, style))}</tr>
      ${air ? '' : `<tr>${cell('Port of loading', esc(n.portOfLoading?.name))}${cell('Port of discharge', esc(n.portOfDischarge?.name))}</tr>`}
    </table><br>
    ${n.containers?.length ? `<table><thead><tr><th>Container No</th><th>Seal No</th><th>Type</th></tr></thead><tbody>${n.containers.map((c) => `<tr><td>${esc(c.number)}</td><td>${esc(c.seal)}</td><td>${esc(c.type)}</td></tr>`).join('')}</tbody></table><br>` : ''}
    <table class="grid"><tr>${cell('Packages', String(n.packages ?? ''))}${cell('Gross weight', `${esc(n.grossWeight?.raw.value)} ${esc(n.grossWeight?.raw.unit)}`)}</tr>
    <tr>${cell('Description', esc(n.cargoDescription))}${cell('Freight', esc(n.freightTerms))}</tr></table>
    <p>Cargo available for pick up after customs release. Demurrage applies after the last free day. Amount due on release: see invoice.</p>`;
  return page(`Arrival notice ${n.noticeNumber}`, style, body);
}

export function renderWoodPackaging(s: DocsShipment): string {
  const w = s.documents.woodPackaging!;
  const body = `<h1>HEAT TREATMENT CERTIFICATE</h1><p style="text-align:center;margin:-6px 0 10px">ISPM 15 · Certificate No. ${esc(w.certificateNumber)}</p>
    ${parties([['Exporter', w.exporter]])}
    <table class="grid"><tr>${cell('Packaging', esc(w.packagingDescription))}${cell('Treatment', 'HT (heat treatment)')}</tr>
    <tr>${cell('IPPC mark', `${esc(w.ispmMark?.country)}-${esc(w.ispmMark?.registration)} ${esc(w.ispmMark?.treatment)}`)}${cell('Date of treatment', date(w.treatmentDate, style))}</tr>
    <tr>${cell('Invoice no.', esc(w.invoiceRef))}${cell('Issued by', esc(w.issuer))}</tr></table>
    <p>This is to certify that the wood packaging material described above was heat treated to a minimum core temperature of 56 °C for 30 minutes and marked in accordance with ISPM 15.</p>
    ${signatureBlock('Signature of the treatment provider', w.issuer ?? '', undefined)}`;
  return page(`Heat treatment certificate ${w.certificateNumber}`, style, body);
}

export function renderDangerousGoods(s: DocsShipment): string {
  const d = s.documents.dangerousGoods!;
  const title = d.regulation === 'IATA' ? "SHIPPER'S DECLARATION FOR DANGEROUS GOODS" : 'DANGEROUS GOODS DECLARATION';
  const body = `<h1>${title}</h1><p style="text-align:center;margin:-6px 0 10px">${esc(d.regulation)} · ${d.mode === 'AIR' ? 'Air waybill' : 'B/L'} No. ${esc(d.transportDocumentNumber)}</p>
    ${parties([['Shipper', d.shipper], ['Consignee', d.consignee]])}<br>
    <table><thead><tr><th>UN No.</th><th>Proper shipping name</th><th>Class or division</th><th>Packing group</th><th>Quantity</th></tr></thead><tbody>
    ${d.items.map((i) => `<tr><td>${esc(i.unNumber.replace('UN', 'UN '))}</td><td>${esc(i.properShippingName)}</td><td>${esc(i.hazardClass)}</td><td>${esc(i.packingGroup)}</td><td>${esc(i.quantity?.value)} ${esc(i.quantity?.unit)}</td></tr>`).join('')}
    </tbody></table>
    <p>Emergency contact: ${esc(d.emergencyContact)}</p>
    <p>I hereby declare that the contents of this consignment are fully and accurately described above by the proper shipping name, and are classified, packaged, marked and labelled in accordance with the applicable regulations.</p>
    <p>Name: ${esc(d.signatory?.name)} · Place: ${esc(d.signatory?.place)} · Date: ${date(d.signatory?.date, style)}</p>
    ${signatureBlock('Signature of the shipper', d.signatory?.name ?? '', undefined)}`;
  return page(title, style, body);
}

/** File name -> HTML of every other document the shipment has. */
export function renderDocsHtml(s: DocsShipment): Partial<Record<string, string>> {
  const out: Partial<Record<string, string>> = {};
  const d = s.documents;
  if (d.airWaybill) out['air-waybill'] = renderAirWaybill(s);
  if (d.certificateOfOrigin) out['certificate-of-origin'] = renderCertificateOfOrigin(s);
  if (d.cusmaCertification) out['cusma-certification'] = renderCusmaCertification(s);
  if (d.arrivalNotice) out['arrival-notice'] = renderArrivalNotice(s);
  if (d.woodPackaging) out['wood-packaging'] = renderWoodPackaging(s);
  if (d.dangerousGoods) out['dangerous-goods'] = renderDangerousGoods(s);
  return out;
}

/** Which document each file of renderDocsHtml holds. */
export const DOCS_FILES: Record<string, DocsDocumentKey> = {
  'air-waybill': 'airWaybill',
  'certificate-of-origin': 'certificateOfOrigin',
  'cusma-certification': 'cusmaCertification',
  'arrival-notice': 'arrivalNotice',
  'wood-packaging': 'woodPackaging',
  'dangerous-goods': 'dangerousGoods',
};
