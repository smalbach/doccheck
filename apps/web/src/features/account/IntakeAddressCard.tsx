import { useState } from 'react';
import { api } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { useQuery } from '../../hooks/useQuery';
import { useI18n } from '../../i18n/useI18n';

/** The user's address for sending documents by email, when an admin turned that on. */
export function IntakeAddressCard() {
  const { t } = useI18n();
  const { data } = useQuery('intake-address', () => api.intakeAddress());
  const [copied, setCopied] = useState(false);
  if (!data) return null;
  return (
    <Card title={t('mail.account.title')}>
      {!data.enabled || !data.address ? (
        <p className="muted">{t('mail.account.off')}</p>
      ) : (
        <>
          <p>{t('mail.account.text')}</p>
          <div className="intake-address">
            <code>{data.address}</code>
            <Button
              size="sm"
              onClick={() =>
                void navigator.clipboard.writeText(data.address!).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                })
              }
            >
              {copied ? t('mail.account.copied') : t('mail.account.copy')}
            </Button>
          </div>
          <p className="muted small">{t('mail.account.own', { address: data.ownAddress })}</p>
        </>
      )}
    </Card>
  );
}
