import { CopyIcon, LockClosedIcon, ReloadIcon } from '@radix-ui/react-icons';
import { AlertDialog } from 'radix-ui';
import { useState, type FormEvent } from 'react';
import { api } from '../../../api/client';
import type { UserSummary } from '../../../api/types';
import { Banner } from '../../../components/ui/Banner';
import { Button } from '../../../components/ui/Button';
import { Field } from '../../../components/ui/Field';
import { TextInput } from '../../../components/ui/TextInput';
import { useI18n } from '../../../i18n/useI18n';
import { errorMessage } from '../../../lib/errorMessage';
import { generatePassword } from '../../../lib/generatePassword';
import { MIN_PASSWORD_LENGTH } from '../../../lib/validateSignUp';

export interface ResetPasswordDialogProps {
  user: UserSummary;
  disabled: boolean;
  onDone: (message: string) => void;
}

/** Sets a new password for someone who forgot theirs (there is no email reset); they are signed out everywhere. */
export function ResetPasswordDialog({ user, disabled, onDone }: ResetPasswordDialogProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [copied, setCopied] = useState(false);

  const openChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      setPassword(generatePassword());
      setError(undefined);
      setCopied(false);
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < MIN_PASSWORD_LENGTH) return setError(t('auth.errors.passwordTooShort', { min: MIN_PASSWORD_LENGTH }));
    setBusy(true);
    setError(undefined);
    try {
      await api.resetPassword(user.id, password);
      setOpen(false);
      onDone(t('admin.resetPassword.done', { name: user.name }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog.Root open={open} onOpenChange={openChange}>
      <AlertDialog.Trigger asChild>
        <Button size="sm" disabled={disabled} aria-label={`${t('admin.resetPassword.action')} · ${user.name}`}>
          <LockClosedIcon aria-hidden /> {t('admin.resetPassword.action')}
        </Button>
      </AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="dialog-overlay" />
        <AlertDialog.Content className="dialog">
          <AlertDialog.Title className="dialog-title">{t('admin.resetPassword.title', { name: user.name })}</AlertDialog.Title>
          <AlertDialog.Description className="dialog-description">{t('admin.resetPassword.text', { email: user.email })}</AlertDialog.Description>
          <form className="stack-form" onSubmit={(e) => void submit(e)}>
            {error && <Banner tone="error">{error}</Banner>}
            <Field label={t('admin.resetPassword.label', { min: MIN_PASSWORD_LENGTH })}>
              {(id) => <TextInput id={id} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" spellCheck={false} className="mono" required />}
            </Field>
            <div className="dialog-tools">
              <Button size="sm" onClick={() => setPassword(generatePassword())}>
                <ReloadIcon aria-hidden /> {t('admin.resetPassword.generate')}
              </Button>
              <Button size="sm" onClick={() => void copy()}>
                <CopyIcon aria-hidden /> {copied ? t('admin.resetPassword.copied') : t('admin.resetPassword.copy')}
              </Button>
            </div>
            <div className="dialog-actions">
              <AlertDialog.Cancel asChild>
                <Button>{t('common.cancel')}</Button>
              </AlertDialog.Cancel>
              <Button type="submit" variant="primary" disabled={busy}>
                {busy ? t('common.saving') : t('admin.resetPassword.confirm')}
              </Button>
            </div>
          </form>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
