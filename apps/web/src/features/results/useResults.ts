import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import type { Results } from '../../api/types';
import { errorMessage } from '../../lib/errorMessage';

export function useResults() {
  const [results, setResults] = useState<Results>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let active = true;
    api.results().then(
      (value) => active && setResults(value),
      (e: unknown) => active && setError(errorMessage(e)),
    );
    return () => {
      active = false;
    };
  }, []);
  return { results, error };
}
