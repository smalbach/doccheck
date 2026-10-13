import { Spinner } from './Spinner';

/** Shipment or document status, lowercased; pending states show a spinner. */
export function StatusBadge({ status }: { status: string }) {
  if (status === 'QUEUED' || status === 'EXTRACTING') return <Spinner label={status.toLowerCase()} />;
  return <span className={`status status-${status}`}>{status.replace('_', ' ').toLowerCase()}</span>;
}
