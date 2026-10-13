import { ExternalLinkIcon } from '@radix-ui/react-icons';
import type { Finding } from '../../api/types';
import { useI18n } from '../../i18n/useI18n';

export function RegulationQuote({ regulation }: { regulation: NonNullable<Finding['regulation']> }) {
  const { t } = useI18n();
  return (
    <blockquote className="regulation" lang="en">
      <p>“{regulation.excerpt}”</p>
      <footer>
        <a href={regulation.url} target="_blank" rel="noreferrer">
          {regulation.title} <ExternalLinkIcon aria-hidden />
          <span className="visually-hidden"> {t('shipment.findings.newTab')}</span>
        </a>
        {regulation.effectiveDate && <span className="muted"> · {t('shipment.findings.effective', { date: regulation.effectiveDate })}</span>}
      </footer>
    </blockquote>
  );
}
