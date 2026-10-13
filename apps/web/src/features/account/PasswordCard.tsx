import { useState, type FormEvent } from 'react';
import { api } from '../../api/client';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Field } from '../../components/ui/Field';
import { TextInput } from '../../components/ui/TextInput';
import { errorMessage } from '../../lib/errorMessage';
import { MIN_PASSWORD_LENGTH } from '../../lib/validateSignUp';

const EMPTY = { current: '', next: '', confirm: '' };

export function PasswordCard() {
  const [form, setForm] = useState(EMPTY);
  const [status, setStatus] = useState<{ tone: 'ok' | 'error'; text: string }>();
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof EMPTY) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (form.next.length < MIN_PASSWORD_LENGTH) return setStatus({ tone: 'error', text: `Use at least ${MIN_PASSWORD_LENGTH} characters.` });
    if (form.next !== form.confirm) return setStatus({ tone: 'error', text: 'The new passwords do not match.' });
    setBusy(true);
    setStatus(undefined);
    try {
      await api.changePassword({ currentPassword: form.current, newPassword: form.next });
      setForm(EMPTY);
      setStatus({ tone: 'ok', text: 'Password changed. Other devices were signed out.' });
    } catch (err) {
      setStatus({ tone: 'error', text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Password">
      <form className="stack-form" onSubmit={(e) => void submit(e)}>
        {status && <Banner tone={status.tone}>{status.text}</Banner>}
        <Field label="Current password">
          {(id) => <TextInput id={id} type="password" autoComplete="current-password" required value={form.current} onChange={(e) => set('current')(e.target.value)} />}
        </Field>
        <Field label={`New password (${MIN_PASSWORD_LENGTH}+ characters)`}>
          {(id) => <TextInput id={id} type="password" autoComplete="new-password" required value={form.next} onChange={(e) => set('next')(e.target.value)} />}
        </Field>
        <Field label="Confirm new password">
          {(id) => <TextInput id={id} type="password" autoComplete="new-password" required value={form.confirm} onChange={(e) => set('confirm')(e.target.value)} />}
        </Field>
        <div>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? 'Changing…' : 'Change password'}
          </Button>
        </div>
      </form>
    </Card>
  );
}
