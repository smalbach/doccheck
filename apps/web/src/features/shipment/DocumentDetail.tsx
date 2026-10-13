import type { ShipmentDocument } from '../../api/types';
import { Button } from '../../components/ui/Button';
import { DOCUMENT_TYPE_LABEL } from '../../constants/documentTypes';
import { pluralize } from '../../lib/pluralize';

export interface DocumentDetailProps {
  doc: ShipmentDocument;
  onShowData: (doc: ShipmentDocument) => void;
}

/** One line under the file name: its type and pages, the extraction error, or that it is still extracting. */
export function DocumentDetail({ doc, onShowData }: DocumentDetailProps) {
  if (doc.status === 'FAILED') return <span className="error">{doc.error}</span>;
  if (doc.status !== 'EXTRACTED') return <>Extracting with the local model…</>;
  return (
    <>
      {DOCUMENT_TYPE_LABEL[doc.detectedType]} · {pluralize(doc.pageCount, 'page')} ·{' '}
      <Button variant="link" size="sm" onClick={() => onShowData(doc)}>
        extracted data
      </Button>
    </>
  );
}
