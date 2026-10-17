import { useState } from 'react';
import { analyticsApi, QaError, type QaResult } from '../../api/analytics';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Field } from '../../components/ui/Field';
import { PageHeader } from '../../components/ui/PageHeader';
import { useI18n } from '../../i18n/useI18n';
import { errorMessage } from '../../lib/errorMessage';
import type { MessageKey } from '../../i18n/keys';

const EXAMPLES: MessageKey[] = ['analytics.ask.example1', 'analytics.ask.example2', 'analytics.ask.example3', 'analytics.ask.example4'];

/** Displays a cell as the API returned it: ISO timestamps shortened, null as a dash. */
const cellText = (v: unknown): string => {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return v.replace('T', ' ').slice(0, 16);
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
};

/** A question in plain language; the local model writes the SQL, shown with the rows it returns, and editable. */
export function AskPage() {
  const { t, formatNumber } = useI18n();
  const [question, setQuestion] = useState('');
  const [sql, setSql] = useState('');
  const [result, setResult] = useState<QaResult>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<'ask' | 'run'>();

  const go = async (kind: 'ask' | 'run', text: string) => {
    if (!text.trim()) return;
    setBusy(kind);
    setError(undefined);
    try {
      const r = kind === 'ask' ? await analyticsApi.ask(text.trim()) : await analyticsApi.runSql(text);
      setResult(r);
      setSql(r.sql);
    } catch (e) {
      setResult(undefined);
      if (e instanceof QaError) {
        if (e.sql) setSql(e.sql);
        setError(e.code === 'sql_rejected' ? t('analytics.ask.rejected', { message: e.message }) : t('analytics.ask.failed', { message: e.message }));
      } else setError(errorMessage(e));
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <div className="page">
      <PageHeader title={t('analytics.ask.title')} description={t('analytics.ask.description')} />
      <Card>
        <form
          className="ask-form"
          onSubmit={(e) => {
            e.preventDefault();
            void go('ask', question);
          }}
        >
          <Field label={t('analytics.ask.question')} grow>
            {(id) => <input id={id} className="input" value={question} maxLength={500} placeholder={t('analytics.ask.placeholder')} onChange={(e) => setQuestion(e.target.value)} />}
          </Field>
          <Button type="submit" variant="primary" disabled={!!busy || question.trim().length < 3}>
            {busy === 'ask' ? t('analytics.ask.asking') : t('analytics.ask.submit')}
          </Button>
        </form>
        <div className="ask-examples">
          <span className="muted small">{t('analytics.ask.examples')}:</span>
          {EXAMPLES.map((k) => (
            <Button
              key={k}
              size="sm"
              variant="ghost"
              disabled={!!busy}
              onClick={() => {
                setQuestion(t(k));
                void go('ask', t(k));
              }}
            >
              {t(k)}
            </Button>
          ))}
        </div>
        <p className="muted small">{t('analytics.ask.safety')}</p>
        <div aria-live="polite">{busy === 'ask' && <p className="muted small">{t('analytics.ask.asking')}</p>}</div>
      </Card>
      {(sql || error) && (
        <Card title={t('analytics.ask.sql')}>
          {error && <Banner tone="error">{error}</Banner>}
          {result?.explanation && <p>{result.explanation}</p>}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void go('run', sql);
            }}
          >
            <Field label={t('analytics.ask.sqlLabel')}>
              {(id) => <textarea id={id} className="input textarea mono ask-sql" rows={Math.min(14, Math.max(4, sql.split('\n').length + 1))} value={sql} spellCheck={false} onChange={(e) => setSql(e.target.value)} />}
            </Field>
            <div className="setting-row">
              <Button type="submit" disabled={!!busy || !sql.trim()}>
                {busy === 'run' ? t('analytics.ask.running') : t('analytics.ask.run')}
              </Button>
              {result && <span className="muted small">{[t('analytics.ask.rows', { count: result.rows.length }), t('analytics.ask.took', { ms: formatNumber(result.ms) }), result.model].filter(Boolean).join(' · ')}</span>}
            </div>
          </form>
          {result && !result.role && <p className="muted small">{t('analytics.ask.noRole')}</p>}
        </Card>
      )}
      {result && (
        <Card title={t('analytics.ask.answer')}>
          {result.truncated && <Banner tone="warning">{t('analytics.ask.truncated', { count: result.rows.length })}</Banner>}
          {result.rows.length === 0 ? (
            <p className="muted">{t('analytics.ask.noRows')}</p>
          ) : (
            <div className="table-wrap" tabIndex={0} role="region" aria-label={t('analytics.ask.resultCaption')}>
              <table className="table table-compact">
                <caption className="visually-hidden">{t('analytics.ask.resultCaption')}</caption>
                <thead>
                  <tr>
                    {result.columns.map((c, i) => (
                      <th key={i} scope="col">
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((r, i) => (
                    <tr key={i}>
                      {r.map((v, j) => (
                        <td key={j} className={typeof v === 'number' || (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v)) ? 'num' : undefined}>
                          {cellText(v)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
