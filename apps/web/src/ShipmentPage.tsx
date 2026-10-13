import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError, type Finding, type IsfFiling, type RuleDefinition, type Shipment, type ShipmentDocument, type Validation } from './api';
import { useDemo } from './demo';
import { DocumentData } from './DocumentData';
import type { Highlight } from './PdfViewer';

// pdf.js is large: load it only when a document is opened.
const PdfViewer = lazy(() => import('./PdfViewer').then((m) => ({ default: m.PdfViewer })));

const TYPE_LABEL: Record<string, string> = {
  COMMERCIAL_INVOICE: 'Commercial invoice',
  PACKING_LIST: 'Packing list',
  BILL_OF_LADING: 'Bill of lading',
  ISF: 'ISF',
  UNKNOWN: 'Unknown',
};
const SEVERITY_ORDER = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
const pending = (d: ShipmentDocument) => d.status === 'QUEUED' || d.status === 'EXTRACTING';

export function ShipmentPage({ id }: { id: string }) {
  const demo = useDemo();
  const [shipment, setShipment] = useState<Shipment>();
  const [validation, setValidation] = useState<Validation>();
  const [rules, setRules] = useState<Record<string, RuleDefinition>>({});
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<'upload' | 'validate'>();
  const [useAgent, setUseAgent] = useState(true);
  const [viewer, setViewer] = useState<{ doc: ShipmentDocument; highlight?: Highlight }>();
  const [dataDoc, setDataDoc] = useState<ShipmentDocument>();
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const refresh = useCallback(() => api.shipment(id).then(setShipment, (e: Error) => setError(e.message)), [id]);

  useEffect(() => {
    void refresh();
    api.validation(id).then(setValidation, () => setValidation(undefined));
  }, [id, refresh]);

  useEffect(() => {
    if (!shipment?.destination) return;
    api.rules(shipment.destination).then((r) => setRules(Object.fromEntries(r.map((x) => [x.id, x]))), () => undefined);
  }, [shipment?.destination]);

  // Poll while documents are being extracted.
  const extracting = shipment?.documents.some(pending) ?? false;
  useEffect(() => {
    if (!extracting) return;
    const t = setInterval(() => void refresh(), 2000);
    return () => clearInterval(t);
  }, [extracting, refresh]);

  const upload = async (files: File[]) => {
    const pdfs = files.filter((f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
    if (pdfs.length === 0) return setError('Only PDF files can be uploaded.');
    setBusy('upload');
    setError(undefined);
    try {
      await api.upload(id, pdfs);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(undefined);
    }
  };

  const validate = async () => {
    setBusy('validate');
    setError(undefined);
    try {
      setValidation(await api.validate(id, useAgent));
      await refresh();
    } catch (e) {
      setError(e instanceof ApiError && e.status === 409 ? 'Some documents are still being extracted. Validate when they are done.' : (e as Error).message);
    } finally {
      setBusy(undefined);
    }
  };

  const docs = useMemo(() => new Map((shipment?.documents ?? []).map((d) => [d.id, d])), [shipment]);
  const findings = useMemo(
    () => [...(validation?.findings ?? [])].sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) || a.ruleId.localeCompare(b.ruleId)),
    [validation],
  );

  if (!shipment) return <div className="card">{error ? <p className="error">{error}</p> : <p className="muted">Loading…</p>}</div>;
  const extracted = shipment.documents.filter((d) => d.status === 'EXTRACTED').length;

  return (
    <div className="shipment">
      <div className="title-row">
        <div>
          <a href="#/" className="back">← Shipments</a>
          <h1>{shipment.reference ?? `Shipment ${shipment.id.slice(0, 8)}`}</h1>
          <p className="muted">
            {shipment.destination === 'CA' ? 'Canada · CBSA' : shipment.destination === 'US' ? 'United States · CBP' : 'No destination'} ·{' '}
            <span className={`status ${shipment.status}`}>{shipment.status.replace('_', ' ')}</span>
          </p>
        </div>
        {!demo && <button
          className="danger"
          disabled={extracting}
          title={extracting ? 'Wait until extraction finishes' : 'Delete the shipment, its documents and findings'}
          onClick={async () => {
            if (!window.confirm('Delete this shipment, its PDFs, extractions and findings? This cannot be undone.')) return;
            try {
              await api.remove(id);
              window.location.hash = '/';
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          Delete
        </button>}
      </div>
      {error && <p className="error banner">{error}</p>}

      <div className="columns">
        <section className="card">
          <h2>Documents</h2>
          {!demo && <div
            className={`drop ${dragging ? 'over' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              void upload([...e.dataTransfer.files]);
            }}
            onClick={() => input.current?.click()}
            role="button"
            tabIndex={0}
          >
            <input ref={input} type="file" accept="application/pdf" multiple hidden onChange={(e) => void upload([...(e.target.files ?? [])])} />
            {busy === 'upload' ? 'Uploading…' : `Drop PDFs here or click to choose: invoice, packing list, bill of lading${shipment.destination === 'US' ? ', ISF' : ''}`}
          </div>}
          {shipment.documents.length > 0 && (
            <ul className="docs">
              {shipment.documents.map((d) => (
                <li key={d.id}>
                  <button className="link" onClick={() => setViewer({ doc: d })} disabled={d.status === 'QUEUED'}>
                    {d.fileName}
                  </button>
                  <span className="muted small">
                    {d.status === 'EXTRACTED' ? `${TYPE_LABEL[d.detectedType]} · ${d.pageCount} page${d.pageCount === 1 ? '' : 's'}` : d.status === 'FAILED' ? d.error : 'Extracting with the local model…'}
                    {d.status === 'EXTRACTED' && (
                      <>
                        {' · '}
                        <button className="link small" onClick={() => setDataDoc(d)}>extracted data</button>
                      </>
                    )}
                  </span>
                  <span className={`status ${d.status}`}>{pending(d) ? <span className="spinner" aria-label="in progress" /> : (d.status ?? 'extracted').toLowerCase()}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="validate">
            <label className="check">
              <input type="checkbox" checked={useAgent} onChange={(e) => setUseAgent(e.target.checked)} /> Agent review (local model)
            </label>
            <button className="primary" onClick={validate} disabled={busy !== undefined || extracting || extracted === 0}>
              {busy === 'validate' ? (useAgent ? 'Validating and reviewing…' : 'Validating…') : 'Validate'}
            </button>
          </div>
          {shipment.destination === 'US' && (
            <IsfCard
              id={id}
              readOnly={demo}
              version={shipment.documents.filter((d) => d.detectedType === 'ISF' || pending(d)).map((d) => `${d.id}:${d.status}`).join(',')}
              onError={setError}
              onOpen={(documentId) => {
                const doc = docs.get(documentId);
                if (doc) setViewer({ doc });
              }}
            />
          )}
          {validation && validation.skipped.length > 0 && (
            <p className="muted small">
              Not checked: {validation.skipped.map((s) => `${s.ruleId} (needs ${s.missing.map((m) => TYPE_LABEL[m]).join(', ')})`).join('; ')}.
            </p>
          )}
        </section>

        <section className="card findings">
          <div className="section-head">
            <h2>Findings</h2>
            {validation && <span className="muted small">{new Date(validation.createdAt ?? Date.now()).toLocaleString()} · {validation.ran.length} rules ran</span>}
          </div>
          {!validation ? (
            <p className="muted">Upload the documents and validate to see findings.</p>
          ) : findings.length === 0 ? (
            <p className="ok-banner">No inconsistencies found by the {validation.ran.length} rules that ran.</p>
          ) : (
            findings.map((f) => <FindingCard key={f.id} f={f} rule={rules[f.ruleId]} docs={docs} open={(doc, highlight) => setViewer({ doc, highlight })} />)
          )}
          {validation?.agent && validation.agent.decisions.length > 0 && (
            <details className="decisions">
              <summary>Agent decisions ({validation.agent.decisions.length})</summary>
              <ul>
                {validation.agent.decisions.map((d, i) => (
                  <li key={i}>
                    <strong>{d.ruleId}</strong> {d.question} <span className={`verdict ${d.verdict}`}>{d.verdict}</span> <span className="muted small">{Math.round(d.confidence * 100)}% · {d.effect}</span>
                    <div className="muted small">{d.rationale}</div>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {validation?.agent?.status === 'failed' && <p className="muted small">Agent review unavailable: {validation.agent.error}</p>}
        </section>
      </div>

      {dataDoc && (
        <DocumentData
          shipmentId={id}
          doc={dataDoc}
          onClose={() => setDataDoc(undefined)}
          onReextract={() => {
            setDataDoc(undefined);
            void refresh();
          }}
        />
      )}
      {viewer && (
        <Suspense fallback={<div className="viewer"><p className="muted" style={{ padding: 16 }}>Loading viewer…</p></div>}>
          <PdfViewer url={api.fileUrl(id, viewer.doc.id)} title={`${TYPE_LABEL[viewer.doc.detectedType]} · ${viewer.doc.fileName}`} highlight={viewer.highlight} onClose={() => setViewer(undefined)} />
        </Suspense>
      )}
    </div>
  );
}

/**
 * The shipment's ISF: from its filing confirmation PDF (dropped with the other documents), from
 * JSON (the Isf schema), or from the sample. `version` changes when an ISF PDF finishes extracting.
 */
function IsfCard({ id, version, readOnly, onError, onOpen }: { id: string; version: string; readOnly: boolean; onError: (m: string) => void; onOpen: (documentId: string) => void }) {
  const [isf, setIsf] = useState<IsfFiling | null>();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    api.isf(id).then(setIsf, () => setIsf(null));
  }, [id, version]);

  const upload = async (file?: File) => {
    if (!file) return;
    try {
      setIsf(await api.saveIsf(id, JSON.parse(await file.text())));
    } catch (e) {
      onError(e instanceof SyntaxError ? `${file.name} is not valid JSON.` : `ISF rejected: ${(e as Error).message}`);
    }
  };

  if (isf === undefined) return null;
  return (
    <div className="isf">
      <h3>ISF (10+2)</h3>
      {isf ? (
        <p className="small">
          Seller {isf.data.seller.name} · origin {isf.data.countryOfOrigin} · HTS {isf.data.htsCode}
          <br />
          <span className="muted">
            {isf.source === 'pdf' && isf.documentId ? (
              <>
                From PDF{' '}
                <button className="link small" onClick={() => onOpen(isf.documentId!)}>{isf.fileName ?? 'document'}</button>
              </>
            ) : isf.source === 'sample' ? (
              'From the sample'
            ) : (
              'Uploaded as JSON'
            )}{' '}
            {new Date(isf.updatedAt).toLocaleString()}
            {!readOnly && (
              <>
                {' · '}
                <button className="link small" onClick={() => api.deleteIsf(id).then(() => setIsf(null))}>remove</button>
              </>
            )}
          </span>
        </p>
      ) : (
        <p className="small muted">
          No ISF on file, so X11 (ISF vs invoice) will not run.
          {!readOnly && (
            <>
              {' '}Drop the ISF filing PDF with the documents, or{' '}
              <button className="link small" onClick={() => input.current?.click()}>upload ISF JSON</button>
            </>
          )}
        </p>
      )}
      <input ref={input} type="file" accept="application/json,.json" hidden onChange={(e) => void upload(e.target.files?.[0])} />
    </div>
  );
}

function FindingCard({ f, rule, docs, open }: { f: Finding; rule?: RuleDefinition; docs: Map<string, ShipmentDocument>; open: (d: ShipmentDocument, h?: Highlight) => void }) {
  return (
    <article className={`finding ${f.severity}`}>
      <header>
        <span className={`sev ${f.severity}`}>{f.severity}</span>
        <span className="rule">{f.ruleId}</span>
        <span className="rule-title">{rule?.title}</span>
        {f.decidedBy === 'AGENT' && <span className="tag agent">agent</span>}
      </header>
      <p>{f.message}</p>
      <ul className="evidence">
        {f.evidence.map((e, i) => {
          const doc = docs.get(e.documentId);
          return (
            <li key={i}>
              <span className="muted">{doc ? TYPE_LABEL[doc.detectedType] : e.documentId}</span> <code>{e.field}</code>
              {e.value ? <> = <strong>{e.value}</strong></> : <em className="muted"> missing</em>}
              {doc && e.source && (
                <button className="link small" onClick={() => open(doc, { page: e.source!.page, bbox: e.source!.bbox! })}>
                  page {e.source.page} ↗
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {f.agentRationale && <p className="rationale"><strong>Agent:</strong> {f.agentRationale}</p>}
      {f.suggestedFix && <p className="fix">{f.suggestedFix}</p>}
      {f.regulation && (
        <blockquote className="regulation">
          <p>“{f.regulation.excerpt}”</p>
          <footer>
            <a href={f.regulation.url} target="_blank" rel="noreferrer">{f.regulation.title}</a>
            {f.regulation.effectiveDate && <span className="muted"> · effective {f.regulation.effectiveDate}</span>}
          </footer>
        </blockquote>
      )}
    </article>
  );
}
