import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../../../api/client';
import type { AiCredentialName, AiProvidersInput, AiProvidersSettings, AiTestTarget, EmbedProviderKind, LlmProviderKind } from '../../../api/types';
import { LoadingCard } from '../../../components/layout/LoadingCard';
import { Banner } from '../../../components/ui/Banner';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { Checkbox } from '../../../components/ui/Checkbox';
import { Field } from '../../../components/ui/Field';
import { Select } from '../../../components/ui/Select';
import { Switch } from '../../../components/ui/Switch';
import { TextInput } from '../../../components/ui/TextInput';
import { useI18n } from '../../../i18n/useI18n';
import { errorMessage } from '../../../lib/errorMessage';

const LLM_PROVIDERS: LlmProviderKind[] = ['ollama', 'openai', 'azure-openai', 'anthropic', 'gemini'];
const EMBED_PROVIDERS: EmbedProviderKind[] = ['ollama', 'openai', 'azure-openai', 'gemini'];
const CREDENTIALS: AiCredentialName[] = ['openai', 'azureOpenai', 'anthropic', 'gemini', 'googleVision', 'awsTextract', 'azureDi'];
/** The OCR test each OCR credential enables. */
const OCR_TEST: Partial<Record<AiCredentialName, AiTestTarget>> = { googleVision: 'google-vision', awsTextract: 'aws-textract', azureDi: 'azure-di' };

/** Every field of a credential as text; the key fields start empty (a saved key is kept). */
type CredentialDraft = { baseUrl: string; endpoint: string; apiVersion: string; region: string; accessKeyId: string; key: string };
interface Draft {
  localOnly: boolean;
  llm: { provider: LlmProviderKind; model: string };
  embeddings: { provider: EmbedProviderKind; model: string; dimensions: string };
  on: Record<AiCredentialName, boolean>;
  creds: Record<AiCredentialName, CredentialDraft>;
}

const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback);

function draftOf(s: AiProvidersSettings): Draft {
  const c = s.config;
  const creds = {} as Draft['creds'];
  const on = {} as Draft['on'];
  for (const name of CREDENTIALS) {
    const v = (c.credentials[name] ?? {}) as Record<string, unknown>;
    on[name] = !!c.credentials[name];
    creds[name] = {
      baseUrl: str(v.baseUrl, 'https://api.openai.com/v1'),
      endpoint: str(v.endpoint),
      apiVersion: str(v.apiVersion, '2024-10-21'),
      region: str(v.region, 'us-east-1'),
      accessKeyId: str(v.accessKeyId),
      key: '',
    };
  }
  return {
    localOnly: c.localOnly,
    llm: { provider: c.llm.provider, model: c.llm.model ?? '' },
    embeddings: { provider: c.embeddings.provider, model: c.embeddings.model ?? '', dimensions: c.embeddings.dimensions ? String(c.embeddings.dimensions) : '' },
    on,
    creds,
  };
}

function inputOf(d: Draft): AiProvidersInput {
  const key = (name: AiCredentialName) => (d.creds[name].key ? { apiKey: d.creds[name].key } : {});
  const c = d.creds;
  const pick = <T,>(name: AiCredentialName, value: T): T | null => (d.on[name] ? value : null);
  return {
    localOnly: d.localOnly,
    llm: { provider: d.llm.provider, model: d.llm.provider === 'ollama' ? null : d.llm.model.trim() || null },
    embeddings: { provider: d.embeddings.provider, model: d.embeddings.model.trim() || null, dimensions: Number(d.embeddings.dimensions) || null },
    credentials: {
      openai: pick('openai', { baseUrl: c.openai.baseUrl.trim(), ...key('openai') }),
      azureOpenai: pick('azureOpenai', { endpoint: c.azureOpenai.endpoint.trim(), apiVersion: c.azureOpenai.apiVersion.trim(), ...key('azureOpenai') }),
      anthropic: pick('anthropic', key('anthropic')),
      gemini: pick('gemini', key('gemini')),
      googleVision: pick('googleVision', key('googleVision')),
      awsTextract: pick('awsTextract', { region: c.awsTextract.region.trim(), accessKeyId: c.awsTextract.accessKeyId.trim(), ...(c.awsTextract.key ? { secretAccessKey: c.awsTextract.key } : {}) }),
      azureDi: pick('azureDi', { endpoint: c.azureDi.endpoint.trim(), ...key('azureDi') }),
    },
  };
}

/**
 * The model, embedding and OCR services and their keys. Local only (the default) keeps documents on
 * this server or your network; tests run on the values in the form, before saving.
 */
export function AiProvidersCard() {
  const { t, formatDateTime } = useI18n();
  const [settings, setSettings] = useState<AiProvidersSettings>();
  const [draft, setDraft] = useState<Draft>();
  const [busy, setBusy] = useState<string>();
  const [status, setStatus] = useState<{ tone: 'ok' | 'error'; text: string }>();
  const [error, setError] = useState<string>();

  const load = (s: AiProvidersSettings) => {
    setSettings(s);
    setDraft(draftOf(s));
  };
  useEffect(() => {
    api.adminAi().then(load, (e: unknown) => setError(errorMessage(e)));
  }, []);
  // While the indexes are rebuilt, look at the progress now and then.
  const rebuilding = !!settings?.reindex?.running;
  useEffect(() => {
    if (!rebuilding) return;
    const timer = setInterval(() => api.adminAi().then((s) => setSettings((cur) => (cur ? { ...cur, reindex: s.reindex, indexes: s.indexes } : s)), () => undefined), 3000);
    return () => clearInterval(timer);
  }, [rebuilding]);
  if (!settings || !draft) return <LoadingCard error={error} />;
  const editable = settings.editable;
  const disabled = !editable || !!busy;

  const patch = (next: Partial<Draft>) => setDraft((d) => d && { ...d, ...next });
  const setCred = (name: AiCredentialName, next: Partial<CredentialDraft>) => setDraft((d) => d && { ...d, creds: { ...d.creds, [name]: { ...d.creds[name], ...next } } });
  const run = async (kind: string, work: () => Promise<void>) => {
    setBusy(kind);
    setStatus(undefined);
    try {
      await work();
    } catch (err) {
      setStatus({ tone: 'error', text: errorMessage(err) });
    } finally {
      setBusy(undefined);
    }
  };
  const needsModel = draft.llm.provider !== 'ollama' && !draft.llm.model.trim();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (needsModel) return setStatus({ tone: 'error', text: t('aiProviders.badModel') });
    void run('save', async () => {
      load(await api.saveAdminAi(inputOf(draft)));
      setStatus({ tone: 'ok', text: t('aiProviders.saved') });
    });
  };
  const test = (target: AiTestTarget) =>
    run(target, async () => {
      const r = await api.testAdminAi(target, inputOf(draft));
      setStatus({ tone: r.ok ? 'ok' : 'error', text: r.detail });
    });
  const reindex = () =>
    run('reindex', async () => {
      const job = await api.reindexAdminAi();
      setSettings((cur) => cur && { ...cur, reindex: job });
    });

  const text = (name: AiCredentialName, field: keyof CredentialDraft, label: string, opts: { mono?: boolean; hint?: string } = {}) => (
    <Field label={label} grow>
      {(id) => (
        <TextInput id={id} value={draft.creds[name][field]} onChange={(e) => setCred(name, { [field]: e.target.value })} disabled={disabled} autoComplete="off" spellCheck={false} className={opts.mono ? 'mono' : undefined} />
      )}
    </Field>
  );
  const secret = (name: AiCredentialName, label: string) => {
    const saved = settings.config.credentials[name]?.hasKey;
    return (
      <Field label={label} grow>
        {(id) => (
          <TextInput
            id={id}
            type="password"
            value={draft.creds[name].key}
            placeholder={saved ? t('aiProviders.credentials.keySaved') : ''}
            onChange={(e) => setCred(name, { key: e.target.value })}
            disabled={disabled}
            autoComplete="new-password"
          />
        )}
      </Field>
    );
  };
  const fields = (name: AiCredentialName) => {
    const k = 'aiProviders.credentials';
    switch (name) {
      case 'openai':
        return (
          <>
            {text(name, 'baseUrl', t(`${k}.baseUrl`), { mono: true })}
            <p className="muted small">{t(`${k}.baseUrlHint`)}</p>
            {secret(name, t(`${k}.apiKey`))}
          </>
        );
      case 'azureOpenai':
        return (
          <div className="setting-row">
            {text(name, 'endpoint', t(`${k}.endpoint`), { mono: true })}
            {text(name, 'apiVersion', t(`${k}.apiVersion`))}
            {secret(name, t(`${k}.apiKey`))}
          </div>
        );
      case 'awsTextract':
        return (
          <div className="setting-row">
            {text(name, 'region', t(`${k}.region`))}
            {text(name, 'accessKeyId', t(`${k}.accessKeyId`), { mono: true })}
            {secret(name, t(`${k}.secretAccessKey`))}
          </div>
        );
      case 'azureDi':
        return (
          <div className="setting-row">
            {text(name, 'endpoint', t(`${k}.endpoint`), { mono: true })}
            {secret(name, t(`${k}.apiKey`))}
          </div>
        );
      default:
        return secret(name, t(`${k}.apiKey`));
    }
  };

  const idx = settings.indexes;
  const job = settings.reindex;
  const state = (ok: boolean) => t(ok ? 'aiProviders.indexes.ready' : 'aiProviders.indexes.missing');

  return (
    <Card title={t('aiProviders.title')} aside={<span className="muted small">{t(`aiProviders.source.${settings.source}`)}</span>}>
      <p className="muted">{t('aiProviders.text')}</p>
      <p className="small">{t('aiProviders.active', { llm: settings.active.llm, embeddings: settings.active.embeddings ?? t('aiProviders.none'), ocr: settings.active.ocr })}</p>
      <form className="stack-form" onSubmit={submit} noValidate>
        <Switch label={t('aiProviders.localOnly')} checked={draft.localOnly} onCheckedChange={(localOnly) => patch({ localOnly })} disabled={disabled} />
        <p className="muted small">{t('aiProviders.localOnlyHint')}</p>
        {!draft.localOnly && <Banner tone="warning">{t('aiProviders.outsideWarning')}</Banner>}

        <fieldset className="fieldset">
          <legend className="field-label">{t('aiProviders.llm.legend')}</legend>
          <div className="setting-row">
            <Field label={t('aiProviders.llm.provider')}>
              {(id) => (
                <Select id={id} value={draft.llm.provider} options={LLM_PROVIDERS.map((p) => ({ value: p, label: t(`aiProviders.providers.${p}`) }))} onValueChange={(provider) => patch({ llm: { ...draft.llm, provider } })} disabled={disabled} />
              )}
            </Field>
            {draft.llm.provider !== 'ollama' && (
              <Field label={t('aiProviders.llm.model')} grow>
                {(id) => <TextInput id={id} value={draft.llm.model} onChange={(e) => patch({ llm: { ...draft.llm, model: e.target.value } })} disabled={disabled} spellCheck={false} className="mono" />}
              </Field>
            )}
          </div>
          <p className="muted small">{t(draft.llm.provider === 'ollama' ? 'aiProviders.llm.ollamaHint' : 'aiProviders.llm.modelHint')}</p>
        </fieldset>

        <fieldset className="fieldset">
          <legend className="field-label">{t('aiProviders.embeddings.legend')}</legend>
          <div className="setting-row">
            <Field label={t('aiProviders.embeddings.provider')}>
              {(id) => (
                <Select
                  id={id}
                  value={draft.embeddings.provider}
                  options={EMBED_PROVIDERS.map((p) => ({ value: p, label: t(`aiProviders.providers.${p}`) }))}
                  onValueChange={(provider) => patch({ embeddings: { ...draft.embeddings, provider } })}
                  disabled={disabled}
                />
              )}
            </Field>
            <Field label={t('aiProviders.embeddings.model')} grow>
              {(id) => <TextInput id={id} value={draft.embeddings.model} onChange={(e) => patch({ embeddings: { ...draft.embeddings, model: e.target.value } })} disabled={disabled} spellCheck={false} className="mono" />}
            </Field>
            <Field label={t('aiProviders.embeddings.dimensions')}>
              {(id) => <TextInput id={id} value={draft.embeddings.dimensions} inputMode="numeric" className="input-short" onChange={(e) => patch({ embeddings: { ...draft.embeddings, dimensions: e.target.value } })} disabled={disabled} />}
            </Field>
          </div>
          {draft.embeddings.provider === 'ollama' && <p className="muted small">{t('aiProviders.embeddings.modelOllamaHint')}</p>}
          <p className="muted small">{t('aiProviders.embeddings.hint')}</p>
        </fieldset>

        <fieldset className="fieldset">
          <legend className="field-label">{t('aiProviders.credentials.legend')}</legend>
          <p className="muted small">{t('aiProviders.credentials.hint')}</p>
          {CREDENTIALS.map((name) => (
            <div key={name} className="stack-form">
              <Checkbox label={t(`aiProviders.credentials.names.${name}`)} checked={draft.on[name]} onCheckedChange={(on) => patch({ on: { ...draft.on, [name]: on } })} disabled={disabled} />
              {draft.on[name] && fields(name)}
            </div>
          ))}
          <p className="muted small">{t('aiProviders.ocrHint')}</p>
        </fieldset>

        <fieldset className="fieldset">
          <legend className="field-label">{t('aiProviders.indexes.legend')}</legend>
          {idx.embedder && <p className="small">{t('aiProviders.indexes.status', { embedder: idx.embedder, regulations: state(idx.regulations), us: state(idx.tariff.US), ca: state(idx.tariff.CA) })}</p>}
          <p className="muted small">{t('aiProviders.indexes.rebuildHint')}</p>
          {job?.running && (
            <Banner tone="info">{t('aiProviders.indexes.running', { embedder: job.embedder, step: job.step, done: job.done, total: job.total || '…' })}</Banner>
          )}
          {job && !job.running && job.error && <Banner tone="error">{t('aiProviders.indexes.failed', { error: job.error })}</Banner>}
          {job && !job.running && !job.error && <Banner tone="ok">{t('aiProviders.indexes.done', { embedder: job.embedder })}</Banner>}
          {editable && (
            <div>
              <Button onClick={() => void reindex()} disabled={!!busy || rebuilding || !idx.embedder}>
                {t('aiProviders.indexes.rebuild')}
              </Button>
            </div>
          )}
        </fieldset>

        {status && <Banner tone={status.tone}>{status.text}</Banner>}
        {settings.updatedAt && settings.source === 'admin' && <p className="muted small">{t('aiProviders.updated', { who: settings.updatedBy ?? '—', date: formatDateTime(settings.updatedAt) })}</p>}
        {editable && (
          <div className="dialog-actions mail-settings-actions">
            <Button type="submit" variant="primary" disabled={!!busy}>
              {t('aiProviders.save')}
            </Button>
            <Button onClick={() => void test('llm')} disabled={!!busy || needsModel}>
              {t('aiProviders.test.llm')}
            </Button>
            <Button onClick={() => void test('embeddings')} disabled={!!busy}>
              {t('aiProviders.test.embeddings')}
            </Button>
            {CREDENTIALS.filter((name) => OCR_TEST[name] && draft.on[name]).map((name) => (
              <Button key={name} onClick={() => void test(OCR_TEST[name]!)} disabled={!!busy}>
                {t(`aiProviders.test.${OCR_TEST[name]!}`)}
              </Button>
            ))}
            {settings.source === 'admin' && (
              <Button variant="ghost" onClick={() => void run('reset', async () => load(await api.resetAdminAi()))} disabled={!!busy}>
                {t('aiProviders.reset')}
              </Button>
            )}
          </div>
        )}
      </form>
    </Card>
  );
}
