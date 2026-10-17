import type { DutyEstimate } from '../../api/dutyTypes';
import { useI18n } from '../../i18n/useI18n';

/** The shipment's totals: customs value, what is paid at the border, and the landed cost. */
export function DutyTotals({ estimate }: { estimate: DutyEstimate }) {
  const { t, formatMoney } = useI18n();
  const { totals, currency, destination } = estimate;
  const m = (v: string) => formatMoney(v, currency);
  const rows: [string, string, boolean?][] = [
    [destination === 'US' ? t('duties.totals.dutiableUS') : t('duties.totals.dutiableCA'), totals.dutiableValue],
    [t('duties.totals.duty'), totals.duty],
    [t('duties.totals.additional'), totals.additional],
    ...(destination === 'US' ? [[t('duties.totals.fees'), totals.fees] as [string, string]] : []),
    ...(destination === 'CA' ? [[t('duties.totals.taxes'), totals.taxesAtBorder] as [string, string]] : []),
    [t('duties.totals.payable'), totals.payableAtBorder, true],
    [t('duties.totals.landed'), totals.landedCost, true],
  ];
  return (
    <>
      <dl className="duty-totals" aria-label={t('duties.totals.label')}>
        {rows.map(([label, value, strong]) => (
          <div key={label} className={strong ? 'duty-total-strong' : undefined}>
            <dt>{label}</dt>
            <dd>{m(value)}</dd>
          </div>
        ))}
      </dl>
      {totals.selfAssessedTaxes !== '0.00' && (
        <p className="small muted">
          {t('duties.totals.selfAssessed')}: {m(totals.selfAssessedTaxes)}
        </p>
      )}
    </>
  );
}
