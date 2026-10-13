import { ExternalLinkIcon } from '@radix-ui/react-icons';
import type { Finding } from '../../api/types';

export function RegulationQuote({ regulation }: { regulation: NonNullable<Finding['regulation']> }) {
  return (
    <blockquote className="regulation">
      <p>“{regulation.excerpt}”</p>
      <footer>
        <a href={regulation.url} target="_blank" rel="noreferrer">
          {regulation.title} <ExternalLinkIcon aria-label="(opens in a new tab)" />
        </a>
        {regulation.effectiveDate && <span className="muted"> · effective {regulation.effectiveDate}</span>}
      </footer>
    </blockquote>
  );
}
