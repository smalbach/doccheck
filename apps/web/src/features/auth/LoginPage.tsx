import { useState, type FormEvent } from 'react';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Field } from '../../components/ui/Field';
import { TextInput } from '../../components/ui/TextInput';
import { useI18n } from '../../i18n/useI18n';
import { authErrorKey } from '../../lib/authErrorKey';
import { errorMessage } from '../../lib/errorMessage';
import { navigate } from '../../lib/navigate';
import { safeNext } from '../../lib/safeNext';
import { AuthLayout } from './AuthLayout';
import { useAuth } from './useAuth';

export function LoginPage({ next }: { next?: string }) {
  const { login } = useAuth();
  const { t } = useI18n();
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
      const key = authErrorKey(err);
      setError(key ? t(key) : errorMessage(err));
      setBusy(false);
    }
  };

  const registerHref = `#/register${next ? `?next=${encodeURIComponent(next)}` : ''}`;
  return (
    <AuthLayout
      title={t('auth.signIn')}
      subtitle={t('auth.signInSubtitle')}
      footer={
        <>
          {t('auth.noAccount')} <a href={registerHref}>{t('auth.createOne')}</a>
        </>
      }
    >
      <form className="auth-form" onSubmit={(e) => void submit(e)} aria-busy={busy}>
        {error && <Banner tone="error">{error}</Banner>}
        <Field label={t('auth.email')}>
          {(id) => <TextInput id={id} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!!error} />}
        </Field>
        <Field label={t('auth.password')}>
          {(id) => <TextInput id={id} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={!!error} />}
        </Field>
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? t('auth.signingIn') : t('auth.signIn')}
        </Button>
      </form>
    </AuthLayout>
  );
}
