import type { PortalStatus } from '../../api/portal';
import { Spinner } from '../../components/ui/Spinner';
import { Tag } from '../../components/ui/Tag';
import { useI18n } from '../../i18n/useI18n';

/** Where a portal request stands, in the reader's language and voice (the supplier's or the importer's); checking shows a spinner. */
export function PortalStatusTag({ status, importer = false }: { status: PortalStatus; importer?: boolean }) {
  const { t } = useI18n();
  const label = importer ? t(`portal.importerStatus.${status}`) : t(`portal.status.${status}`);
  if (status === 'checking') {
    return (
      <span className="portal-checking">
        <Spinner label={label} />
        <span aria-hidden>{label}</span>
      </span>
    );
  }
  return <Tag tone={status === 'clean' ? 'ok' : status === 'open' || status === 'failed' ? 'accent' : 'neutral'}>{label}</Tag>;
}
