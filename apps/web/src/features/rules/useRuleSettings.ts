import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client';
import type { PurchaseOrderSummary, RuleSettings } from '../../api/types';
import { errorMessage } from '../../lib/errorMessage';

/** The account's rule settings and purchase orders. */
export function useRuleSettings() {
  const [settings, setSettings] = useState<RuleSettings>();
  const [orders, setOrders] = useState<PurchaseOrderSummary[]>();
  const [error, setError] = useState<string>();
  const load = useCallback(() => {
    let active = true;
    Promise.all([api.ruleSettings(), api.purchaseOrders()]).then(
      ([s, o]) => {
        if (!active) return;
        setSettings(s);
        setOrders(o);
      },
      (e: unknown) => active && setError(errorMessage(e)),
    );
    return () => {
      active = false;
    };
  }, []);
  useEffect(load, [load]);
  return { settings, setSettings, orders, setOrders, error };
}
