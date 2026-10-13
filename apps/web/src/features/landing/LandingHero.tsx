import { ArrowRightIcon } from '@radix-ui/react-icons';
import { Button } from '../../components/ui/Button';

export function LandingHero({ signedIn }: { signedIn: boolean }) {
  return (
    <section className="landing-hero">
      <p className="landing-eyebrow">For customs brokers and importers · Canada and the US</p>
      <h1>Catch freight document errors before customs does.</h1>
      <p className="landing-lede">
        DocCheck cross-checks the commercial invoice, packing list, bill of lading and ISF, and flags every inconsistency with the line it comes from and the CBSA or CBP rule behind
        it.
      </p>
      <div className="landing-ctas">
        {signedIn ? (
          <Button asChild variant="primary">
            <a href="#/app">
              Open the app <ArrowRightIcon aria-hidden />
            </a>
          </Button>
        ) : (
          <>
            <Button asChild variant="primary">
              <a href="#/register">
                Create a free account <ArrowRightIcon aria-hidden />
              </a>
            </Button>
            <Button asChild>
              <a href="#/login">Sign in</a>
            </Button>
          </>
        )}
      </div>
    </section>
  );
}
