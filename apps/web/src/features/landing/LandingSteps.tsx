import { LANDING_STEPS } from '../../constants/landing';

export function LandingSteps() {
  return (
    <section className="landing-section">
      <h2>How it works</h2>
      <ol className="landing-steps">
        {LANDING_STEPS.map((step, i) => (
          <li key={step.title} className="landing-step">
            <span className="landing-step-number" aria-hidden>
              {i + 1}
            </span>
            <h3>{step.title}</h3>
            <p className="muted">{step.text}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
