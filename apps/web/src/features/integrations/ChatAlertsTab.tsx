import { useState, type FormEvent } from 'react';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Checkbox } from '../../components/ui/Checkbox';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { Field } from '../../components/ui/Field';
import { Select } from '../../components/ui/Select';
import { Switch } from '../../components/ui/Switch';
import { Tag } from '../../components/ui/Tag';
import { TextInput } from '../../components/ui/TextInput';
import { useQuery } from '../../hooks/useQuery';
import { useI18n } from '../../i18n/useI18n';
import { errorMessage } from '../../lib/errorMessage';
import { integrationsApi, type ChatAlert, type EventType } from './integrationsApi';
import { DeliveryLog, EventChecklist, LastDeliveryLine, useEventLabel, type Status } from './shared';

type Kind = 'slack' | 'teams';

export function ChatAlertsTab() {
  const { t } = useI18n();
  const [nonce, setNonce] = useState(0);
  const { data: alerts, error } = useQuery(`chat-${nonce}`, () => integrationsApi.chatAlerts());
  const [kind, setKind] = useState<Kind>('slack');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<EventType[]>(['validation.completed', 'supplier.replied']);
  const [includeDetails, setIncludeDetails] = useState(false);
  const [status, setStatus] = useState<Status>();
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setStatus(undefined);
    try {
      await integrationsApi.createChatAlert({ kind, name: name.trim(), url: url.trim(), events, includeDetails });
      setName('');
      setUrl('');
      setNonce((n) => n + 1);
    } catch (err) {
      setStatus({ tone: 'error', text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Card title={t('integrations.chat.create')}>
        <p className="muted">{t('integrations.chat.intro')}</p>
        <form className="stack-form" onSubmit={(e) => void submit(e)} noValidate>
          <div className="setting-row">
            <Field label={t('integrations.chat.kind')}>
              {(id) => <Select id={id} value={kind} options={(['slack', 'teams'] as const).map((k) => ({ value: k, label: t(`integrations.chat.kinds.${k}`) }))} onValueChange={setKind} />}
            </Field>
            <Field label={t('integrations.chat.name')} grow>
              {(id) => <TextInput id={id} value={name} placeholder="#customs" maxLength={100} onChange={(e) => setName(e.target.value)} />}
            </Field>
          </div>
          <Field label={t('integrations.chat.url')}>
            {(id) => <TextInput id={id} type="url" value={url} onChange={(e) => setUrl(e.target.value)} spellCheck={false} autoComplete="off" />}
          </Field>
          <p className="muted small">{t(`integrations.chat.urlHelp.${kind}`)}</p>
          <EventChecklist value={events} onChange={setEvents} />
          <Checkbox label={t('integrations.chat.details')} checked={includeDetails} onCheckedChange={setIncludeDetails} />
          <p className="muted small">{t('integrations.chat.detailsHelp')}</p>
          {status && <Banner tone={status.tone}>{status.text}</Banner>}
          <div>
            <Button type="submit" variant="primary" disabled={busy || !name.trim() || !url.trim() || events.length === 0}>
              {t('integrations.chat.submit')}
            </Button>
          </div>
        </form>
      </Card>

      <Card title={t('integrations.chat.list')}>
        {error && <Banner tone="error">{error}</Banner>}
        {alerts && alerts.length === 0 && <p className="muted">{t('integrations.chat.empty')}</p>}
        {alerts?.map((a) => <ChatAlertItem key={a.id} alert={a} onChange={() => setNonce((n) => n + 1)} />)}
      </Card>
    </>
  );
}

function ChatAlertItem({ alert, onChange }: { alert: ChatAlert; onChange: () => void }) {
  const { t } = useI18n();
  const label = useEventLabel();
  const [status, setStatus] = useState<Status>();
  const [refresh, setRefresh] = useState(0);
  return (
    <article className="integration-item">
      <div className="integration-item-head">
        <div className="integration-item-title">
          <strong>{alert.name}</strong>
          <span className="muted small">
            {t(`integrations.chat.kinds.${alert.kind}`)} · {t('integrations.chat.host', { host: alert.urlHost })} · {alert.includeDetails ? t('integrations.chat.detailsOn') : t('integrations.chat.detailsOff')}
          </span>
        </div>
        <Switch label={alert.active ? t('integrations.active') : t('integrations.inactive')} checked={alert.active} onCheckedChange={(active) => void integrationsApi.updateChatAlert(alert.id, { active }).then(onChange)} />
      </div>
      <p className="tag-row">{alert.events.map((e) => <Tag key={e}>{label(e)}</Tag>)}</p>
      <LastDeliveryLine last={alert.lastDelivery} />
      {status && <Banner tone={status.tone}>{status.text}</Banner>}
      <div className="integration-actions">
        <Button
          size="sm"
          onClick={() =>
            void integrationsApi.testChatAlert(alert.id).then(
              () => {
                setStatus({ tone: 'ok', text: t('integrations.webhooks.tested') });
                setTimeout(() => setRefresh((n) => n + 1), 800);
              },
              (err: unknown) => setStatus({ tone: 'error', text: errorMessage(err) }),
            )
          }
        >
          {t('integrations.webhooks.test')}
        </Button>
        <ConfirmDialog
          trigger={<Button size="sm" variant="danger">{t('integrations.delete')}</Button>}
          title={t('integrations.chat.deleteTitle')}
          description={t('integrations.chat.deleteText', { name: alert.name })}
          confirmLabel={t('integrations.delete')}
          onConfirm={() => void integrationsApi.deleteChatAlert(alert.id).then(onChange, (err: unknown) => setStatus({ tone: 'error', text: errorMessage(err) }))}
        />
      </div>
      <DeliveryLog targetId={alert.id} kind="chat" refreshKey={refresh} />
    </article>
  );
}
