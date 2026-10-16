import { useState } from 'react';
import { reviewApi, type LearnedSuppliers } from '../../api/review';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { useDemo } from '../../hooks/useDemo';
import { useQuery } from '../../hooks/useQuery';
import { useI18n } from '../../i18n/useI18n';
import { errorMessage } from '../../lib/errorMessage';
import { useOrg } from '../team/useOrg';

/** The supplier examples kept for this account (supplier learning), with a way to forget a supplier. */
export function LearnedSuppliersCard() {
  const { t } = useI18n();
  const demo = useDemo();
  const { can } = useOrg();
  const { data, error } = useQuery('suppliers', reviewApi.suppliers);
  const [shown, setShown] = useState<LearnedSuppliers>();
  const [failed, setFailed] = useState<string>();
  const learned = shown ?? data;
  if (!learned) return error ? <Banner tone="error">{error}</Banner> : null;
  const forget = (key: string) =>
    reviewApi.forgetSupplier(key).then(
      (next) => {
        setShown(next);
        setFailed(undefined);
      },
      (e: unknown) => setFailed(errorMessage(e)),
    );
  const value = (v: string | null) => (v === null ? t('learning.exampleEmpty') : `“${v}”`);
  return (
    <Card title={t('learning.learnedTitle')}>
      {failed && <Banner tone="error">{failed}</Banner>}
      {!learned.enabled && <p className="muted">{t('learning.learnedOff')}</p>}
      {learned.suppliers.length === 0 ? (
        learned.enabled && <p className="muted">{t('learning.learnedEmpty')}</p>
      ) : (
        <ul className="learned-suppliers">
          {learned.suppliers.map((s) => (
            <li key={s.key}>
              <div className="learned-supplier-head">
                <strong>{s.name}</strong>
                <span className="muted small">{t('learning.examplesCount', { count: s.examples.length })}</span>
                {!demo && can('shipment.write') && (
                  <Button size="sm" variant="ghost" onClick={() => void forget(s.key)}>
                    {t('learning.forget', { name: s.name })}
                  </Button>
                )}
              </div>
              <ul className="small">
                {s.examples.map((e) => (
                  <li key={`${e.documentType}:${e.field}`}>{t('learning.example', { field: e.field, model: value(e.modelValue), correct: value(e.correctValue) })}</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
