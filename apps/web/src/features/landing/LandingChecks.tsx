import { CheckIcon } from '@radix-ui/react-icons';
import { LANDING_CHECKS } from '../../constants/landing';

export function LandingChecks() {
  return (
    <section className="landing-section landing-checks">
      <div>
        <h2>What it checks</h2>
        <p className="muted">
          Fifteen rules run on every shipment, measured on 200 synthetic shipments with known errors. The numbers, and how they were measured, are on the Evaluation page.
        </p>
      </div>
      <ul className="check-list">
        {LANDING_CHECKS.map((c) => (
          <li key={c}>
            <CheckIcon aria-hidden /> {c}
          </li>
        ))}
      </ul>
    </section>
  );
}
