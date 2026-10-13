import { useEffect, useState } from 'react';
import { api, type ShipmentDocument } from './api';

type Data = Record<string, unknown>;

/** Key fields per document type, as label + path into the normalized document. */
const FIELDS: Record<string, [string, string][]> = {
  COMMERCIAL_INVOICE: [
    ['Invoice no.', 'invoiceNumber'], ['Invoice date', 'invoiceDate'], ['PO', 'poNumber'], ['Seller', 'seller.name'], ['Buyer', 'buyer.name'],
    ['Consignee', 'consignee.name'], ['Shipment date', 'shipmentDate'], ['Terms of sale', 'incoterm.code'], ['Currency', 'currency'],
    ['Packages', 'packageCount'], ['Net weight (kg)', 'netWeight.kg'], ['Gross weight (kg)', 'grossWeight.kg'], ['Invoice total', 'invoiceTotal.amount'],
    ['Port of entry', 'portOfEntry.name'],
  ],
  PACKING_LIST: [
    ['Packing list no.', 'packingListNumber'], ['Invoice ref.', 'invoiceRef'], ['Consignee', 'consignee.name'], ['Packages', 'totals.packageCount'],
    ['Net weight (kg)', 'totals.netWeight.kg'], ['Gross weight (kg)', 'totals.grossWeight.kg'], ['Volume (m³)', 'totals.volumeM3'],
  ],
  BILL_OF_LADING: [
    ['B/L no.', 'blNumber'], ['Carrier', 'carrier.name'], ['Shipper', 'shipper.name'], ['Consignee', 'consignee.name'], ['Vessel / voyage', 'vessel'],
    ['Port of loading', 'portOfLoading.name'], ['Port of discharge', 'portOfDischarge.name'], ['On board', 'shippedOnBoardDate'],
    ['Packages', 'totalPackages'], ['Gross weight (kg)', 'totalGrossWeight.kg'], ['Freight', 'freightTerms'],
  ],
  ISF: [
    ['Importer of record no.', 'importerOfRecordNumber'], ['Consignee no.', 'consigneeNumber'], ['Seller', 'seller.name'], ['Buyer', 'buyer.name'],
    ['Manufacturer', 'manufacturer.name'], ['Ship-to party', 'shipToParty.name'], ['Country of origin', 'countryOfOrigin'], ['HTS', 'htsCode'],
    ['Stuffing location', 'containerStuffingLocation.city'], ['Consolidator', 'consolidator.name'],
  ],
};

const get = (o: unknown, path: string): unknown => path.split('.').reduce<unknown>((c, k) => (c == null ? undefined : (c as Data)[k]), o);
const show = (v: unknown) => (v === undefined || v === null || v === '' ? '—' : String(v));

/** What the extraction read from one document: issues first, then the key fields and the rows. */
const TYPES: [string, string][] = [
  ['COMMERCIAL_INVOICE', 'Commercial invoice'],
  ['PACKING_LIST', 'Packing list'],
  ['BILL_OF_LADING', 'Bill of lading'],
  ['ISF', 'ISF (10+2)'],
];

export function DocumentData({ shipmentId, doc, onClose, onReextract }: { shipmentId: string; doc: ShipmentDocument; onClose: () => void; onReextract: () => void }) {
  const [retype, setRetype] = useState(doc.detectedType);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ data: Data | null; issues: string[]; model?: string; promptVersion?: string }>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    fetch(`/shipments/${shipmentId}/documents/${doc.id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
      .then(setResult, (e: Error) => setError(e.message));
  }, [shipmentId, doc.id]);

  const data = result?.data;
  const rows: { label: string; cells: string[] }[] = [];
  if (data && doc.detectedType === 'COMMERCIAL_INVOICE') {
    for (const l of (data.lines as Data[]) ?? []) rows.push({ label: `Line ${l.lineNo}`, cells: [show(l.description), `${show(get(l, 'quantity.value'))} ${show(get(l, 'quantity.unit'))}`, show(get(l, 'unitPrice.amount')), show(get(l, 'lineTotal.amount')), show(l.countryOfOrigin)] });
  } else if (data && doc.detectedType === 'PACKING_LIST') {
    for (const p of (data.packages as Data[]) ?? []) rows.push({ label: show(p.range), cells: [`${show(p.count)} ${show(p.type)}`, show(get(p, 'contents.0.description')), show(get(p, 'contents.0.quantity.value')), show(get(p, 'grossWeight.kg'))] });
  } else if (data && doc.detectedType === 'BILL_OF_LADING') {
    for (const c of (data.containers as Data[]) ?? []) rows.push({ label: show(c.number), cells: [show(c.seal), show(c.type), show(c.packages), show(get(c, 'grossWeight.kg'))] });
  }
  const heads: Record<string, string[]> = {
    COMMERCIAL_INVOICE: ['Description', 'Quantity', 'Unit price', 'Total', 'Origin'],
    PACKING_LIST: ['Packages', 'Description', 'Quantity', 'Gross kg'],
    BILL_OF_LADING: ['Seal', 'Type', 'Packages', 'Gross kg'],
  };

  return (
    <div className="viewer" role="dialog" aria-label={`Extracted data · ${doc.fileName}`}>
      <header>
        <strong>Extracted data · {doc.fileName}</strong>
        <button className="close" onClick={onClose} aria-label="Close">×</button>
      </header>
      <div className="data-panel">
        {error && <p className="error">Could not load the extraction ({error}).</p>}
        {!result && !error && <p className="muted">Loading…</p>}
        {result && (
          <>
            {result.issues.length > 0 && (
              <ul className="issues">
                {result.issues.map((i, k) => (
                  <li key={k}>{i}</li>
                ))}
              </ul>
            )}
            {!data ? (
              <p className="muted">The document could not be normalized; see the issues above.</p>
            ) : (
              <>
                <dl className="fields">
                  {(FIELDS[doc.detectedType] ?? []).map(([label, path]) => (
                    <div key={path}>
                      <dt>{label}</dt>
                      <dd>{show(get(data, path))}</dd>
                    </div>
                  ))}
                </dl>
                {rows.length > 0 && (
                  <table className="list compact">
                    <thead>
                      <tr>
                        <th />
                        {(heads[doc.detectedType] ?? []).map((h) => (
                          <th key={h}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={i}>
                          <td className="muted">{r.label}</td>
                          {r.cells.map((c, j) => (
                            <td key={j}>{c}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </>
            )}
            <div className="retype">
              <span className="small muted">Wrong document type?</span>
              <select value={retype} onChange={(e) => setRetype(e.target.value as ShipmentDocument['detectedType'])}>
                {TYPES.map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
              <button
                disabled={busy || retype === doc.detectedType}
                onClick={async () => {
                  setBusy(true);
                  const r = await fetch(`/shipments/${shipmentId}/documents/${doc.id}/reextract`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: retype }) });
                  setBusy(false);
                  if (r.ok) onReextract();
                  else setError(`Re-extraction refused (${r.status})`);
                }}
              >
                Re-extract
              </button>
            </div>
            <p className="muted small">
              {result.model} · prompt {result.promptVersion}. Values were normalized from what is printed (dates to ISO, weights to kg); check them against the PDF.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
