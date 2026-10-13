import { CheckIcon } from '@radix-ui/react-icons';
import { LANDING_CHECKS } from '../../constants/landing';
import { useI18n } from '../../i18n/useI18n';

export function LandingChecks() {
  const { t } = useI18n();
  return (
    <section className="landing-section landing-checks" aria-labelledby="landing-checks">
      <div>
        <h2 id="landing-checks">{t('landing.checksTitle')}</h2>
        <p className="muted">{t('landing.checksText')}</p>
      </div>
      <ul className="check-list">
        {LANDING_CHECKS.map((id) => (
          <li key={id}>
            <CheckIcon aria-hidden /> {t(`landing.checks.${id}`)}
          </li>
        ))}
      </ul>
    </section>
  );
}
