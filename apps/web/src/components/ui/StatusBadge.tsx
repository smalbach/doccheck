import { useI18n } from '../../i18n/useI18n';
import type { MessageKey } from '../../i18n/keys';
import { Spinner } from './Spinner';

/** Shipment or document status in the interface language; pending states show a spinner. */
export function StatusBadge({ status }: { status: string }) {
  const { t } = useI18n();
  const label = t(`status.${status}` as MessageKey);
  if (status === 'QUEUED' || status === 'EXTRACTING') return <Spinner label={label} />;
  return <span className={`status status-${status}`}>{label}</span>;
}
