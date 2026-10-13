import { Button } from '../../components/ui/Button';

export function LandingCallToAction({ signedIn }: { signedIn: boolean }) {
  return (
    <section className="landing-cta">
      <h2>Try it on a sample in under a minute</h2>
      <p className="muted">Synthetic shipments with known errors are ready to open once you sign in.</p>
      <Button asChild variant="primary">
        <a href={signedIn ? '#/app/samples' : '#/register'}>{signedIn ? 'Open the samples' : 'Get started'}</a>
      </Button>
    </section>
  );
}
