import type { IsfFiling } from '../../api/types';
import { Button } from '../../components/ui/Button';

export function IsfSource({ isf, onOpen }: { isf: IsfFiling; onOpen: (documentId: string) => void }) {
  if (isf.source === 'pdf' && isf.documentId) {
    const documentId = isf.documentId;
    return (
      <>
        From PDF{' '}
        <Button variant="link" size="sm" onClick={() => onOpen(documentId)}>
          {isf.fileName ?? 'document'}
        </Button>
      </>
    );
  }
  return <>{isf.source === 'sample' ? 'From the sample' : 'Uploaded as JSON'}</>;
}
