import { Dialog } from 'radix-ui';
import { useState, type FormEvent } from 'react';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Field } from '../../components/ui/Field';
import { useI18n } from '../../i18n/useI18n';

export interface ReviewNoteDialogProps {
  status: 'accepted' | 'false_positive';
  ruleId: string;
  onClose: () => void;
  onConfirm: (note: string) => Promise<void>;
}

/** Asks why a finding is accepted as a risk or marked a false positive: the note is required. */
export function ReviewNoteDialog({ status, ruleId, onClose, onConfirm }: ReviewNoteDialogProps) {
  const { t } = useI18n();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (note.trim().length < 3) return setError(t('review.note.tooShort'));
    setSaving(true);
    try {
      await onConfirm(note.trim());
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  };
  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog">
          <Dialog.Title className="dialog-title">{t(status === 'accepted' ? 'review.note.acceptTitle' : 'review.note.falsePositiveTitle', { rule: ruleId })}</Dialog.Title>
          <Dialog.Description className="dialog-description">{t('review.note.text')}</Dialog.Description>
          <form className="stack-form" onSubmit={(e) => void submit(e)} aria-busy={saving}>
            <Field label={t('review.note.label')}>
              {(id) => <textarea id={id} className="input textarea" rows={3} maxLength={2000} value={note} placeholder={t('review.note.placeholder')} onChange={(e) => setNote(e.target.value)} autoFocus />}
            </Field>
            {error && <Banner tone="error">{error}</Banner>}
            <div className="dialog-actions">
              <Dialog.Close asChild>
                <Button>{t('common.cancel')}</Button>
              </Dialog.Close>
              <Button type="submit" variant="primary" disabled={saving}>
                {saving ? t('common.saving') : t('review.note.confirm')}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
