import { useState } from 'react';
import { teamApi } from '../../api/teamClient';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { useQuery } from '../../hooks/useQuery';
import { useI18n } from '../../i18n/useI18n';
import { errorMessage } from '../../lib/errorMessage';
import { AuthLayout } from '../auth/AuthLayout';
import { useAuth } from '../auth/useAuth';

/** An emailed invitation: sign in (or sign up) with the invited address, then join. */
export function InvitePage({ token }: { token?: string }) {
  const { t } = useI18n();
  const { user } = useAuth();
  const { data: invite, error } = useQuery(`invite:${token}`, () => (token ? teamApi.peekInvite(token) : Promise.reject(new Error(t('team.invite.invalid')))));
  const [busy, setBusy] = useState(false);
  const [acceptError, setAcceptError] = useState<string>();
  const next = encodeURIComponent(`/invite?token=${token ?? ''}`);

  const accept = async () => {
    if (!token) return;
    setBusy(true);
    setAcceptError(undefined);
    try {
      await teamApi.acceptInvite(token);
      window.location.hash = '#/app';
      window.location.reload();
    } catch (err) {
      setAcceptError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      title={invite ? t('team.invite.title', { org: invite.orgName }) : t('team.invite.heading')}
      subtitle={invite ? t('team.invite.subtitle', { role: t(`team.roles.${invite.role}`), domain: invite.emailDomain }) : ''}
      footer={<a href="#/">{t('team.invite.home')}</a>}
    >
      {error && <Banner tone="error">{t('team.invite.invalid')}</Banner>}
      {acceptError && <Banner tone="error">{acceptError}</Banner>}
      {invite &&
        (user ? (
          <div className="auth-form">
            <p>{t('team.invite.signedInAs', { email: user.email })}</p>
            <Button variant="primary" disabled={busy} onClick={() => void accept()}>
              {busy ? t('team.invite.joining') : t('team.invite.accept')}
            </Button>
          </div>
        ) : (
          <div className="auth-form">
            <p>{t('team.invite.signInFirst')}</p>
            <Button asChild variant="primary">
              <a href={`#/login?next=${next}`}>{t('auth.signIn')}</a>
            </Button>
            <Button asChild>
              <a href={`#/register?next=${next}`}>{t('auth.createOne')}</a>
            </Button>
          </div>
        ))}
    </AuthLayout>
  );
}
