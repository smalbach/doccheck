import { useState, type FormEvent } from 'react';
import { api } from '../../api/client';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Field } from '../../components/ui/Field';
import { TextInput } from '../../components/ui/TextInput';
import { useI18n } from '../../i18n/useI18n';
import { errorMessage } from '../../lib/errorMessage';
import { resetErrorKey } from '../../lib/resetErrorKey';
import { validateNewPassword } from '../../lib/validateNewPassword';
import { MIN_PASSWORD_LENGTH } from '../../lib/validateSignUp';
import { AuthLayout } from './AuthLayout';

/** Sets a new password from the link in a "forgot password" email. */
export function ResetPasswordPage({ token }: { token?: string }) {
  const { t } = useI18n();
  const [form, setForm] = useState({ password: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string>();
  const [linkInvalid, setLinkInvalid] = useState(!token);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!token) return;
    const problem = validateNewPassword(form.password, form.confirm);
    if (problem) return setError(t(problem, { min: MIN_PASSWORD_LENGTH }));
    setBusy(true);
    setError(undefined);
    try {
      await api.resetPasswordWithToken({ token, newPassword: form.password });
      setDone(true);
    } catch (err) {
      const key = resetErrorKey(err);
      if (key === 'auth.errors.resetLinkInvalid') setLinkInvalid(true);
      else setError(key ? t(key) : t('auth.errors.invalid', { message: errorMessage(err) }));
    } finally {
      setBusy(false);
    }
  };

  const body = done ? (
    <>
      <Banner tone="ok">{t('auth.resetDone')}</Banner>
      <p className="auth-next">
        <Button asChild variant="primary">
          <a href="#/login">{t('auth.signIn')}</a>
        </Button>
      </p>
    </>
  ) : linkInvalid ? (
    <>
      <Banner tone="error">{t('auth.errors.resetLinkInvalid')}</Banner>
      <p className="auth-next">
        <a href="#/forgot-password">{t('auth.requestNewLink')}</a>
      </p>
    </>
  ) : (
    <form className="auth-form" onSubmit={(e) => void submit(e)} aria-busy={busy}>
      {error && <Banner tone="error">{error}</Banner>}
      <Field label={t('auth.newPasswordHint', { min: MIN_PASSWORD_LENGTH })}>
        {(id) => (
          <TextInput
            id={id}
            type="password"
            autoComplete="new-password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            value={form.password}
            onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
            aria-invalid={!!error}
          />
        )}
      </Field>
      <Field label={t('auth.confirmPassword')}>
        {(id) => (
          <TextInput id={id} type="password" autoComplete="new-password" required value={form.confirm} onChange={(e) => setForm((f) => ({ ...f, confirm: e.target.value }))} aria-invalid={!!error} />
        )}
      </Field>
      <Button type="submit" variant="primary" disabled={busy}>
        {busy ? t('auth.savingPassword') : t('auth.savePassword')}
      </Button>
    </form>
  );

  return (
    <AuthLayout title={t('auth.resetTitle')} subtitle={t('auth.resetSubtitle')} footer={<a href="#/login">{t('auth.backToSignIn')}</a>}>
      {body}
    </AuthLayout>
  );
}
