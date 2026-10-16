import { useState, type FormEvent } from 'react';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { Disclosure } from '../../components/ui/Disclosure';
import { Field } from '../../components/ui/Field';
import { Switch } from '../../components/ui/Switch';
import { Tag } from '../../components/ui/Tag';
import { TextInput } from '../../components/ui/TextInput';
import { useQuery } from '../../hooks/useQuery';
import { useI18n } from '../../i18n/useI18n';
import { errorMessage } from '../../lib/errorMessage';
import { integrationsApi, type EventType, type Webhook } from './integrationsApi';
import { CodeBlock, DeliveryLog, EventChecklist, LastDeliveryLine, SecretReveal, useEventLabel, type Status } from './shared';

export function WebhooksTab({ deliveryMode }: { deliveryMode?: 'bullmq' | 'poller' }) {
  const { t } = useI18n();
  const [nonce, setNonce] = useState(0);
  const { data: hooks, error } = useQuery(`webhooks-${nonce}`, () => integrationsApi.webhooks());
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [events, setEvents] = useState<EventType[]>(['validation.completed', 'finding.created']);
  const [secret, setSecret] = useState<string>();
  const [status, setStatus] = useState<Status>();
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setStatus(undefined);
    try {
      const created = await integrationsApi.createWebhook({ url: url.trim(), description: description.trim() || undefined, events });
      setSecret(created.secret);
      setUrl('');
      setDescription('');
      setNonce((n) => n + 1);
    } catch (err) {
      setStatus({ tone: 'error', text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Card title={t('integrations.webhooks.create')}>
        <p className="muted">{t('integrations.webhooks.intro')}</p>
        <form className="stack-form" onSubmit={(e) => void submit(e)} noValidate>
          <Field label={t('integrations.webhooks.url')}>
            {(id) => <TextInput id={id} type="url" value={url} placeholder="https://erp.example.com/doccheck" onChange={(e) => setUrl(e.target.value)} spellCheck={false} required />}
          </Field>
          <Field label={t('integrations.webhooks.descriptionField')}>
            {(id) => <TextInput id={id} value={description} maxLength={200} onChange={(e) => setDescription(e.target.value)} />}
          </Field>
          <EventChecklist value={events} onChange={setEvents} />
          {status && <Banner tone={status.tone}>{status.text}</Banner>}
          {secret && <SecretReveal label={t('integrations.webhooks.created')} value={secret} />}
          <div>
            <Button type="submit" variant="primary" disabled={busy || !url.trim() || events.length === 0}>
              {t('integrations.webhooks.submit')}
            </Button>
          </div>
        </form>
        <Disclosure summary={t('integrations.webhooks.verify')}>
          <p className="small">{t('integrations.webhooks.verifyText')}</p>
          <CodeBlock>{`const event = verifyWebhook(secret, rawBody, req.headers['doccheck-signature']);`}</CodeBlock>
        </Disclosure>
      </Card>

      <Card title={t('integrations.webhooks.list')} aside={deliveryMode && <span className="muted small">{t(`integrations.deliveries.mode.${deliveryMode}`)}</span>}>
        {error && <Banner tone="error">{error}</Banner>}
        {hooks && hooks.length === 0 && <p className="muted">{t('integrations.webhooks.empty')}</p>}
        {hooks?.map((h) => <WebhookItem key={h.id} hook={h} onChange={() => setNonce((n) => n + 1)} />)}
      </Card>
    </>
  );
}

function WebhookItem({ hook, onChange }: { hook: Webhook; onChange: () => void }) {
  const { t } = useI18n();
  const label = useEventLabel();
  const [status, setStatus] = useState<Status>();
  const [secret, setSecret] = useState<string>();
  const [refresh, setRefresh] = useState(0);
  const act = (work: () => Promise<unknown>, ok?: string) =>
    work().then(
      () => {
        if (ok) setStatus({ tone: 'ok', text: ok });
        setTimeout(() => setRefresh((n) => n + 1), 800);
      },
      (err: unknown) => setStatus({ tone: 'error', text: errorMessage(err) }),
    );
  return (
    <article className="integration-item">
      <div className="integration-item-head">
        <div className="integration-item-title">
          <code className="mono break">{hook.url}</code>
          {hook.description && <span className="muted small">{hook.description}</span>}
        </div>
        <Switch label={hook.active ? t('integrations.active') : t('integrations.inactive')} checked={hook.active} onCheckedChange={(active) => void integrationsApi.updateWebhook(hook.id, { active }).then(onChange)} />
      </div>
      <p className="tag-row">{hook.events.map((e) => <Tag key={e}>{label(e)}</Tag>)}</p>
      <LastDeliveryLine last={hook.lastDelivery} />
      {status && <Banner tone={status.tone}>{status.text}</Banner>}
      {secret && <SecretReveal label={t('integrations.webhooks.created')} value={secret} />}
      <div className="integration-actions">
        <Button size="sm" onClick={() => void act(() => integrationsApi.testWebhook(hook.id), t('integrations.webhooks.tested'))}>
          {t('integrations.webhooks.test')}
        </Button>
        <Button size="sm" onClick={() => void integrationsApi.webhookSecret(hook.id).then((s) => setSecret(s.secret ?? undefined), (err: unknown) => setStatus({ tone: 'error', text: errorMessage(err) }))}>
          {t('integrations.webhooks.showSecret')}
        </Button>
        <ConfirmDialog
          trigger={<Button size="sm">{t('integrations.webhooks.rotate')}</Button>}
          title={t('integrations.webhooks.rotateTitle')}
          description={t('integrations.webhooks.rotateText')}
          confirmLabel={t('integrations.webhooks.rotate')}
          onConfirm={() => void integrationsApi.rotateWebhookSecret(hook.id).then((s) => setSecret(s.secret), (err: unknown) => setStatus({ tone: 'error', text: errorMessage(err) }))}
        />
        <ConfirmDialog
          trigger={<Button size="sm" variant="danger">{t('integrations.delete')}</Button>}
          title={t('integrations.webhooks.deleteTitle')}
          description={t('integrations.webhooks.deleteText', { url: hook.url })}
          confirmLabel={t('integrations.delete')}
          onConfirm={() => void integrationsApi.deleteWebhook(hook.id).then(onChange, (err: unknown) => setStatus({ tone: 'error', text: errorMessage(err) }))}
        />
      </div>
      <DeliveryLog targetId={hook.id} kind="webhook" refreshKey={refresh} />
    </article>
  );
}
