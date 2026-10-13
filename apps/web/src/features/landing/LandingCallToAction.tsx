import { Button } from '../../components/ui/Button';
import { useI18n } from '../../i18n/useI18n';

export function LandingCallToAction({ signedIn }: { signedIn: boolean }) {
  const { t } = useI18n();
  return (
    <section className="landing-cta" aria-labelledby="landing-cta">
      <h2 id="landing-cta">{t('landing.ctaTitle')}</h2>
      <p className="muted">{t('landing.ctaText')}</p>
      <Button asChild variant="primary">
        <a href={signedIn ? '#/app/samples' : '#/register'}>{signedIn ? t('landing.ctaSamples') : t('auth.getStarted')}</a>
      </Button>
    </section>
  );
}
