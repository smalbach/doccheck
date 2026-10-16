import { AlertDialog } from 'radix-ui';
import { useState, type FormEvent } from 'react';
import { api } from '../../api/client';
import type { AllowlistItem, ScreeningMatch } from '../../api/types';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Field } from '../../components/ui/Field';
import { useI18n } from '../../i18n/useI18n';
import { errorMessage } from '../../lib/errorMessage';

export interface AllowlistDialogProps {
  partyName: string;
  match: ScreeningMatch;
  disabled: boolean;
  onAdded: (item: AllowlistItem) => void;
}

/** Sets a match aside as a false positive for the account; a reason is required and kept. */
export function AllowlistDialog({ partyName, match, disabled, onAdded }: AllowlistDialogProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const entry = `${match.entry.name} (${match.listName})`;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (reason.trim().length < 3) return setError(t('screening.allowlist.reasonTooShort'));
    setBusy(true);
    setError(undefined);
    try {
      const item = await api.addAllowlist({ partyName, list: match.list, entryId: match.entry.id, reason: reason.trim() });
      setOpen(false);
      setReason('');
      onAdded(item);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setError(undefined);
      }}
    >
      <AlertDialog.Trigger asChild>
        <Button size="sm" disabled={disabled} aria-label={`${t('screening.check.setAside')} · ${entry}`}>
          {t('screening.check.setAside')}
        </Button>
      </AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="dialog-overlay" />
        <AlertDialog.Content className="dialog">
          <AlertDialog.Title className="dialog-title">{t('screening.allowlist.dialogTitle', { entry, party: partyName })}</AlertDialog.Title>
          <AlertDialog.Description className="dialog-description">{t('screening.allowlist.dialogText')}</AlertDialog.Description>
          <form className="stack-form" onSubmit={(e) => void submit(e)}>
            {error && <Banner tone="error">{error}</Banner>}
            <Field label={t('screening.allowlist.reason')}>
              {(id) => <textarea id={id} className="input textarea" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} required />}
            </Field>
            <div className="dialog-actions">
              <AlertDialog.Cancel asChild>
                <Button>{t('common.cancel')}</Button>
              </AlertDialog.Cancel>
              <Button type="submit" variant="primary" disabled={busy}>
                {busy ? t('common.saving') : t('screening.allowlist.confirm')}
              </Button>
            </div>
          </form>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
