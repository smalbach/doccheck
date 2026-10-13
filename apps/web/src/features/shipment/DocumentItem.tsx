import type { ShipmentDocument } from '../../api/types';
import { Button } from '../../components/ui/Button';
import { StatusBadge } from '../../components/ui/StatusBadge';
import type { LiveOutput } from '../../lib/liveOutput';
import type { RunTimeline } from '../../lib/progressTimeline';
import { DocumentDetail } from './DocumentDetail';
import { DocumentProgress } from './DocumentProgress';

export interface DocumentItemProps {
  doc: ShipmentDocument;
  onOpen: (doc: ShipmentDocument) => void;
  onShowData: (doc: ShipmentDocument) => void;
  /** Its latest extraction, from the progress events. */
  run?: RunTimeline;
  /** The model's answer while it is written. */
  output?: LiveOutput;
}

export function DocumentItem({ doc, onOpen, onShowData, run, output }: DocumentItemProps) {
  return (
    <li className="document">
      <Button variant="link" className="document-name" onClick={() => onOpen(doc)} disabled={doc.status === 'QUEUED'}>
        {doc.fileName}
      </Button>
      <span className="muted small document-detail">
        <DocumentDetail doc={doc} onShowData={onShowData} />
      </span>
      <span className="document-status">
        <StatusBadge status={doc.status ?? 'EXTRACTED'} />
      </span>
      {run && <DocumentProgress run={run} fileName={doc.fileName} output={output} />}
    </li>
  );
}
