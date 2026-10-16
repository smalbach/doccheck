import { useState, type FormEvent } from 'react';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Checkbox } from '../../components/ui/Checkbox';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { DataTable } from '../../components/ui/DataTable';
import { Field } from '../../components/ui/Field';
import { Select } from '../../components/ui/Select';
import { TextInput } from '../../components/ui/TextInput';
import { useQuery } from '../../hooks/useQuery';
import { useI18n } from '../../i18n/useI18n';
import { errorMessage } from '../../lib/errorMessage';
import { integrationsApi, type Source, type SourceInput, type SourceKind } from './integrationsApi';
import type { Status } from './shared';

interface Draft {
  name: string;
  kind: SourceKind;
  path: string;
  host: string;
  port: string;
  username: string;
  bucket: string;
  prefix: string;
  region: string;
  endpoint: string;
  accessKeyId: string;
  secret: string;
  groupBy: 'folder' | 'filename';
  pattern: string;
  destination: 'none' | 'CA' | 'US';
  validate: boolean;
  pollSeconds: string;
  active: boolean;
}

const blank: Draft = {
  name: '', kind: 'local', path: '', host: '', port: '22', username: '', bucket: '', prefix: '', region: '', endpoint: '', accessKeyId: '', secret: '',
  groupBy: 'folder', pattern: '', destination: 'none', validate: true, pollSeconds: '300', active: true,
};

const str = (v: unknown) => (v === undefined || v === null ? '' : String(v));
const draftOf = (s: Source): Draft => ({
  ...blank,
  name: s.name,
  kind: s.kind,
  path: str(s.config.path),
  host: str(s.config.host),
  port: str(s.config.port ?? 22),
  username: str(s.config.username),
  bucket: str(s.config.bucket),
  prefix: str(s.config.prefix),
  region: str(s.config.region),
  endpoint: str(s.config.endpoint),
  accessKeyId: str(s.config.accessKeyId),
  groupBy: s.groupBy,
  pattern: s.pattern ?? '',
  destination: s.destination ?? 'none',
  validate: s.validate,
  pollSeconds: String(s.pollSeconds),
  active: s.active,
});

function inputOf(d: Draft): SourceInput {
  const config: Record<string, string | number> =
    d.kind === 'local'
      ? { path: d.path.trim() }
      : d.kind === 'sftp'
        ? { host: d.host.trim(), port: Number(d.port) || 22, username: d.username.trim(), path: d.path.trim() }
        : { bucket: d.bucket.trim(), prefix: d.prefix.trim(), region: d.region.trim(), endpoint: d.endpoint.trim(), accessKeyId: d.accessKeyId.trim() };
  return {
    name: d.name.trim(),
    kind: d.kind,
    config,
    ...(d.secret ? { secret: d.secret } : {}),
    groupBy: d.groupBy,
    pattern: d.groupBy === 'filename' && d.pattern.trim() ? d.pattern.trim() : null,
    destination: d.destination === 'none' ? null : d.destination,
    validate: d.validate,
    pollSeconds: Math.max(30, Number(d.pollSeconds) || 300),
    active: d.active,
  };
}

export function IngestionTab({ localRoot }: { localRoot?: string }) {
  const { t } = useI18n();
  const [nonce, setNonce] = useState(0);
  const { data: sources, error } = useQuery(`sources-${nonce}`, () => integrationsApi.sources());
  const [editing, setEditing] = useState<Source>();
  return (
    <>
      <SourceForm key={editing?.id ?? 'new'} source={editing} localRoot={localRoot} onSaved={() => { setEditing(undefined); setNonce((n) => n + 1); }} />
      <Card title={t('integrations.ingestion.list')}>
        {error && <Banner tone="error">{error}</Banner>}
        {sources && sources.length === 0 && <p className="muted">{t('integrations.ingestion.empty')}</p>}
        {sources?.map((s) => <SourceItem key={s.id} source={s} onEdit={() => setEditing(s)} onChange={() => setNonce((n) => n + 1)} />)}
      </Card>
    </>
  );
}

function SourceForm({ source, localRoot, onSaved }: { source?: Source; localRoot?: string; onSaved: () => void }) {
  const { t } = useI18n();
  const [d, setDraft] = useState<Draft>(source ? draftOf(source) : blank);
  const [status, setStatus] = useState<Status>();
  const [sample, setSample] = useState<{ path: string; reference: string | null }[]>();
  const [busy, setBusy] = useState(false);
  const set = (next: Partial<Draft>) => setDraft((x) => ({ ...x, ...next }));
  const field = (key: keyof Draft, label: string, opts: { grow?: boolean; type?: string; short?: boolean; placeholder?: string } = {}) => (
    <Field label={label} grow={opts.grow}>
      {(id) => (
        <TextInput
          id={id}
          type={opts.type ?? 'text'}
          className={opts.short ? 'input-short' : undefined}
          value={String(d[key])}
          placeholder={opts.placeholder}
          onChange={(e) => set({ [key]: e.target.value } as Partial<Draft>)}
          spellCheck={false}
          autoComplete={opts.type === 'password' ? 'new-password' : 'off'}
        />
      )}
    </Field>
  );
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setStatus(undefined);
    try {
      await work();
    } catch (err) {
      setStatus({ tone: 'error', text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };
  const test = () =>
    run(async () => {
      const r = await integrationsApi.testSource({ ...inputOf(d), ...(source ? { id: source.id } : {}) });
      if (r.ok) {
        setStatus({ tone: 'ok', text: t('integrations.ingestion.testOk', { count: r.pdfs }) });
        setSample(r.sample);
      } else setStatus({ tone: 'error', text: r.error });
    });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      if (source) await integrationsApi.updateSource(source.id, inputOf(d));
      else await integrationsApi.createSource(inputOf(d));
      onSaved();
    });
  };
  const secretLabel = d.kind === 's3' ? t('integrations.ingestion.secretKey') : t('integrations.ingestion.password');

  return (
    <Card title={source ? t('integrations.ingestion.edit', { name: source.name }) : t('integrations.ingestion.create')}>
      {!source && <p className="muted">{t('integrations.ingestion.intro')}</p>}
      <form className="stack-form" onSubmit={submit} noValidate>
        <div className="setting-row">
          {field('name', t('integrations.ingestion.name'), { grow: true })}
          <Field label={t('integrations.ingestion.kind')}>
            {(id) => <Select id={id} value={d.kind} options={(['local', 'sftp', 's3'] as const).map((k) => ({ value: k, label: t(`integrations.ingestion.kinds.${k}`) }))} onValueChange={(kind) => set({ kind })} />}
          </Field>
        </div>
        {d.kind === 'local' && field('path', t('integrations.ingestion.pathLocal', { root: localRoot ?? '' }), { placeholder: 'drop' })}
        {d.kind === 'sftp' && (
          <>
            <div className="setting-row">
              {field('host', t('integrations.ingestion.host'), { grow: true, placeholder: 'sftp.example.com' })}
              {field('port', t('integrations.ingestion.port'), { short: true })}
            </div>
            <div className="setting-row">
              {field('username', t('integrations.ingestion.username'), { grow: true })}
              {field('path', t('integrations.ingestion.path'), { grow: true, placeholder: '/outbound/docs' })}
            </div>
          </>
        )}
        {d.kind === 's3' && (
          <>
            <div className="setting-row">
              {field('bucket', t('integrations.ingestion.bucket'), { grow: true })}
              {field('prefix', t('integrations.ingestion.prefix'), { grow: true, placeholder: 'inbox/' })}
            </div>
            <div className="setting-row">
              {field('region', t('integrations.ingestion.region'), { grow: true, placeholder: 'us-east-1' })}
              {field('endpoint', t('integrations.ingestion.endpoint'), { grow: true, placeholder: 'https://…' })}
            </div>
            {field('accessKeyId', t('integrations.ingestion.accessKeyId'))}
          </>
        )}
        {d.kind !== 'local' && (
          <>
            {d.kind === 'sftp' ? (
              <Field label={secretLabel}>
                {(id) => (
                  <textarea id={id} className="input textarea-short" value={d.secret} placeholder={source?.hasSecret ? t('integrations.ingestion.secretSaved') : ''} onChange={(e) => set({ secret: e.target.value })} spellCheck={false} autoComplete="off" rows={2} />
                )}
              </Field>
            ) : (
              field('secret', secretLabel, { type: 'password', placeholder: source?.hasSecret ? t('integrations.ingestion.secretSaved') : '' })
            )}
            <p className="muted small">{t('integrations.ingestion.secretHelp')}</p>
          </>
        )}
        <Field label={t('integrations.ingestion.groupBy')}>
          {(id) => <Select id={id} value={d.groupBy} options={(['folder', 'filename'] as const).map((g) => ({ value: g, label: t(`integrations.ingestion.groupByOptions.${g}`) }))} onValueChange={(groupBy) => set({ groupBy })} />}
        </Field>
        {d.groupBy === 'filename' && field('pattern', t('integrations.ingestion.pattern'), { placeholder: '^([A-Za-z0-9-]+)_' })}
        <div className="setting-row">
          <Field label={t('integrations.ingestion.destination')}>
            {(id) => (
              <Select
                id={id}
                value={d.destination}
                options={[{ value: 'none' as const, label: t('integrations.ingestion.noDestination') }, { value: 'CA' as const, label: 'CA · CBSA' }, { value: 'US' as const, label: 'US · CBP' }]}
                onValueChange={(destination) => set({ destination })}
              />
            )}
          </Field>
          {field('pollSeconds', t('integrations.ingestion.poll'), { short: true })}
        </div>
        <Checkbox label={t('integrations.ingestion.validate')} checked={d.validate} onCheckedChange={(validate) => set({ validate })} />
        <Checkbox label={t('integrations.ingestion.activeLabel')} checked={d.active} onCheckedChange={(active) => set({ active })} />
        {status && <Banner tone={status.tone}>{status.text}</Banner>}
        {sample && sample.length > 0 && (
          <ul className="plain-list small">
            {sample.map((f) => (
              <li key={f.path}>
                <code className="mono">{f.reference ? t('integrations.ingestion.testRef', { path: f.path, reference: f.reference }) : t('integrations.ingestion.testNoRef', { path: f.path })}</code>
              </li>
            ))}
          </ul>
        )}
        <div className="integration-actions">
          <Button type="submit" variant="primary" disabled={busy || !d.name.trim()}>
            {t('integrations.ingestion.save')}
          </Button>
          <Button onClick={() => void test()} disabled={busy}>
            {t('integrations.ingestion.test')}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function SourceItem({ source, onEdit, onChange }: { source: Source; onEdit: () => void; onChange: () => void }) {
  const { t, formatDateTime } = useI18n();
  const [status, setStatus] = useState<Status>();
  const [busy, setBusy] = useState(false);
  const poll = async () => {
    setBusy(true);
    try {
      await integrationsApi.pollSource(source.id);
      setStatus({ tone: 'ok', text: t('integrations.ingestion.polled') });
      onChange();
    } catch (err) {
      setStatus({ tone: 'error', text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };
  const where = source.kind === 'local' ? String(source.config.path) : source.kind === 'sftp' ? `${source.config.username}@${source.config.host}:${source.config.path}` : `s3://${source.config.bucket}/${source.config.prefix ?? ''}`;
  return (
    <article className="integration-item">
      <div className="integration-item-head">
        <div className="integration-item-title">
          <strong>{source.name}</strong>
          <span className="muted small">
            {t(`integrations.ingestion.kinds.${source.kind}`)} · <code className="mono break">{where}</code> · {source.active ? t('integrations.active') : t('integrations.inactive')}
          </span>
          <span className="muted small">{source.lastPolledAt ? t('integrations.ingestion.lastPolled', { date: formatDateTime(source.lastPolledAt) }) : t('integrations.ingestion.notPolled')}</span>
        </div>
      </div>
      {source.lastError && <Banner tone="error">{source.lastError}</Banner>}
      {status && <Banner tone={status.tone}>{status.text}</Banner>}
      <div className="integration-actions">
        <Button size="sm" onClick={() => void poll()} disabled={busy}>
          {t('integrations.ingestion.pollNow')}
        </Button>
        <Button size="sm" onClick={onEdit}>
          {t('integrations.ingestion.editButton')}
        </Button>
        <ConfirmDialog
          trigger={<Button size="sm" variant="danger">{t('integrations.delete')}</Button>}
          title={t('integrations.ingestion.deleteTitle', { name: source.name })}
          description={t('integrations.ingestion.deleteText')}
          confirmLabel={t('integrations.delete')}
          onConfirm={() => void integrationsApi.deleteSource(source.id).then(onChange, (err: unknown) => setStatus({ tone: 'error', text: errorMessage(err) }))}
        />
      </div>
      {source.recent.length > 0 && (
        <DataTable
          compact
          caption={t('integrations.ingestion.recent')}
          rows={source.recent}
          rowKey={(f) => `${f.path}-${f.createdAt}`}
          columns={[
            { key: 'path', header: t('integrations.ingestion.path'), cell: (f) => <code className="mono break">{f.path}</code> },
            { key: 'ref', header: t('integrations.ingestion.groupBy'), secondary: true, cell: (f) => f.reference ?? '—' },
            {
              key: 'status',
              header: t('integrations.deliveries.status'),
              cell: (f) => (
                <>
                  {t(`integrations.ingestion.fileStatus.${f.status}`)}
                  {f.error && <span className="muted small"> · {f.error}</span>}
                </>
              ),
            },
            { key: 'shipment', header: <span className="visually-hidden">{t('integrations.ingestion.openShipment')}</span>, cell: (f) => (f.shipmentId ? <a href={`#/app/s/${f.shipmentId}`}>{t('integrations.ingestion.openShipment')}</a> : null) },
          ]}
        />
      )}
    </article>
  );
}
