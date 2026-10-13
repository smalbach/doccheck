import type { ShipmentDocument } from '../../api/types';
import type { RunTimeline } from '../../lib/progressTimeline';
import { DocumentItem } from './DocumentItem';

export interface DocumentListProps {
  documents: readonly ShipmentDocument[];
  onOpen: (doc: ShipmentDocument) => void;
  onShowData: (doc: ShipmentDocument) => void;
  /** Latest extraction run per document id. */
  runs: Readonly<Record<string, RunTimeline>>;
}

export function DocumentList({ documents, onOpen, onShowData, runs }: DocumentListProps) {
  if (documents.length === 0) return null;
  return (
    <ul className="documents">
      {documents.map((d) => (
        <DocumentItem key={d.id} doc={d} onOpen={onOpen} onShowData={onShowData} run={runs[d.id]} />
      ))}
    </ul>
  );
}
