import { useState, type FormEvent } from 'react';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Checkbox } from '../../components/ui/Checkbox';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { DataTable } from '../../components/ui/DataTable';
import { Field } from '../../components/ui/Field';
import { Tag } from '../../components/ui/Tag';
import { TextInput } from '../../components/ui/TextInput';
import { useQuery } from '../../hooks/useQuery';
import { useI18n } from '../../i18n/useI18n';
import { errorMessage } from '../../lib/errorMessage';
import { integrationsApi, type ApiScope } from './integrationsApi';
import { SecretReveal, type Status } from './shared';

export function ApiKeysTab() {
  const { t, formatDateTime } = useI18n();
  const [nonce, setNonce] = useState(0);
  const { data: keys, error } = useQuery(`api-keys-${nonce}`, () => integrationsApi.apiKeys());
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<ApiScope[]>(['read']);
  const [rateLimit, setRateLimit] = useState('120');
  const [created, setCreated] = useState<string>();
  const [status, setStatus] = useState<Status>();
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setStatus(undefined);
    try {
      const key = await integrationsApi.createApiKey({ name: name.trim(), scopes, rateLimit: Number(rateLimit) || undefined });
      setCreated(key.key);
      setName('');
      setNonce((n) => n + 1);
    } catch (err) {
      setStatus({ tone: 'error', text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };
  const revoke = (id: string) =>
    integrationsApi.revokeApiKey(id).then(
      () => setNonce((n) => n + 1),
      (err: unknown) => setStatus({ tone: 'error', text: errorMessage(err) }),
    );
  const toggle = (scope: ApiScope, on: boolean) => setScopes((s) => (on ? [...new Set([...s, scope])] : s.filter((x) => x !== scope)));

  return (
    <>
      <Card title={t('integrations.keys.create')}>
        <p className="muted">{t('integrations.keys.intro')}</p>
        <p className="small">
          <a href="#/app/api-docs">{t('integrations.keys.docsLink')}</a> · <a href="/api/v1/openapi.json">{t('integrations.keys.specLink')}</a>
        </p>
        <form className="stack-form" onSubmit={(e) => void submit(e)} noValidate>
          <Field label={t('integrations.keys.name')}>
            {(id) => <TextInput id={id} value={name} placeholder={t('integrations.keys.namePlaceholder')} maxLength={100} onChange={(e) => setName(e.target.value)} required />}
          </Field>
          <fieldset className="fieldset">
            <legend className="field-label">{t('integrations.keys.scopes')}</legend>
            <Checkbox label={t('integrations.keys.read')} checked={scopes.includes('read')} onCheckedChange={(on) => toggle('read', on)} />
            <Checkbox label={t('integrations.keys.write')} checked={scopes.includes('write')} onCheckedChange={(on) => toggle('write', on)} />
          </fieldset>
          <Field label={t('integrations.keys.rateLimit')}>
            {(id) => <TextInput id={id} className="input-short" inputMode="numeric" value={rateLimit} onChange={(e) => setRateLimit(e.target.value.replace(/\D/g, ''))} />}
          </Field>
          {status && <Banner tone={status.tone}>{status.text}</Banner>}
          {created && <SecretReveal label={t('integrations.keys.created')} value={created} />}
          <div>
            <Button type="submit" variant="primary" disabled={busy || !name.trim() || scopes.length === 0}>
              {t('integrations.keys.submit')}
            </Button>
          </div>
        </form>
        <p className="muted small">{t('integrations.keys.usage')}</p>
      </Card>

      <Card title={t('integrations.keys.list')}>
        {error && <Banner tone="error">{error}</Banner>}
        {keys && keys.length === 0 && <p className="muted">{t('integrations.keys.empty')}</p>}
        {keys && keys.length > 0 && (
          <DataTable
            caption={t('integrations.keys.list')}
            rows={keys}
            rowKey={(k) => k.id}
            columns={[
              { key: 'name', header: t('integrations.keys.name'), cell: (k) => k.name },
              { key: 'prefix', header: t('integrations.keys.prefix'), cell: (k) => <code className="mono">{k.prefix}_…</code> },
              { key: 'scopes', header: t('integrations.keys.scopes'), cell: (k) => <span className="tag-row">{k.scopes.map((s) => <Tag key={s}>{s}</Tag>)}</span> },
              { key: 'rate', header: t('integrations.keys.rateLimit'), numeric: true, secondary: true, cell: (k) => k.rateLimit },
              { key: 'used', header: t('integrations.keys.lastUsed'), secondary: true, cell: (k) => (k.lastUsedAt ? formatDateTime(k.lastUsedAt) : t('integrations.never')) },
              { key: 'created', header: t('integrations.keys.createdAt'), secondary: true, cell: (k) => formatDateTime(k.createdAt) },
              {
                key: 'status',
                header: t('integrations.keys.status'),
                cell: (k) =>
                  k.revokedAt ? (
                    <span className="muted small">{t('integrations.keys.revoked', { date: formatDateTime(k.revokedAt) })}</span>
                  ) : (
                    <ConfirmDialog
                      trigger={<Button size="sm" variant="danger">{t('integrations.keys.revoke')}</Button>}
                      title={t('integrations.keys.revokeTitle', { name: k.name })}
                      description={t('integrations.keys.revokeText')}
                      confirmLabel={t('integrations.keys.revoke')}
                      onConfirm={() => void revoke(k.id)}
                    />
                  ),
              },
            ]}
          />
        )}
      </Card>
    </>
  );
}
