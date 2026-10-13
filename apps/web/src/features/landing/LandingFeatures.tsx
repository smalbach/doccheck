import { LANDING_FEATURES } from '../../constants/landing';
import { FeatureCard } from './FeatureCard';

export function LandingFeatures() {
  return (
    <section className="landing-section">
      <h2>Deterministic first, the model only where it helps</h2>
      <div className="feature-grid">
        {LANDING_FEATURES.map((f) => (
          <FeatureCard key={f.title} icon={f.icon} title={f.title} text={f.text} />
        ))}
      </div>
    </section>
  );
}
