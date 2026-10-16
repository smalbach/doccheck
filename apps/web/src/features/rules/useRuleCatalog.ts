import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import type { Destination, RuleDefinition } from '../../api/types';
import { DESTINATIONS } from '../../constants/destinations';
import { errorMessage } from '../../lib/errorMessage';

/** Active rules per destination. */
export function useRuleCatalog() {
  const [rules, setRules] = useState<Record<Destination, RuleDefinition[]>>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let active = true;
    Promise.all(DESTINATIONS.map((d) => api.rules(d))).then(
      (lists) => active && setRules(Object.fromEntries(DESTINATIONS.map((d, i) => [d, lists[i]])) as Record<Destination, RuleDefinition[]>),
      (e: unknown) => active && setError(errorMessage(e)),
    );
    return () => {
      active = false;
    };
  }, []);
  return { rules, error };
}
