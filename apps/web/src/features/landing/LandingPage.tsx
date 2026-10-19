import { AppFooter } from '../../components/layout/AppFooter';
import { PublicHeader } from '../../components/layout/PublicHeader';
import { SkipLink } from '../../components/layout/SkipLink';
import { useAuth } from '../auth/useAuth';
import { LandingCallToAction } from './LandingCallToAction';
import { LandingChecks } from './LandingChecks';
import { LandingFeatures } from './LandingFeatures';
import { LandingHero } from './LandingHero';
import { LandingSteps } from './LandingSteps';

export function LandingPage() {
  const signedIn = !!useAuth().user;
  // At /index.html the app sits behind the product page served at / (apps/api/src/landing.ts, the
  // hosted demo): that page is the home, so the logo and signing out lead there.
  if (window.location.pathname === '/index.html') {
    window.location.replace('/');
    return null;
  }
  return (
    <div className="public-page">
      <SkipLink />
      <PublicHeader />
      <main className="landing" id="main-content" tabIndex={-1}>
        <LandingHero signedIn={signedIn} />
        <LandingSteps />
        <LandingFeatures />
        <LandingChecks />
        <LandingCallToAction signedIn={signedIn} />
      </main>
      <AppFooter />
    </div>
  );
}
