import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import type { ReviewField } from '../../api/review';
import type { DocumentType } from '../../api/types';
import { Button } from '../../components/ui/Button';
import { Field } from '../../components/ui/Field';
import { TextInput } from '../../components/ui/TextInput';
import { useI18n } from '../../i18n/useI18n';
import { reviewFieldLabel } from '../../lib/reviewFieldLabel';
import { ConfidenceTag } from './ConfidenceTag';

export interface ReviewFieldPanelProps {
  field: ReviewField;
  documentType: DocumentType;
  busy: boolean;
  editable: boolean;
  /** Bumped by the E shortcut: opens the editor. */
  editRequest: number;
  onAccept: () => void;
  onSave: (value: string) => void;
}

/** The selected value: what was read, what is printed, why it is doubted; accept it or correct it. */
export function ReviewFieldPanel({ field, documentType, busy, editable, editRequest, onAccept, onSave }: ReviewFieldPanelProps) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const label = reviewFieldLabel(field.path, documentType, t);

  const startEdit = () => {
    setDraft(field.value === null ? (field.printed ?? '') : String(field.value));
    setEditing(true);
  };
  useEffect(() => setEditing(false), [field.path]);
  useEffect(() => {
    if (editRequest > 0 && editable) startEdit();
    // Only a new request opens the editor.
  }, [editRequest]);
  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSave(draft.trim());
    setEditing(false);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setEditing(false);
    }
  };

  return (
    <div className="review-panel">
      <h3>{label}</h3>
      <dl className="review-facts">
        <dt>{t('reviewQueue.current')}</dt>
        <dd>{field.value === null ? <em>{t('reviewQueue.empty')}</em> : String(field.value)}</dd>
        {field.modelValue !== field.value && (
          <>
            <dt>{t('reviewQueue.modelRead')}</dt>
            <dd>{field.modelValue === null ? <em>{t('reviewQueue.empty')}</em> : String(field.modelValue)}</dd>
          </>
        )}
        <dt>{t('reviewQueue.printed')}</dt>
        <dd>{field.source ? <code>{field.source.rawText.replace(/\s+/g, ' ').trim()}</code> : <em>{t('reviewQueue.notFound')}</em>}</dd>
      </dl>
      <p className="review-why">
        <ConfidenceTag confidence={field.confidence} low={field.low} /> {field.reasons.map((r) => t(`reviewQueue.reasons.${r}`)).join(' · ')}
      </p>
      {editing ? (
        <form className="form-row" onSubmit={submit} onKeyDown={onKeyDown}>
          <Field label={t('reviewQueue.editLabel', { field: label })} grow>
            {(id) => <TextInput id={id} ref={input} value={draft} onChange={(e) => setDraft(e.target.value)} />}
          </Field>
          <Button type="submit" variant="primary" disabled={busy}>
            {t('reviewQueue.saveEdit')}
          </Button>
          <Button onClick={() => setEditing(false)}>{t('common.cancel')}</Button>
        </form>
      ) : (
        editable && (
          <div className="review-actions">
            <Button variant="primary" onClick={onAccept} disabled={busy} aria-keyshortcuts="A">
              {t('reviewQueue.accept')}
            </Button>
            <Button onClick={startEdit} disabled={busy} aria-keyshortcuts="E">
              {t('reviewQueue.edit')}
            </Button>
          </div>
        )
      )}
    </div>
  );
}
