import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api/client';
import { ApiError } from '../../api/ApiError';
import type { ProgressEvent, RuleDefinition, Shipment, ShipmentUpdate, Validation } from '../../api/types';
import { useInterval } from '../../hooks/useInterval';
import { useI18n } from '../../i18n/useI18n';
import { errorMessage } from '../../lib/errorMessage';
import { isPdfFile } from '../../lib/isPdfFile';
import { isPendingDocument } from '../../lib/isPendingDocument';
import { navigate } from '../../lib/navigate';
import { useShipmentEvents } from './useShipmentEvents';

/** Polling while documents extract and the event stream is down; with the stream, a slow safety net. */
const POLL_MS = 2000;
const SAFETY_POLL_MS = 15_000;
/** Events that change what GET /shipments/:id returns come in bursts: refresh once per burst. */
const REFRESH_DEBOUNCE_MS = 250;

/** An extraction event after which the document's status changed: it started, or it ended. */
const changesDocument = (e: ProgressEvent) => e.kind === 'extraction' && ((e.stage === 'queued' && e.status === 'done') || (e.stage === 'saved' && (e.status === 'done' || e.status === 'failed')));
const endsValidation = (e: ProgressEvent) => e.kind === 'validation' && e.stage === 'saved' && (e.status === 'done' || e.status === 'failed');

export type ShipmentBusy = 'upload' | 'validate' | 'delete';

/**
 * A shipment with its last validation and rules, and the actions on it. Live progress events refresh it
 * as documents extract (a slow poll stays as a safety net; a fast one if the stream is down).
 */
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

  // Refresh when a live event says a document or a validation changed (from this tab or another one).
  const refreshTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const validatingHere = useRef(false);
  const onEvent = useCallback(
    (e: ProgressEvent, live: boolean) => {
      if (!live) return;
      if (changesDocument(e)) {
        clearTimeout(refreshTimer.current);
        refreshTimer.current = setTimeout(() => void refresh(), REFRESH_DEBOUNCE_MS);
      }
      if (endsValidation(e) && !validatingHere.current) {
        api.validation(id).then(setValidation, () => undefined);
        void refresh();
      }
    },
    [id, refresh],
  );
  useEffect(() => () => clearTimeout(refreshTimer.current), []);
  const events = useShipmentEvents(id, onEvent);

  const extracting = shipment?.documents.some(isPendingDocument) ?? false;
  useInterval(() => void refresh(), events.connection === 'open' ? SAFETY_POLL_MS : POLL_MS, extracting);

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

  // The event stream is already open, so the stages of this run show live while the call blocks.
  const validate = (useAgent: boolean) =>
    run(
      'validate',
      async () => {
        validatingHere.current = true;
        try {
          await api.validate(id, useAgent);
          // The stored run, with its id, date and destination (the validate response has the results only).
          setValidation(await api.validation(id));
          await refresh();
        } finally {
          validatingHere.current = false;
        }
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

  return { shipment, validation, rules, documents, error, setError, busy, extracting, refresh, upload, validate, update, remove, progress: events.progress, lastLive: events.lastLive };
}
