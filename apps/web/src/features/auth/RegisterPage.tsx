import { useState, type FormEvent } from 'react';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Field } from '../../components/ui/Field';
import { TextInput } from '../../components/ui/TextInput';
import { useRegistrationOpen } from '../../hooks/useRegistrationOpen';
import { useI18n } from '../../i18n/useI18n';
import { ApiError } from '../../api/ApiError';
import { authErrorKey } from '../../lib/authErrorKey';
import { errorMessage } from '../../lib/errorMessage';
import { navigate } from '../../lib/navigate';
import { safeNext } from '../../lib/safeNext';
import { MIN_PASSWORD_LENGTH, validateSignUp } from '../../lib/validateSignUp';
import { AuthLayout } from './AuthLayout';
import { useAuth } from './useAuth';

export function RegisterPage({ next }: { next?: string }) {
  const { register } = useAuth();
  const { t } = useI18n();
  const registrationOpen = useRegistrationOpen();
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const set = (key: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const problem = validateSignUp(form);
    if (problem) return setError(t(problem, { min: MIN_PASSWORD_LENGTH }));
    setBusy(true);
    setError(undefined);
    try {
      await register({ name: form.name.trim(), email: form.email, password: form.password });
      navigate(safeNext(next));
    } catch (err) {
      const key = err instanceof ApiError && err.status === 403 ? 'auth.errors.registrationClosed' : authErrorKey(err);
      setError(key ? t(key) : t('auth.errors.invalid', { message: errorMessage(err) }));
      setBusy(false);
    }
  };

  const loginHref = `#/login${next ? `?next=${encodeURIComponent(next)}` : ''}`;
  return (
    <AuthLayout
      title={t('auth.registerTitle')}
      subtitle={t('auth.registerSubtitle')}
      footer={
        <>
          {t('auth.haveAccount')} <a href={loginHref}>{t('auth.signIn')}</a>
        </>
      }
    >
      {registrationOpen === false && <Banner tone="info">{t('auth.errors.registrationClosed')}</Banner>}
      <form className="auth-form" onSubmit={(e) => void submit(e)} aria-busy={busy}>
        {error && <Banner tone="error">{error}</Banner>}
        <Field label={t('auth.name')}>{(id) => <TextInput id={id} autoComplete="name" required value={form.name} onChange={(e) => set('name')(e.target.value)} />}</Field>
        <Field label={t('auth.email')}>{(id) => <TextInput id={id} type="email" autoComplete="email" required value={form.email} onChange={(e) => set('email')(e.target.value)} />}</Field>
        <Field label={t('auth.passwordHint', { min: MIN_PASSWORD_LENGTH })}>
          {(id) => <TextInput id={id} type="password" autoComplete="new-password" required minLength={MIN_PASSWORD_LENGTH} value={form.password} onChange={(e) => set('password')(e.target.value)} />}
        </Field>
        <Field label={t('auth.confirmPassword')}>
          {(id) => <TextInput id={id} type="password" autoComplete="new-password" required value={form.confirm} onChange={(e) => set('confirm')(e.target.value)} />}
        </Field>
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? t('auth.creatingAccount') : t('auth.createAccount')}
        </Button>
      </form>
    </AuthLayout>
  );
}
