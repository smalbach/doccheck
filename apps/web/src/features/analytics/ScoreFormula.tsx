import { useI18n } from '../../i18n/useI18n';

/** The supplier score formula, written out on the page as the API computes it (apps/api/src/insights/score.ts). */
export function ScoreFormula() {
  const { t } = useI18n();
  return (
    <section className="score-formula" aria-labelledby="score-formula-title">
      <h2 className="section-title" id="score-formula-title">
        {t('analytics.suppliers.formula.title')}
      </h2>
      <p>
        <code>{t('analytics.suppliers.formula.intro')}</code>
      </p>
      <ul className="small">
        <li>{t('analytics.suppliers.formula.firstPass')}</li>
        <li>{t('analytics.suppliers.formula.correction')}</li>
        <li>{t('analytics.suppliers.formula.responsiveness')}</li>
      </ul>
      <p className="muted small">{t('analytics.suppliers.formula.missing')}</p>
    </section>
  );
}
