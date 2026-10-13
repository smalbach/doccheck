import { api } from '../../api/client';
import { Card } from '../../components/ui/Card';
import { useMailSummary } from '../../hooks/useMailSummary';
import { useQuery } from '../../hooks/useQuery';
import { useI18n } from '../../i18n/useI18n';
import { ThreadTable } from './ThreadTable';
import type { ReactNode } from 'react';

export interface ThreadsCardProps {
  shipmentId?: string;
  partyId?: string;
  /** Buttons at the right of the title (a new message). */
  actions?: ReactNode;
}

/** The conversations about a shipment or with a company. */
export function ThreadsCard({ shipmentId, partyId, actions }: ThreadsCardProps) {
  const { t } = useI18n();
  const summary = useMailSummary();
  const query = { filter: 'all' as const, shipmentId, partyId, limit: 20 };
  const { data } = useQuery(`threads-of:${JSON.stringify(query)}:${JSON.stringify(summary ?? {})}`, () => api.mailThreads(query));
  return (
    <Card title={t('mail.threads')} aside={actions}>
      {!data || data.items.length === 0 ? <p className="muted">{t('mail.noThreads')}</p> : <ThreadTable compact threads={data.items} caption={t('mail.threads')} hideShipment={!!shipmentId} />}
    </Card>
  );
}
