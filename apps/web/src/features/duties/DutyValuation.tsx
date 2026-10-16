import type { DutyEstimate } from '../../api/dutyTypes';
import { useI18n } from '../../i18n/useI18n';

/** How the customs value was reached from the invoice price, and the exchange rates used. */
export function DutyValuation({ estimate }: { estimate: DutyEstimate }) {
  const { t, formatMoney } = useI18n();
  const { valuation, exchange, currency } = estimate;
  return (
    <section className="duty-section" aria-labelledby="duty-valuation">
      <h3 id="duty-valuation">{t('duties.valuation.title')}</h3>
      <dl className="entity-facts">
        <div>
          <dt>{t('duties.valuation.basis')}</dt>
          <dd lang="en">{valuation.method}</dd>
        </div>
        {valuation.incoterm && (
          <div>
            <dt>{t('duties.valuation.incoterm')}</dt>
            <dd>{valuation.incoterm}</dd>
          </div>
        )}
        <div>
          <dt>{t('duties.valuation.invoiced')}</dt>
          <dd>{formatMoney(valuation.priceInvoiced, currency)}</dd>
        </div>
      </dl>
      {valuation.adjustments.length === 0 ? (
        <p className="small muted">{t('duties.valuation.none')}</p>
      ) : (
        <ul className="duty-list small">
          {valuation.adjustments.map((a, i) => (
            <li key={i}>
              {t(`duties.valuation.kinds.${a.kind}`)}: <strong>{formatMoney(a.amount, currency)}</strong>{' '}
              <span className="muted">
                ({a.original.currency !== currency && `${a.original.amount} ${a.original.currency}, `}
                {a.from === 'invoice' ? t('duties.valuation.fromInvoice') : t('duties.valuation.fromInput')})
              </span>
            </li>
          ))}
        </ul>
      )}
      <h4>{t('duties.valuation.exchange')}</h4>
      <ul className="duty-list small">
        {exchange
          .filter((r) => r.from !== r.to)
          .map((r) => (
            <li key={r.from}>
              {t('duties.valuation.rate', { from: r.from, rate: r.rate, to: r.to })}{' '}
              <span className="muted">
                {r.manual ? t('duties.valuation.manual') : t('duties.valuation.rateSource', { source: r.source, date: r.date })}
                {!r.manual && r.date !== r.requestedDate && <> {t('duties.valuation.rateEarlier', { date: r.requestedDate })}</>}
              </span>
            </li>
          ))}
        {exchange.every((r) => r.from === r.to) && <li className="muted">{currency}</li>}
      </ul>
    </section>
  );
}
