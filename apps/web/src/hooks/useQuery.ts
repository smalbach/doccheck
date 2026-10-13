import { useEffect, useRef, useState } from 'react';
import { errorMessage } from '../lib/errorMessage';

/**
 * Loads `load()` whenever `key` changes (put every input of the request in it). The previous result
 * stays while the next one loads, so paging and filtering do not flash a spinner.
 */
export function useQuery<T>(key: string, load: () => Promise<T>) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const latest = useRef(load);
  useEffect(() => {
    latest.current = load;
  });
  useEffect(() => {
    let active = true;
    setLoading(true);
    latest.current().then(
      (result) => {
        if (!active) return;
        setData(result);
        setError(undefined);
        setLoading(false);
      },
      (e: unknown) => {
        if (!active) return;
        setError(errorMessage(e));
        setLoading(false);
      },
    );
    return () => {
      active = false;
    };
  }, [key]);
  return { data, error, loading };
}
