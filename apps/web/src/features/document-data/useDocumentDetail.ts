import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import type { DocumentDetail } from '../../api/types';
import { errorMessage } from '../../lib/errorMessage';

/** What the extraction read from one document; `setDetail` takes the detail returned by a correction. */
export function useDocumentDetail(shipmentId: string, documentId: string) {
  const [detail, setDetail] = useState<DocumentDetail>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let active = true;
    api.document(shipmentId, documentId).then(
      (value) => active && setDetail(value),
      (e: unknown) => active && setError(errorMessage(e)),
    );
    return () => {
      active = false;
    };
  }, [shipmentId, documentId]);
  return { detail, setDetail, error };
}
