import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import type { Validation, ValidationSummary } from '../../api/types';
import { errorMessage } from '../../lib/errorMessage';

/**
 * The shipment's validation runs, reloaded when a new one becomes the latest, and the past run being
 * looked at, if any (undefined means the latest).
 */
export function useValidationHistory(shipmentId: string, latestId: string | undefined) {
  const [runs, setRuns] = useState<ValidationSummary[]>([]);
  const [past, setPast] = useState<Validation>();
  const [loadingId, setLoadingId] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!latestId) return undefined;
    let active = true;
    setPast(undefined);
    api.validations(shipmentId).then(
      (list) => active && setRuns(list),
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [shipmentId, latestId]);

  const show = async (validationId: string) => {
    if (validationId === latestId) {
      setPast(undefined);
      return;
    }
    setLoadingId(validationId);
    setError(undefined);
    try {
      setPast(await api.pastValidation(shipmentId, validationId));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoadingId(undefined);
    }
  };

  return { runs, past, show, showLatest: () => setPast(undefined), loadingId, error };
}
