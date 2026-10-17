import { useCallback, useEffect, useState } from 'react';
import { dutiesApi } from '../../api/duties';
import type { DutiesView, DutyInputs } from '../../api/dutyTypes';
import { errorMessage } from '../../lib/errorMessage';

export interface DutiesState {
  view?: DutiesView;
  error?: string;
  busy: boolean;
  /** Saves the answers (or, in the demo, only recalculates with them). */
  submit: (inputs: DutyInputs) => Promise<boolean>;
}

/**
 * The shipment's duty estimate. Reloaded when `version` changes (a document extracted or corrected,
 * a new validation, another destination), since it is computed from the current documents.
 */
export function useDuties(shipmentId: string, version: string, enabled: boolean, demo: boolean): DutiesState {
  const [view, setView] = useState<DutiesView>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    dutiesApi.get(shipmentId).then(
      (v) => live && (setView(v), setError(undefined)),
      (e) => live && setError(errorMessage(e)),
    );
    return () => {
      live = false;
    };
  }, [shipmentId, version, enabled]);

  const submit = useCallback(
    async (inputs: DutyInputs) => {
      setBusy(true);
      try {
        setView(await (demo ? dutiesApi.preview(shipmentId, inputs) : dutiesApi.save(shipmentId, inputs)));
        setError(undefined);
        return true;
      } catch (e) {
        setError(errorMessage(e));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [shipmentId, demo],
  );

  return { view, error, busy, submit };
}
