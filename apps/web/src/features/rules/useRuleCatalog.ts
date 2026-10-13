import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import type { Destination, RuleDefinition } from '../../api/types';
import { errorMessage } from '../../lib/errorMessage';

/** Active rules per destination. */
export function useRuleCatalog() {
  const [rules, setRules] = useState<Record<Destination, RuleDefinition[]>>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let active = true;
    Promise.all([api.rules('CA'), api.rules('US')]).then(
      ([CA, US]) => active && setRules({ CA, US }),
      (e: unknown) => active && setError(errorMessage(e)),
    );
    return () => {
      active = false;
    };
  }, []);
  return { rules, error };
}
