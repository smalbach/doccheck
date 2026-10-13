import { useState, type FormEvent } from 'react';
import { api } from '../../api/client';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Field } from '../../components/ui/Field';
import { TextInput } from '../../components/ui/TextInput';
import { useI18n } from '../../i18n/useI18n';
import { errorMessage } from '../../lib/errorMessage';
import { resetErrorKey } from '../../lib/resetErrorKey';
import { AuthLayout } from './AuthLayout';

/** Asks for a reset link by email. The answer never says whether the account exists. */
export function ForgotPasswordPage() {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string>();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await api.forgotPassword(email);
      setSent(true);
    } catch (err) {
      const key = resetErrorKey(err);
      setError(key ? t(key) : errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      title={t('auth.forgotTitle')}
      subtitle={t('auth.forgotSubtitle')}
      footer={<a href="#/login">{t('auth.backToSignIn')}</a>}
    >
      {sent ? (
        <Banner tone="ok">{t('auth.forgotSent')}</Banner>
      ) : (
        <form className="auth-form" onSubmit={(e) => void submit(e)} aria-busy={busy}>
          {error && <Banner tone="error">{error}</Banner>}
          <Field label={t('auth.email')}>
            {(id) => <TextInput id={id} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!!error} />}
          </Field>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? t('auth.sendingLink') : t('auth.sendLink')}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
