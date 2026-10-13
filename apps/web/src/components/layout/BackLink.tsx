import { useI18n } from '../../i18n/useI18n';

export interface BackLinkProps {
  /** Defaults to the shipments list. */
  href?: string;
  label?: string;
}

export function BackLink({ href = '#/app/shipments', label }: BackLinkProps) {
  const { t } = useI18n();
  return (
    <a href={href} className="back-link">
      {label ?? t('app.backToShipments')}
    </a>
  );
}
