import { useState, type FormEvent } from 'react';
import { teamApi } from '../../api/teamClient';
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

export function LoginPage({ next, ssoError }: { next?: string; ssoError?: string }) {
  const { login, completeMfa } = useAuth();
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  // After a right password on an account with two-factor sign-in.
  const [ticket, setTicket] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(ssoError ? t('team.sso.failed', { message: ssoError }) : undefined);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      if (ticket) await completeMfa(ticket, code.trim());
      else {
        const { mfaTicket } = await login(email, password);
        if (mfaTicket) {
          setTicket(mfaTicket);
          setBusy(false);
          return;
        }
      }
      navigate(safeNext(next));
    } catch (err) {
      const key = ticket ? undefined : authErrorKey(err);
      setError(ticket ? t('team.mfa.wrongCode') : key ? t(key) : errorMessage(err));
      setBusy(false);
    }
  };

  /** The organization that signs this email's domain in with SSO, if any: its provider opens. */
  const sso = async () => {
    setError(undefined);
    if (!email) return setError(t('team.sso.enterEmail'));
    try {
      const found = await teamApi.ssoDiscover(email);
      if (!found.sso || !found.orgId) return setError(t('team.sso.none'));
      window.location.assign(`/auth/sso/${found.orgId}/start?login_hint=${encodeURIComponent(email)}`);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const registerHref = `#/register${next ? `?next=${encodeURIComponent(next)}` : ''}`;
  return (
    <AuthLayout
      title={ticket ? t('team.mfa.loginTitle') : t('auth.signIn')}
      subtitle={ticket ? t('team.mfa.loginText') : t('auth.signInSubtitle')}
      footer={
        <>
          {t('auth.noAccount')} <a href={registerHref}>{t('auth.createOne')}</a>
        </>
      }
    >
      <form className="auth-form" onSubmit={(e) => void submit(e)} aria-busy={busy}>
        {error && <Banner tone="error">{error}</Banner>}
        {ticket ? (
          <Field label={t('team.mfa.code')}>
            {(id) => <TextInput id={id} autoComplete="one-time-code" inputMode="text" required autoFocus value={code} onChange={(e) => setCode(e.target.value)} aria-invalid={!!error} />}
          </Field>
        ) : (
          <>
            <Field label={t('auth.email')}>
              {(id) => <TextInput id={id} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!!error} />}
            </Field>
            <Field label={t('auth.password')}>
              {(id) => <TextInput id={id} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={!!error} />}
            </Field>
            <a className="auth-forgot" href="#/forgot-password">
              {t('auth.forgotLink')}
            </a>
          </>
        )}
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? t('auth.signingIn') : ticket ? t('team.mfa.verify') : t('auth.signIn')}
        </Button>
        {!ticket && (
          <Button onClick={() => void sso()} disabled={busy}>
            {t('team.sso.signIn')}
          </Button>
        )}
        {ticket && <p className="muted small">{t('team.mfa.recoveryHint')}</p>}
      </form>
    </AuthLayout>
  );
}
