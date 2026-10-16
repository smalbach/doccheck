import { useState, type FormEvent } from 'react';
import { teamApi } from '../../api/teamClient';
import { LoadingCard } from '../../components/layout/LoadingCard';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Field } from '../../components/ui/Field';
import { Tag } from '../../components/ui/Tag';
import { TextInput } from '../../components/ui/TextInput';
import { useQuery } from '../../hooks/useQuery';
import { useI18n } from '../../i18n/useI18n';
import { errorMessage } from '../../lib/errorMessage';

/** Two-factor sign-in with an authenticator app, and the recovery codes shown once. */
export function MfaCard() {
  const { t } = useI18n();
  const [version, setVersion] = useState(0);
  const { data: status, error: loadError } = useQuery(`mfa:${version}`, teamApi.mfa);
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string }>();
  const [codes, setCodes] = useState<string[]>();
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  if (!status) return <LoadingCard error={loadError} />;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const enable = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      setCodes((await teamApi.mfaEnable(code.trim())).recoveryCodes);
      setSetup(undefined);
      setCode('');
      setVersion((v) => v + 1);
    });
  };
  const disable = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await teamApi.mfaDisable(password, code.trim());
      setCode('');
      setPassword('');
      setCodes(undefined);
      setVersion((v) => v + 1);
    });
  };

  return (
    <Card title={t('team.mfa.title')} aside={status.enabled ? <Tag tone="ok">{t('team.mfa.on')}</Tag> : <Tag>{t('team.mfa.off')}</Tag>}>
      <p className="muted">{t('team.mfa.text')}</p>
      {error && <Banner tone="error">{error}</Banner>}
      {codes && (
        <div className="recovery-codes">
          <Banner tone="warning">{t('team.mfa.codesOnce')}</Banner>
          <ul className="mono" aria-label={t('team.mfa.codesLabel')}>
            {codes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <Button size="sm" onClick={() => void navigator.clipboard?.writeText(codes.join('\n'))}>
            {t('review.supplier.copy')}
          </Button>
        </div>
      )}
      {!status.enabled && !setup && (
        <Button variant="primary" disabled={busy} onClick={() => void run(async () => setSetup(await teamApi.mfaSetup()))}>
          {t('team.mfa.start')}
        </Button>
      )}
      {!status.enabled && setup && (
        <form className="stack-form" onSubmit={enable}>
          <p>{t('team.mfa.scan')}</p>
          <p>
            <a href={setup.otpauthUrl}>{t('team.mfa.openApp')}</a>
          </p>
          <p className="small">
            {t('team.mfa.key')} <code className="mono mfa-secret">{setup.secret.replace(/(.{4})/g, '$1 ').trim()}</code>
          </p>
          <Field label={t('team.mfa.code')}>{(id) => <TextInput id={id} autoComplete="one-time-code" inputMode="numeric" required value={code} onChange={(e) => setCode(e.target.value)} />}</Field>
          <div className="setting-row">
            <Button type="submit" variant="primary" disabled={busy}>
              {t('team.mfa.turnOn')}
            </Button>
            <Button onClick={() => setSetup(undefined)}>{t('common.cancel')}</Button>
          </div>
        </form>
      )}
      {status.enabled && (
        <form className="stack-form" onSubmit={disable}>
          <p className="muted small">{t('team.mfa.codesLeft', { count: status.recoveryCodesLeft })}</p>
          <Field label={t('team.mfa.codeOrRecovery')}>{(id) => <TextInput id={id} autoComplete="one-time-code" required value={code} onChange={(e) => setCode(e.target.value)} />}</Field>
          <Field label={t('account.currentPassword')}>{(id) => <TextInput id={id} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
          <div className="setting-row">
            <Button
              disabled={busy || !code.trim()}
              onClick={() =>
                void run(async () => {
                  setCodes((await teamApi.mfaRecoveryCodes(code.trim())).recoveryCodes);
                  setCode('');
                  setVersion((v) => v + 1);
                })
              }
            >
              {t('team.mfa.newCodes')}
            </Button>
            <Button type="submit" variant="danger" disabled={busy || !password}>
              {t('team.mfa.turnOff')}
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
