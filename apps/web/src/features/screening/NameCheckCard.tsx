import { useState, type FormEvent } from 'react';
import { api } from '../../api/client';
import type { AllowlistItem, ScreeningMatch, ScreeningSearch } from '../../api/types';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { Field } from '../../components/ui/Field';
import { TextInput } from '../../components/ui/TextInput';
import { useI18n } from '../../i18n/useI18n';
import { errorMessage } from '../../lib/errorMessage';
import { AllowlistDialog } from './AllowlistDialog';

export interface NameCheckCardProps {
  /** The read-only demo: nothing can be set aside. */
  readOnly: boolean;
  onAdded: (item: AllowlistItem) => void;
}

/** Scores a name against the cached lists, as validation would, and lets a false positive be set aside. */
export function NameCheckCard({ readOnly, onAdded }: NameCheckCardProps) {
  const { t, formatNumber } = useI18n();
  const [name, setName] = useState('');
  const [country, setCountry] = useState('');
  const [result, setResult] = useState<{ name: string; search: ScreeningSearch }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const q = name.trim();
    if (q.length < 2) return;
    setBusy(true);
    setError(undefined);
    try {
      const code = country.trim().toUpperCase();
      setResult({ name: q, search: await api.screeningSearch({ q, ...(/^[A-Z]{2}$/.test(code) ? { country: code } : {}) }) });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const columns: Column<ScreeningMatch>[] = [
    {
      key: 'entry',
      header: t('screening.check.columns.entry'),
      cell: (m) => (
        <>
          {m.entry.url ? (
            <a href={m.entry.url} target="_blank" rel="noreferrer">
              {m.entry.name}
            </a>
          ) : (
            m.entry.name
          )}
          {m.matchedName !== m.entry.name && <div className="muted small">{t('screening.check.aka', { names: m.matchedName })}</div>}
          {m.entry.addresses[0] && <div className="muted small">{m.entry.addresses[0].text}</div>}
        </>
      ),
    },
    { key: 'list', header: t('screening.check.columns.list'), cell: (m) => m.listName, secondary: true },
    { key: 'score', header: t('screening.check.columns.score'), cell: (m) => formatNumber(m.score, 3), numeric: true },
    {
      key: 'outcome',
      header: t('screening.check.columns.outcome'),
      cell: (m) => <span className={m.outcome === 'below' ? 'muted' : `screening-outcome-${m.outcome}`}>{t(`screening.check.outcomes.${m.outcome}`)}</span>,
    },
    {
      key: 'actions',
      header: <span className="visually-hidden">{t('screening.check.columns.actions')}</span>,
      cell: (m) => (m.outcome === 'below' || !result ? null : <AllowlistDialog partyName={result.name} match={m} disabled={readOnly} onAdded={onAdded} />),
    },
  ];

  return (
    <Card title={t('screening.check.title')}>
      <p className="muted">{t('screening.check.text')}</p>
      <form className="filters screening-check" onSubmit={(e) => void submit(e)} role="search">
        <Field label={t('screening.check.name')} grow>
          {(id) => <TextInput id={id} value={name} onChange={(e) => setName(e.target.value)} minLength={2} maxLength={200} required autoComplete="off" />}
        </Field>
        <Field label={t('screening.check.country')}>
          {(id) => <TextInput id={id} className="input-country mono" value={country} onChange={(e) => setCountry(e.target.value)} maxLength={2} placeholder="CN" autoComplete="off" />}
        </Field>
        <Button type="submit" variant="primary" disabled={busy}>
          {t('screening.check.submit')}
        </Button>
      </form>
      {error && <Banner tone="error">{error}</Banner>}
      {result &&
        (result.search.matches.length === 0 ? (
          <p className="muted" role="status">
            {t('screening.check.none')}
          </p>
        ) : (
          <DataTable columns={columns} rows={result.search.matches} rowKey={(m) => `${m.list}:${m.entry.id}`} caption={t('screening.check.title')} compact />
        ))}
    </Card>
  );
}
