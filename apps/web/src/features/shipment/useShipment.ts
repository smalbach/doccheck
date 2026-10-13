import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../api/client';
import { ApiError } from '../../api/ApiError';
import type { RuleDefinition, Shipment, ShipmentUpdate, Validation } from '../../api/types';
import { useInterval } from '../../hooks/useInterval';
import { useI18n } from '../../i18n/useI18n';
import { errorMessage } from '../../lib/errorMessage';
import { isPdfFile } from '../../lib/isPdfFile';
import { isPendingDocument } from '../../lib/isPendingDocument';
import { navigate } from '../../lib/navigate';

const POLL_MS = 2000;

export type ShipmentBusy = 'upload' | 'validate' | 'delete';

/** A shipment with its last validation and rules, polled while documents extract, and the actions on it. */
export function useShipment(id: string) {
  const { t } = useI18n();
  const [shipment, setShipment] = useState<Shipment>();
  const [validation, setValidation] = useState<Validation>();
  const [rules, setRules] = useState<Record<string, RuleDefinition>>({});
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<ShipmentBusy>();

  const refresh = useCallback(
    () =>
      api.shipment(id).then(setShipment, (e: unknown) => {
        setError(errorMessage(e));
      }),
    [id],
  );

  useEffect(() => {
    void refresh();
    api.validation(id).then(setValidation, () => setValidation(undefined));
  }, [id, refresh]);

  const destination = shipment?.destination;
  useEffect(() => {
    if (!destination) return;
    api.rules(destination).then(
      (list) => setRules(Object.fromEntries(list.map((r) => [r.id, r]))),
      () => undefined,
    );
  }, [destination]);

  const extracting = shipment?.documents.some(isPendingDocument) ?? false;
  useInterval(() => void refresh(), POLL_MS, extracting);

  const run = async (kind: ShipmentBusy, action: () => Promise<void>, describe: (e: unknown) => string = errorMessage) => {
    setBusy(kind);
    setError(undefined);
    try {
      await action();
    } catch (e) {
      setError(describe(e));
    } finally {
      setBusy(undefined);
    }
  };

  const upload = (files: File[]) => {
    const pdfs = files.filter(isPdfFile);
    if (pdfs.length === 0) {
      setError(t('shipment.onlyPdf'));
      return Promise.resolve();
    }
    return run('upload', async () => {
      await api.upload(id, pdfs);
      await refresh();
    });
  };

  const validate = (useAgent: boolean) =>
    run(
      'validate',
      async () => {
        await api.validate(id, useAgent);
        // The stored run, with its id, date and destination (the validate response has the results only).
        setValidation(await api.validation(id));
        await refresh();
      },
      (e) => (e instanceof ApiError && e.status === 409 ? t('shipment.stillExtracting') : errorMessage(e)),
    );

  /** Throws on failure, for the edit dialog to show. */
  const update = async (changes: ShipmentUpdate) => {
    setShipment(await api.update(id, changes));
  };

  const remove = () =>
    run('delete', async () => {
      await api.remove(id);
      navigate('/app/shipments');
    });

  const documents = useMemo(() => new Map((shipment?.documents ?? []).map((d) => [d.id, d])), [shipment]);

  return { shipment, validation, rules, documents, error, setError, busy, extracting, refresh, upload, validate, update, remove };
}
