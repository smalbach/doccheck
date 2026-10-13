import type { Evidence, ShipmentDocument } from '../../api/types';
import { Button } from '../../components/ui/Button';
import { DOCUMENT_TYPE_LABEL } from '../../constants/documentTypes';
import type { ViewerTarget } from '../pdf/types';

export interface EvidenceItemProps {
  evidence: Evidence;
  doc?: ShipmentDocument;
  onOpen: (target: ViewerTarget) => void;
}

/** One cited value: which document and field, what it says, and a link to the line in the PDF. */
export function EvidenceItem({ evidence, doc, onOpen }: EvidenceItemProps) {
  const { source } = evidence;
  return (
    <li>
      <span className="muted">{doc ? DOCUMENT_TYPE_LABEL[doc.detectedType] : evidence.documentId}</span> <code>{evidence.field}</code>
      {evidence.value ? (
        <>
          {' = '}
          <strong>{evidence.value}</strong>
        </>
      ) : (
        <em className="muted"> missing</em>
      )}
      {doc && source && (
        <Button variant="link" size="sm" className="evidence-link" onClick={() => onOpen({ doc, highlight: { page: source.page, bbox: source.bbox } })}>
          page {source.page} ↗
        </Button>
      )}
    </li>
  );
}
