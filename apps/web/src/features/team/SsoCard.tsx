import { useEffect, useState, type FormEvent } from 'react';
import { teamApi } from '../../api/teamClient';
import type { SsoInput } from '../../api/teamTypes';
import { LoadingCard } from '../../components/layout/LoadingCard';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Field } from '../../components/ui/Field';
import { Select } from '../../components/ui/Select';
import { Switch } from '../../components/ui/Switch';
import { TextInput } from '../../components/ui/TextInput';
import { useQuery } from '../../hooks/useQuery';
import { useI18n } from '../../i18n/useI18n';
import { errorMessage } from '../../lib/errorMessage';

type SsoRole = SsoInput['defaultRole'];
const SSO_ROLES: readonly SsoRole[] = ['admin', 'analyst', 'reviewer', 'viewer'];

/** OpenID Connect sign-in for the organization (any provider: issuer, client id and secret). */
export function SsoCard() {
  const { t } = useI18n();
  const { data, error: loadError } = useQuery('sso', teamApi.sso);
  const [form, setForm] = useState({ enabled: false, issuer: '', clientId: '', clientSecret: '', domains: '', defaultRole: 'viewer' as SsoRole });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  useEffect(() => {
    if (data) setForm((f) => ({ ...f, enabled: data.enabled, issuer: data.issuer ?? '', clientId: data.clientId ?? '', domains: (data.emailDomains ?? []).join(', '), defaultRole: data.defaultRole ?? 'viewer' }));
  }, [data]);
  if (!data) return <LoadingCard error={loadError} />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      await teamApi.saveSso({
        enabled: form.enabled,
        issuer: form.issuer.trim(),
        clientId: form.clientId.trim(),
        ...(form.clientSecret ? { clientSecret: form.clientSecret } : {}),
        emailDomains: form.domains.split(/[\s,]+/).filter(Boolean),
        defaultRole: form.defaultRole,
      });
      setForm({ ...form, clientSecret: '' });
      setNotice(t('team.sso.saved'));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title={t('team.sso.title')}>
      <p className="muted">{t('team.sso.text')}</p>
      {data.redirectUri && (
        <p className="small">
          {t('team.sso.redirect')} <code className="mono">{data.redirectUri}</code>
        </p>
      )}
      <form className="stack-form" onSubmit={(e) => void submit(e)}>
        {(error || loadError) && <Banner tone="error">{error ?? loadError}</Banner>}
        {notice && <Banner tone="ok">{notice}</Banner>}
        <Switch label={t('team.sso.enabled')} checked={form.enabled} onCheckedChange={(enabled) => setForm({ ...form, enabled })} />
        <Field label={t('team.sso.issuer')}>{(id) => <TextInput id={id} type="url" required placeholder="https://login.example.com/realms/acme" value={form.issuer} onChange={(e) => setForm({ ...form, issuer: e.target.value })} />}</Field>
        <Field label={t('team.sso.clientId')}>{(id) => <TextInput id={id} required autoComplete="off" value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })} />}</Field>
        <Field label={data.hasSecret ? t('team.sso.secretKeep') : t('team.sso.secret')}>
          {(id) => <TextInput id={id} type="password" autoComplete="new-password" required={!data.hasSecret} value={form.clientSecret} onChange={(e) => setForm({ ...form, clientSecret: e.target.value })} />}
        </Field>
        <Field label={t('team.sso.domains')}>{(id) => <TextInput id={id} placeholder="example.com" value={form.domains} onChange={(e) => setForm({ ...form, domains: e.target.value })} />}</Field>
        <Field label={t('team.sso.defaultRole')}>
          {(id) => <Select<SsoRole> id={id} value={form.defaultRole} options={SSO_ROLES.map((r) => ({ value: r, label: t(`team.roles.${r}`) }))} onValueChange={(defaultRole) => setForm({ ...form, defaultRole })} />}
        </Field>
        <p className="muted small">{t('team.sso.help')}</p>
        <div className="setting-row">
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? t('common.saving') : t('common.save')}
          </Button>
        </div>
      </form>
    </Card>
  );
}
