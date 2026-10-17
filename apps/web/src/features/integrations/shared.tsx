import { useState } from 'react';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Checkbox } from '../../components/ui/Checkbox';
import { DataTable } from '../../components/ui/DataTable';
import { Disclosure } from '../../components/ui/Disclosure';
import { useQuery } from '../../hooks/useQuery';
import type { MessageKey } from '../../i18n/keys';
import { useI18n } from '../../i18n/useI18n';
import { errorMessage } from '../../lib/errorMessage';
import { integrationsApi, type Delivery, type EventType, type LastDelivery } from './integrationsApi';

export const EVENT_TYPES: EventType[] = ['document.extracted', 'validation.completed', 'finding.created', 'finding.resolved', 'supplier.replied'];

/** "finding.created" → "findingCreated", the message key of an event (keys cannot hold dots). */
export const eventKey = (type: string) => type.replace(/\.(\w)/g, (_, c: string) => c.toUpperCase());

export function useEventLabel() {
  const { t } = useI18n();
  return (type: string) => (type === 'ping' ? t('integrations.events.ping') : t(`integrations.events.${eventKey(type)}` as MessageKey));
}

/** Checkboxes for the events a webhook or alert is subscribed to, each with what it means. */
export function EventChecklist({ value, onChange, legend }: { value: EventType[]; onChange: (next: EventType[]) => void; legend?: string }) {
  const { t } = useI18n();
  const label = useEventLabel();
  return (
    <fieldset className="fieldset">
      <legend className="field-label">{legend ?? t('integrations.events.label')}</legend>
      <ul className="event-checklist">
        {EVENT_TYPES.map((e) => (
          <li key={e}>
            <Checkbox label={label(e)} checked={value.includes(e)} onCheckedChange={(on) => onChange(on ? [...value, e] : value.filter((x) => x !== e))} />
            <span className="muted small">{t(`integrations.events.help.${eventKey(e)}` as MessageKey)}</span>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}

/** A value shown once (a new key or secret), with a copy button. */
export function SecretReveal({ label, value }: { label: string; value: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  return (
    <div className="secret-reveal" role="status">
      <p>{label}</p>
      <div className="secret-reveal-row">
        <code className="mono">{value}</code>
        <Button
          size="sm"
          onClick={() =>
            void navigator.clipboard.writeText(value).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            })
          }
        >
          {copied ? t('integrations.copied') : t('integrations.copy')}
        </Button>
      </div>
    </div>
  );
}

export function LastDeliveryLine({ last }: { last: LastDelivery | null }) {
  const { t, formatDateTime } = useI18n();
  if (!last) return null;
  return (
    <p className="muted small">
      {t('integrations.deliveries.last', { status: t(`integrations.deliveries.statuses.${last.status as Delivery['status']}`), date: formatDateTime(last.at) })}
      {last.responseStatus ? ` · HTTP ${last.responseStatus}` : ''}
    </p>
  );
}

/** The delivery log of a webhook or chat alert, with "Send again". */
export function DeliveryLog({ targetId, kind, refreshKey }: { targetId: string; kind: 'webhook' | 'chat'; refreshKey: number }) {
  const { t, formatDateTime } = useI18n();
  const label = useEventLabel();
  const [nonce, setNonce] = useState(0);
  const [status, setStatus] = useState<{ tone: 'ok' | 'error'; text: string }>();
  const { data, error } = useQuery(`${kind}-${targetId}-${refreshKey}-${nonce}`, () => (kind === 'webhook' ? integrationsApi.webhookDeliveries(targetId) : integrationsApi.chatDeliveries(targetId)));
  const redeliver = (d: Delivery) =>
    integrationsApi.redeliver(d.id).then(
      () => {
        setStatus({ tone: 'ok', text: t('integrations.deliveries.redelivered') });
        setTimeout(() => setNonce((n) => n + 1), 800);
      },
      (e: unknown) => setStatus({ tone: 'error', text: errorMessage(e) }),
    );
  return (
    <Disclosure summary={t('integrations.deliveries.title')}>
      <div className="delivery-log">
        <Button size="sm" variant="ghost" onClick={() => setNonce((n) => n + 1)}>
          {t('integrations.deliveries.refresh')}
        </Button>
        {status && <Banner tone={status.tone}>{status.text}</Banner>}
        {error && <Banner tone="error">{error}</Banner>}
        {data && data.length === 0 && <p className="muted small">{t('integrations.deliveries.empty')}</p>}
        {data && data.length > 0 && (
          <DataTable
            compact
            caption={t('integrations.deliveries.title')}
            rows={data}
            rowKey={(d) => d.id}
            columns={[
              { key: 'when', header: t('integrations.deliveries.when'), cell: (d) => <span className="nowrap">{formatDateTime(d.createdAt)}</span> },
              { key: 'event', header: t('integrations.deliveries.event'), cell: (d) => <>{label(d.eventType)}{d.redeliveryOf ? <span className="muted small"> · {t('integrations.deliveries.repeat')}</span> : null}</> },
              { key: 'status', header: t('integrations.deliveries.status'), cell: (d) => <span className={`delivery-status delivery-${d.status}`}>{t(`integrations.deliveries.statuses.${d.status}`)}</span> },
              { key: 'attempts', header: t('integrations.deliveries.attempts'), numeric: true, cell: (d) => d.attempts, secondary: true },
              { key: 'response', header: t('integrations.deliveries.response'), cell: (d) => <span className="small">{d.responseStatus ? `HTTP ${d.responseStatus}` : ''}{d.error && d.error !== `Answered ${d.responseStatus}` ? ` ${d.error}` : ''}</span>, secondary: true },
              {
                key: 'again',
                header: <span className="visually-hidden">{t('integrations.deliveries.redeliver')}</span>,
                cell: (d) => (d.status === 'pending' ? null : <Button size="sm" onClick={() => void redeliver(d)}>{t('integrations.deliveries.redeliver')}</Button>),
              },
            ]}
          />
        )}
      </div>
    </Disclosure>
  );
}

/** "error" banner state shared by the tabs. */
export type Status = { tone: 'ok' | 'error'; text: string } | undefined;

/** A code sample that may scroll sideways: focusable and named, so the keyboard can scroll it. */
export function CodeBlock({ children }: { children: string }) {
  const { t } = useI18n();
  return (
    <pre className="code-block" tabIndex={0} role="region" aria-label={t('integrations.codeExample')}>
      {children}
    </pre>
  );
}
