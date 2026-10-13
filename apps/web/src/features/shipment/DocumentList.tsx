import type { ShipmentDocument } from '../../api/types';
import { DocumentItem } from './DocumentItem';

export interface DocumentListProps {
  documents: readonly ShipmentDocument[];
  onOpen: (doc: ShipmentDocument) => void;
  onShowData: (doc: ShipmentDocument) => void;
}

export function DocumentList({ documents, onOpen, onShowData }: DocumentListProps) {
  if (documents.length === 0) return null;
  return (
    <ul className="documents">
      {documents.map((d) => (
        <DocumentItem key={d.id} doc={d} onOpen={onOpen} onShowData={onShowData} />
      ))}
    </ul>
  );
}
