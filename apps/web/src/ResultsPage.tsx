import { useEffect, useState } from 'react';

interface RuleRow {
  rule: string;
  tp: number;
  fp: number;
  fn: number;
  recall: number | null;
  precision: number | null;
}

interface ExtractionReport {
  set: string;
  provider: string;
  modelVersion?: string;
  promptVersion: string;
  shipments: number;
  documents: number;
  failedDocuments: number;
  classificationAccuracy: number;
  overall: { total: number; correct: number; accuracy: number };
  byType: { type: string; accuracy: number; total: number }[];
  byTemplate: { template: string; accuracy: number; total: number }[];
  weakestFields: { type: string; field: string; accuracy: number; total: number }[];
  rules: { shipmentsWithAllDocuments: number; table: RuleRow[] };
}

interface Results {
  extraction: ExtractionReport[];
  agent: { provider: string; modelVersion?: string; summary: { kind: string; cases: number; accuracy: number; effectAccuracy?: number; wrong: number; unsure: number }[] } | null;
}

const pct = (x: number | null | undefined) => (x === null || x === undefined ? '—' : `${(x * 100).toFixed(1)}%`);
const SET_LABEL: Record<string, string> = { v1: 'PDFs with a text layer', 'v1-scans': 'Scanned PDFs (OCR)', 'v1-isf': 'ISF filings', v2: 'Unseen layouts and formats (v2)' };
const TYPE_LABEL: Record<string, string> = { COMMERCIAL_INVOICE: 'Commercial invoice', PACKING_LIST: 'Packing list', BILL_OF_LADING: 'Bill of lading', ISF: 'ISF' };

/** Evaluation results on the synthetic set, from eval/reports through GET /results. */
export function ResultsPage() {
  const [results, setResults] = useState<Results>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    fetch('/results')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
      .then(setResults, (e: Error) => setError(e.message));
  }, []);

  if (error) return <div className="card"><p className="error">Could not load results ({error}).</p></div>;
  if (!results) return <div className="card"><p className="muted">Loading…</p></div>;

  // The main model is the one the agent runs on (the app's configured model); otherwise the one with
  // the most documents evaluated. Other models are shown as comparisons.
  const main =
    results.extraction.find((r) => r.provider === results.agent?.provider && r.set === 'v1') ??
    [...results.extraction].sort((a, b) => b.documents - a.documents || b.overall.accuracy - a.overall.accuracy)[0];
  const sets = results.extraction.filter((r) => r.provider === main?.provider);
  const others = results.extraction.filter((r) => r.provider !== main?.provider && r.set === 'v1');
  const v1 = sets.find((r) => r.set === 'v1');

  return (
    <div className="results">
      <a href="#/" className="back">← Shipments</a>
      <h1>Evaluation results</h1>
      <p className="muted">
        Measured on synthetic shipments with known, injected errors (100 to Canada, 100 to the US), with the model running locally
        {main ? ` (${main.provider}${main.modelVersion ? `, build ${main.modelVersion}` : ''})` : ''}. Real documents will differ: treat these as a lower bound on what can go wrong, not a guarantee.
      </p>

      {sets.length === 0 ? (
        <div className="card"><p className="muted">No evaluation has been run yet (npm run eval:extraction).</p></div>
      ) : (
        <div className="stats">
          {sets.map((r) => (
            <div key={r.set} className="stat">
              <span className="stat-value">{pct(r.overall.accuracy)}</span>
              <span className="stat-label">fields read correctly · {SET_LABEL[r.set] ?? r.set}</span>
              <span className="muted small">{r.documents} PDFs · document type {pct(r.classificationAccuracy)}</span>
            </div>
          ))}
          {results.agent?.summary.map((s) => (
            <div key={s.kind} className="stat">
              <span className="stat-value">{pct(s.effectAccuracy ?? s.accuracy)}</span>
              <span className="stat-label">right action · agent: {s.kind === 'party' ? 'same consignee?' : 'BL description vs goods?'}</span>
              <span className="muted small">{s.cases} cases · {s.wrong} wrong · {s.unsure} unsure</span>
            </div>
          ))}
        </div>
      )}

      {v1 && (
        <section className="card">
          <h2>Rules on the extracted documents</h2>
          <p className="muted small">
            End to end: PDFs read by the model, then the rules. A miss can come from extraction or from the rule. {v1.rules.shipmentsWithAllDocuments} of {v1.shipments} shipments had all three documents extracted.
          </p>
          <table className="list compact">
            <thead>
              <tr><th>Rule</th><th className="num">Recall</th><th className="num">Precision</th><th className="num">Caught</th><th className="num">False alarms</th><th className="num">Missed</th></tr>
            </thead>
            <tbody>
              {v1.rules.table.map((r) => (
                <tr key={r.rule}>
                  <td>{r.rule}</td>
                  <td className="num">{pct(r.recall)}</td>
                  <td className="num">{pct(r.precision)}</td>
                  <td className="num">{r.tp}</td>
                  <td className="num">{r.fp}</td>
                  <td className="num">{r.fn}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <div className="columns-2">
        {sets.map((r) => (
          <section className="card" key={r.set}>
            <h2>{SET_LABEL[r.set] ?? r.set}</h2>
            <table className="list compact">
              <thead><tr><th>Document</th><th className="num">Fields correct</th><th className="num">Fields</th></tr></thead>
              <tbody>
                {r.byType.map((t) => (
                  <tr key={t.type}><td>{TYPE_LABEL[t.type] ?? t.type}</td><td className="num">{pct(t.accuracy)}</td><td className="num">{t.total}</td></tr>
                ))}
              </tbody>
            </table>
            {r.weakestFields.length > 0 && (
              <>
                <h3 className="small muted">Weakest fields</h3>
                <ul className="small plain">
                  {r.weakestFields.slice(0, 5).map((f) => (
                    <li key={f.type + f.field}><code>{f.field}</code> <span className="muted">({TYPE_LABEL[f.type] ?? f.type})</span> {pct(f.accuracy)}</li>
                  ))}
                </ul>
              </>
            )}
            <p className="muted small">prompt {r.promptVersion} · {r.failedDocuments} failed</p>
          </section>
        ))}
      </div>

      {others.length > 0 && v1 && (
        <section className="card">
          <h2>Model comparison</h2>
          <table className="list compact">
            <thead><tr><th>Model</th><th className="num">PDFs</th><th className="num">Fields correct</th></tr></thead>
            <tbody>
              {[v1, ...others].map((r) => (
                <tr key={r.provider}><td>{r.provider}{r.modelVersion ? <span className="muted small"> · {r.modelVersion}</span> : null}</td><td className="num">{r.documents}</td><td className="num">{pct(r.overall.accuracy)}</td></tr>
              ))}
            </tbody>
          </table>
          <p className="muted small">Comparisons on fewer documents are indicative only.</p>
        </section>
      )}
    </div>
  );
}
