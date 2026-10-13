import { ArrowRightIcon } from '@radix-ui/react-icons';
import { Button } from '../../components/ui/Button';
import { useI18n } from '../../i18n/useI18n';

export function LandingHero({ signedIn }: { signedIn: boolean }) {
  const { t } = useI18n();
  return (
    <section className="landing-hero" aria-labelledby="landing-title">
      <p className="landing-eyebrow">{t('landing.eyebrow')}</p>
      <h1 id="landing-title">{t('landing.title')}</h1>
      <p className="landing-lede">{t('landing.lede')}</p>
      <div className="landing-ctas">
        {signedIn ? (
          <Button asChild variant="primary">
            <a href="#/app">
              {t('auth.openApp')} <ArrowRightIcon aria-hidden />
            </a>
          </Button>
        ) : (
          <>
            <Button asChild variant="primary">
              <a href="#/register">
                {t('landing.register')} <ArrowRightIcon aria-hidden />
              </a>
            </Button>
            <Button asChild>
              <a href="#/login">{t('auth.signIn')}</a>
            </Button>
          </>
        )}
      </div>
    </section>
  );
}
