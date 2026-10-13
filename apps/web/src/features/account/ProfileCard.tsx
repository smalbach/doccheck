import { useState, type FormEvent } from 'react';
import { api } from '../../api/client';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Field } from '../../components/ui/Field';
import { TextInput } from '../../components/ui/TextInput';
import { errorMessage } from '../../lib/errorMessage';
import { formatDateTime } from '../../lib/formatDateTime';
import { useAuth } from '../auth/useAuth';

export function ProfileCard() {
  const { user, setUser } = useAuth();
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
      setStatus({ tone: 'ok', text: 'Profile saved.' });
    } catch (err) {
      setStatus({ tone: 'error', text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Profile">
      <form className="stack-form" onSubmit={(e) => void submit(e)}>
        {status && <Banner tone={status.tone}>{status.text}</Banner>}
        <Field label="Name">{(id) => <TextInput id={id} autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <Field label="Email">{(id) => <TextInput id={id} value={user.email} readOnly disabled />}</Field>
        <p className="muted small">Member since {formatDateTime(user.createdAt)}</p>
        <div>
          <Button type="submit" variant="primary" disabled={busy || !name.trim() || name.trim() === user.name}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </form>
    </Card>
  );
}
