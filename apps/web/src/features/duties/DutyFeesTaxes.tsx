import type { DutyEstimate } from '../../api/dutyTypes';
import { useI18n } from '../../i18n/useI18n';

/** MPF and HMF (US), GST and the provincial taxes (CA), and the additional duties applied. */
export function DutyFeesTaxes({ estimate }: { estimate: DutyEstimate }) {
  const { t, formatMoney } = useI18n();
  const m = (v: string) => formatMoney(v, estimate.currency);
  const additional = estimate.lines.flatMap((l) => l.additional.map((a) => ({ ...a, lineNo: l.lineNo })));
  return (
    <section className="duty-section" aria-labelledby="duty-fees">
      <h3 id="duty-fees">{t('duties.feesTaxes.title')}</h3>
      <ul className="duty-list small">
        {estimate.fees.map((f) => (
          <li key={f.code}>
            <span lang="en">{f.name}</span>: <strong>{m(f.amount)}</strong> <span className="muted">({f.percent} %, {t('duties.feesTaxes.base', { base: m(f.base) })})</span>
            {f.note && (
              <span className="muted" lang="en">
                {' '}
                {f.note}
              </span>
            )}
          </li>
        ))}
        {estimate.taxes.map((x) => (
          <li key={x.code}>
            <span lang="en">{x.name}</span>: {x.amount !== undefined && <strong>{m(x.amount)}</strong>}{' '}
            <span className="muted">
              ({x.percent} %, {t('duties.feesTaxes.base', { base: m(x.base) })}, {x.atBorder ? t('duties.feesTaxes.atBorder') : t('duties.feesTaxes.notAtBorder')})
            </span>
          </li>
        ))}
      </ul>
      <h4>{t('duties.additional.title')}</h4>
      {additional.length === 0 ? (
        <p className="small muted">{t('duties.additional.none')}</p>
      ) : (
        <ul className="duty-list small">
          {additional.map((a) => (
            <li key={`${a.lineNo}-${a.id}`}>
              {t('duties.questions.lineLabel', { line: a.lineNo })}: <span lang="en">{a.program}</span>
              {a.heading && <code> {a.heading}</code>} {a.percent} % = <strong>{m(a.amount)}</strong>
              {a.basis === 'metalContent' && <span className="muted"> {t('duties.additional.metal')}</span>}
              {!a.verified && <span className="muted"> · {t('duties.additional.unverified')}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
