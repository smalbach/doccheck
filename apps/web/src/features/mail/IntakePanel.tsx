import { useState } from 'react';
import { api } from '../../api/client';
import type { Intake } from '../../api/types';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Spinner } from '../../components/ui/Spinner';
import { Tag } from '../../components/ui/Tag';
import { useI18n } from '../../i18n/useI18n';
import { errorMessage } from '../../lib/errorMessage';

export interface IntakePanelProps {
  intakes: readonly Intake[];
  readOnly: boolean;
  onChanged: () => void;
  onError: (message: string) => void;
}

/** What happened to the documents of an email: read, checked, waiting for a destination, or failed. */
export function IntakePanel({ intakes, readOnly, onChanged, onError }: IntakePanelProps) {
  const { t } = useI18n();
  const [busy, setBusy] = useState<string>();
  if (intakes.length === 0) return null;
  const retry = async (id: string) => {
    setBusy(id);
    try {
      await api.retryIntake(id);
      onChanged();
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setBusy(undefined);
    }
  };
  return (
    <Card title={t('mail.intake.title')}>
      <ul className="resolved-list" aria-live="polite">
        {intakes.map((i) => {
          const working = i.status === 'extracting' || i.status === 'validating';
          return (
            <li key={i.id}>
              <span className="intake-line">
                {working && <Spinner label={t(`mail.intake.status.${i.status}`)} />}
                <Tag tone={i.status === 'validated' ? 'ok' : i.status === 'failed' || i.status === 'needs_destination' ? 'neutral' : 'accent'}>{t(`mail.intake.status.${i.status}`)}</Tag>
                {i.documents > 0 && <span className="small">{t('mail.intake.documents', { count: i.documents })}</span>}
                {i.findings !== undefined && <span className="small">{t('mail.intake.findings', { count: i.findings })}</span>}
                {i.shipmentId && (
                  <a href={`#/app/s/${i.shipmentId}`}>
                    {t('mail.intake.shipment')}
                    {i.createdShipment && ` (${t('mail.intake.newShipment')})`} ↗
                  </a>
                )}
              </span>
              {i.status === 'needs_destination' && <span className="muted small block">{t('mail.intake.setDestination')}</span>}
              {i.error && i.status !== 'needs_destination' && (
                <span className="muted small block" lang="en">
                  {i.error}
                </span>
              )}
              {!readOnly && (i.status === 'needs_destination' || i.status === 'failed') && (
                <Button size="sm" disabled={busy === i.id} onClick={() => void retry(i.id)}>
                  {t('mail.intake.retry')}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
