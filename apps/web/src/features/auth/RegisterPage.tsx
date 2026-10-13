import { useState, type FormEvent } from 'react';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Field } from '../../components/ui/Field';
import { TextInput } from '../../components/ui/TextInput';
import { errorMessage } from '../../lib/errorMessage';
import { navigate } from '../../lib/navigate';
import { safeNext } from '../../lib/safeNext';
import { MIN_PASSWORD_LENGTH, validateSignUp } from '../../lib/validateSignUp';
import { AuthLayout } from './AuthLayout';
import { useAuth } from './useAuth';

export function RegisterPage({ next }: { next?: string }) {
  const { register } = useAuth();
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const set = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const problem = validateSignUp(form);
    if (problem) return setError(problem);
    setBusy(true);
    setError(undefined);
    try {
      await register({ name: form.name.trim(), email: form.email, password: form.password });
      navigate(safeNext(next));
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  const loginHref = `#/login${next ? `?next=${encodeURIComponent(next)}` : ''}`;
  return (
    <AuthLayout
      title="Create your account"
      subtitle="Check freight documents before they reach customs. Free, and your PDFs stay on this server."
      footer={
        <>
          Already have an account? <a href={loginHref}>Sign in</a>
        </>
      }
    >
      <form className="auth-form" onSubmit={(e) => void submit(e)}>
        {error && <Banner tone="error">{error}</Banner>}
        <Field label="Name">{(id) => <TextInput id={id} autoComplete="name" required value={form.name} onChange={(e) => set('name')(e.target.value)} />}</Field>
        <Field label="Email">{(id) => <TextInput id={id} type="email" autoComplete="email" required value={form.email} onChange={(e) => set('email')(e.target.value)} />}</Field>
        <Field label={`Password (${MIN_PASSWORD_LENGTH}+ characters)`}>
          {(id) => <TextInput id={id} type="password" autoComplete="new-password" required minLength={MIN_PASSWORD_LENGTH} value={form.password} onChange={(e) => set('password')(e.target.value)} />}
        </Field>
        <Field label="Confirm password">
          {(id) => <TextInput id={id} type="password" autoComplete="new-password" required value={form.confirm} onChange={(e) => set('confirm')(e.target.value)} />}
        </Field>
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? 'Creating account…' : 'Create account'}
        </Button>
      </form>
    </AuthLayout>
  );
}
