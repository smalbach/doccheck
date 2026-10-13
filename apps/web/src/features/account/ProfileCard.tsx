import { useState, type FormEvent } from 'react';
import { api } from '../../api/client';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Field } from '../../components/ui/Field';
import { TextInput } from '../../components/ui/TextInput';
import { useI18n } from '../../i18n/useI18n';
import { errorMessage } from '../../lib/errorMessage';
import { useAuth } from '../auth/useAuth';

export function ProfileCard() {
  const { user, setUser } = useAuth();
  const { t, formatDateTime } = useI18n();
  const [name, setName] = useState(user?.name ?? '');
  const [status, setStatus] = useState<{ tone: 'ok' | 'error'; text: string }>();
  const [busy, setBusy] = useState(false);
  if (!user) return null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setStatus(undefined);
    try {
      setUser(await api.updateProfile({ name: name.trim() }));
      setStatus({ tone: 'ok', text: t('account.saved') });
    } catch (err) {
      setStatus({ tone: 'error', text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title={t('account.profile')}>
      <form className="stack-form" onSubmit={(e) => void submit(e)} aria-busy={busy}>
        {status && <Banner tone={status.tone}>{status.text}</Banner>}
        <Field label={t('auth.name')}>{(id) => <TextInput id={id} autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <Field label={t('auth.email')}>{(id) => <TextInput id={id} value={user.email} readOnly aria-readonly />}</Field>
        <p className="muted small">{t('account.memberSince', { date: formatDateTime(user.createdAt) })}</p>
        <div>
          <Button type="submit" variant="primary" disabled={busy || !name.trim() || name.trim() === user.name}>
            {busy ? t('common.saving') : t('common.save')}
          </Button>
        </div>
      </form>
    </Card>
  );
}
