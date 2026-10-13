import { TrashIcon } from '@radix-ui/react-icons';
import { AlertDialog } from 'radix-ui';
import { useState, type FormEvent } from 'react';
import { api } from '../../api/client';
import { ApiError } from '../../api/ApiError';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Field } from '../../components/ui/Field';
import { TextInput } from '../../components/ui/TextInput';
import { useI18n } from '../../i18n/useI18n';
import { errorMessage } from '../../lib/errorMessage';
import { navigate } from '../../lib/navigate';
import { useAuth } from '../auth/useAuth';

/** Deleting the account asks for the password in a dialog; on success the session is gone. */
export function DeleteAccountCard() {
  const { t } = useI18n();
  const { logout } = useAuth();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const confirm = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await api.deleteAccount(password);
      await logout();
      navigate('/');
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? t('account.wrongPassword') : errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Card title={t('account.dangerTitle')} className="danger-zone">
      <p className="muted">{t('account.dangerText')}</p>
      <AlertDialog.Root onOpenChange={() => { setPassword(''); setError(undefined); }}>
        <AlertDialog.Trigger asChild>
          <Button variant="danger">
            <TrashIcon aria-hidden /> {t('account.deleteAccount')}
          </Button>
        </AlertDialog.Trigger>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="dialog-overlay" />
          <AlertDialog.Content className="dialog">
            <AlertDialog.Title className="dialog-title">{t('account.deleteConfirmTitle')}</AlertDialog.Title>
            <AlertDialog.Description className="dialog-description">{t('account.deleteConfirmText')}</AlertDialog.Description>
            <form className="stack-form" onSubmit={(e) => void confirm(e)}>
              {error && <Banner tone="error">{error}</Banner>}
              <Field label={t('auth.password')}>
                {(id) => <TextInput id={id} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />}
              </Field>
              <div className="dialog-actions">
                <AlertDialog.Cancel asChild>
                  <Button>{t('common.cancel')}</Button>
                </AlertDialog.Cancel>
                <Button type="submit" variant="danger" disabled={busy || !password}>
                  {busy ? t('account.deleting') : t('account.deleteAccount')}
                </Button>
              </div>
            </form>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </Card>
  );
}
