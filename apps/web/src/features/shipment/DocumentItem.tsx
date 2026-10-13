import type { ShipmentDocument } from '../../api/types';
import { Button } from '../../components/ui/Button';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { DocumentDetail } from './DocumentDetail';

export interface DocumentItemProps {
  doc: ShipmentDocument;
  onOpen: (doc: ShipmentDocument) => void;
  onShowData: (doc: ShipmentDocument) => void;
}

export function DocumentItem({ doc, onOpen, onShowData }: DocumentItemProps) {
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
    </li>
  );
}
