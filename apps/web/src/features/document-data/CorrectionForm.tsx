import { useMemo, useState, type FormEvent } from 'react';
import { api } from '../../api/client';
import { ApiError } from '../../api/ApiError';
import type { DocumentDetail, DocumentType, ExtractedData } from '../../api/types';
import { Button } from '../../components/ui/Button';
import { useI18n } from '../../i18n/useI18n';
import { buildCorrectionFields } from '../../lib/buildCorrectionFields';
import { correctionChanges } from '../../lib/correctionChanges';
import { errorMessage } from '../../lib/errorMessage';
import { groupCorrectionFields } from '../../lib/groupCorrectionFields';
import { issuesByPath } from '../../lib/issuesByPath';
import { CorrectionInput } from './CorrectionInput';

export interface CorrectionFormProps {
  shipmentId: string;
  documentId: string;
  type: DocumentType;
  data: ExtractedData;
  /** Values corrected by hand: pointer → what the model read. */
  corrected: ReadonlyMap<string, unknown>;
  onSaved: (detail: DocumentDetail) => void;
  onCancel: () => void;
}

/** Edit mode of the extracted data: the key fields and invoice lines as inputs; Save sends only what changed. */
export function CorrectionForm({ shipmentId, documentId, type, data, corrected, onSaved, onCancel }: CorrectionFormProps) {
  const { t } = useI18n();
  const fields = useMemo(() => buildCorrectionFields(type, data), [type, data]);
  const groups = useMemo(() => groupCorrectionFields(fields), [fields]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [issues, setIssues] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  // Issues on values without an input (a required field the change removed, a line number...).
  const shown = new Set(fields.map((f) => f.pointer));
  const otherIssues = [...issues].filter(([path]) => !shown.has(path));

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const changes = correctionChanges(fields, values);
    if (changes.length === 0) {
      setIssues(new Map());
      setError(t('extracted.noChanges'));
      return;
    }
    setBusy(true);
    setError(undefined);
    setIssues(new Map());
    try {
      onSaved(await api.correctData(shipmentId, documentId, changes));
    } catch (err) {
      if (err instanceof ApiError && err.issues.length) setIssues(issuesByPath(err.issues));
      setError(t('extracted.saveError', { message: errorMessage(err) }));
    } finally {
      setBusy(false);
    }
  };

  const input = (f: (typeof fields)[number]) => (
    <CorrectionInput
      key={f.pointer}
      field={f}
      value={values[f.pointer] ?? f.initial}
      error={issues.get(f.pointer)}
      corrected={corrected.has(f.pointer)}
      modelValue={corrected.get(f.pointer)}
      onChange={(value) => {
        setValues((v) => ({ ...v, [f.pointer]: value }));
        // The API's message was about the previous value.
        if (issues.has(f.pointer)) setIssues((all) => new Map([...all].filter(([path]) => path !== f.pointer)));
      }}
    />
  );

  return (
    <form className="correction-form" onSubmit={(e) => void save(e)} noValidate>
      <p className="muted small">{t('extracted.editHint')}</p>
      {groups.map((g) =>
        g.line === undefined ? (
          <div key="fields" className="correction-grid">
            {g.fields.map(input)}
          </div>
        ) : (
          <fieldset key={`line-${g.line}`} className="correction-line">
            <legend>{t('extracted.line', { number: g.line })}</legend>
            <div className="correction-grid">{g.fields.map(input)}</div>
          </fieldset>
        ),
      )}
      {error && (
        <div className="error" role="alert">
          <p>{error}</p>
          {otherIssues.length > 0 && (
            <ul className="small" lang="en">
              {otherIssues.map(([path, message]) => (
                <li key={path}>
                  {path && <code>{path}</code>} {message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="correction-actions">
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? t('common.saving') : t('extracted.save')}
        </Button>
        <Button onClick={onCancel} disabled={busy}>
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  );
}
