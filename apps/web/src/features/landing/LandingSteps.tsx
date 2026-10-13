import { LANDING_STEPS } from '../../constants/landing';
import { useI18n } from '../../i18n/useI18n';

export function LandingSteps() {
  const { t } = useI18n();
  return (
    <section className="landing-section" aria-labelledby="landing-how">
      <h2 id="landing-how">{t('landing.howTitle')}</h2>
      <ol className="landing-steps">
        {LANDING_STEPS.map((id, i) => (
          <li key={id} className="landing-step">
            <span className="landing-step-number" aria-hidden>
              {i + 1}
            </span>
            <h3>{t(`landing.steps.${id}.title`)}</h3>
            <p className="muted">{t(`landing.steps.${id}.text`)}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
