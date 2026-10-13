import { LANDING_FEATURES } from '../../constants/landing';
import { useI18n } from '../../i18n/useI18n';
import { FeatureCard } from './FeatureCard';

export function LandingFeatures() {
  const { t } = useI18n();
  return (
    <section className="landing-section" aria-labelledby="landing-features">
      <h2 id="landing-features">{t('landing.featuresTitle')}</h2>
      <div className="feature-grid">
        {LANDING_FEATURES.map((f) => (
          <FeatureCard key={f.id} icon={f.icon} title={t(`landing.features.${f.id}.title`)} text={t(`landing.features.${f.id}.text`)} />
        ))}
      </div>
    </section>
  );
}
