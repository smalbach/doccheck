import { useState, type FormEvent } from 'react';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Field } from '../../components/ui/Field';
import { TextInput } from '../../components/ui/TextInput';
import { errorMessage } from '../../lib/errorMessage';
import { navigate } from '../../lib/navigate';
import { safeNext } from '../../lib/safeNext';
import { AuthLayout } from './AuthLayout';
import { useAuth } from './useAuth';

export function LoginPage({ next }: { next?: string }) {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await login(email, password);
      navigate(safeNext(next));
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  const registerHref = `#/register${next ? `?next=${encodeURIComponent(next)}` : ''}`;
  return (
    <AuthLayout
      title="Sign in"
      subtitle="Welcome back. Your shipments are waiting."
      footer={
        <>
          No account yet? <a href={registerHref}>Create one</a>
        </>
      }
    >
      <form className="auth-form" onSubmit={(e) => void submit(e)}>
        {error && <Banner tone="error">{error}</Banner>}
        <Field label="Email">{(id) => <TextInput id={id} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
        <Field label="Password">
          {(id) => <TextInput id={id} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />}
        </Field>
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </AuthLayout>
  );
}
