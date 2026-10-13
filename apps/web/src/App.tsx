import { useCallback, useEffect, useState } from 'react';
import { api, type Sample, type ShipmentSummary } from './api';
import { ShipmentPage } from './ShipmentPage';

/** Hash routes: "#/" home, "#/s/<id>" a shipment. No router dependency needed for two screens. */
function useRoute() {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const on = () => setHash(window.location.hash);
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const m = hash.match(/^#\/s\/([0-9a-f-]{36})/i);
  return m ? { name: 'shipment' as const, id: m[1] } : { name: 'home' as const };
}

export const go = (path: string) => {
  window.location.hash = path;
};

export function App() {
  const route = useRoute();
  return (
    <>
      <header className="top">
        <a href="#/" className="brand">
          <span className="logo" aria-hidden>✓</span> DocCheck
        </a>
        <span className="tagline">Freight documents checked before they reach CBSA or CBP</span>
      </header>
      <main>{route.name === 'shipment' ? <ShipmentPage id={route.id} /> : <Home />}</main>
      <footer className="foot">Portfolio project. Not customs advice; nothing is filed with CBSA or CBP. Models run locally.</footer>
    </>
  );
}

const ERROR_LABELS: Record<string, string> = {
  package_count_mismatch: 'Package count',
  gross_weight_mismatch: 'Gross weight',
  net_exceeds_gross: 'Net > gross',
  line_quantity_changed: 'Quantity',
  line_total_typo: 'Line total',
  second_currency: 'Currency',
  container_check_digit: 'Container no.',
  consignee_address_mismatch: 'Consignee address',
  packing_list_quantity_mismatch: 'Packing list qty',
  missing_required_field: 'Missing field',
};

function Home() {
  const [shipments, setShipments] = useState<ShipmentSummary[]>([]);
  const [samples, setSamples] = useState<Sample[]>([]);
  const [destination, setDestination] = useState<'CA' | 'US'>('CA');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [filter, setFilter] = useState<'all' | 'CA' | 'US' | 'clean'>('all');

  const load = useCallback(() => {
    api.shipments().then(setShipments, (e: Error) => setError(e.message));
    api.samples().then(setSamples, () => setSamples([]));
  }, []);
  useEffect(load, [load]);

  const create = async () => {
    setBusy('create');
    try {
      const s = await api.create({ destination, reference: reference.trim() || undefined });
      go(`/s/${s.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(undefined);
    }
  };

  const loadSample = async (id: string) => {
    setBusy(id);
    try {
      const s = await api.loadSample(id);
      go(`/s/${s.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(undefined);
    }
  };

  const shown = samples.filter((s) => (filter === 'all' ? true : filter === 'clean' ? s.errors.length === 0 : s.destination === filter)).slice(0, 24);

  return (
    <div className="home">
      {error && <p className="error banner">{error}</p>}
      <section className="card">
        <h2>New shipment</h2>
        <p className="muted">Create a shipment, upload its commercial invoice, packing list and bill of lading as PDFs, then validate.</p>
        <div className="row">
          <label>
            Destination
            <select value={destination} onChange={(e) => setDestination(e.target.value as 'CA' | 'US')}>
              <option value="CA">Canada (CBSA)</option>
              <option value="US">United States (CBP)</option>
            </select>
          </label>
          <label className="grow">
            Reference
            <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. PO-4411 / booking" />
          </label>
          <button className="primary" onClick={create} disabled={!!busy}>
            {busy === 'create' ? 'Creating…' : 'Create'}
          </button>
        </div>
      </section>

      {samples.length > 0 && (
        <section className="card">
          <div className="section-head">
            <h2>Try a sample</h2>
            <div className="chips">
              {(['all', 'CA', 'US', 'clean'] as const).map((f) => (
                <button key={f} className={filter === f ? 'chip on' : 'chip'} onClick={() => setFilter(f)}>
                  {f === 'all' ? 'All' : f === 'clean' ? 'No errors' : f}
                </button>
              ))}
            </div>
          </div>
          <p className="muted">Synthetic shipments with known, injected errors. Loading one uploads its three PDFs and extracts them with the local model (about 30 s per document).</p>
          <div className="samples">
            {shown.map((s) => (
              <button key={s.id} className="sample" onClick={() => loadSample(s.id)} disabled={!!busy}>
                <span className="sample-id">
                  {s.id} <span className={`dest ${s.destination}`}>{s.destination}</span>
                </span>
                <span className="sample-errors">
                  {s.errors.length === 0 ? <span className="tag ok">no errors</span> : s.errors.map((e, i) => <span key={i} className="tag" title={e.description}>{ERROR_LABELS[e.kind] ?? e.kind}</span>)}
                </span>
                {busy === s.id && <span className="muted small">Loading…</span>}
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="card">
        <h2>Recent shipments</h2>
        {shipments.length === 0 ? (
          <p className="muted">None yet.</p>
        ) : (
          <table className="list">
            <thead>
              <tr>
                <th>Reference</th>
                <th>Destination</th>
                <th>Status</th>
                <th className="num">Documents</th>
                <th className="num">Findings</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {shipments.map((s) => (
                <tr key={s.id} onClick={() => go(`/s/${s.id}`)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && go(`/s/${s.id}`)}>
                  <td>{s.reference ?? <span className="muted">{s.id.slice(0, 8)}</span>}</td>
                  <td>{s.destination}</td>
                  <td><span className={`status ${s.status}`}>{s.status.replace('_', ' ')}</span></td>
                  <td className="num">{s.documentCount}</td>
                  <td className="num">{s.findingCount ?? '—'}</td>
                  <td className="muted">{new Date(s.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
