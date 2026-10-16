import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { ShipmentListQuery, ShipmentPage } from '../api/types';
import { errorMessage } from '../lib/errorMessage';

/**
 * One page of the active organization's shipments, most recent first. The previous page stays shown while
 * the next one loads (`loading`), so paging and filtering do not flash a spinner.
 */
export function useShipmentList({ status, destination, q, due, assignee, limit, offset }: ShipmentListQuery = {}) {
  const [page, setPage] = useState<ShipmentPage>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setLoading(true);
    api.shipments({ status, destination, q, due, assignee, limit, offset }).then(
      (result) => {
        if (!active) return;
        setPage(result);
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
  }, [status, destination, q, due, assignee, limit, offset]);
  return { page, error, loading };
}
