import { AppFooter } from '../../components/layout/AppFooter';
import { PublicHeader } from '../../components/layout/PublicHeader';
import { useAuth } from '../auth/useAuth';
import { LandingCallToAction } from './LandingCallToAction';
import { LandingChecks } from './LandingChecks';
import { LandingFeatures } from './LandingFeatures';
import { LandingHero } from './LandingHero';
import { LandingSteps } from './LandingSteps';

export function LandingPage() {
  const signedIn = !!useAuth().user;
  return (
    <div className="public-page">
      <PublicHeader />
      <main className="landing">
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
