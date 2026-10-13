import { useEffect, useState } from 'react';
import { errorMessage } from '../../lib/errorMessage';
import { pdfjs } from './pdfjs';

/** Loads a PDF; the previous one is destroyed when the URL changes or the viewer closes. */
export function usePdfDocument(url: string) {
  const [pdf, setPdf] = useState<pdfjs.PDFDocumentProxy>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let active = true;
    setPdf(undefined);
    setError(undefined);
    const task = pdfjs.getDocument({ url });
    task.promise.then(
      (doc) => active && setPdf(doc),
      (e: unknown) => active && setError(errorMessage(e)),
    );
    return () => {
      active = false;
      void task.destroy();
    };
  }, [url]);
  return { pdf, error };
}
