import { Pencil1Icon } from '@radix-ui/react-icons';
import { Dialog } from 'radix-ui';
import { useState, type FormEvent } from 'react';
import type { Destination, Shipment, ShipmentUpdate, TransportMode } from '../../api/types';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Field } from '../../components/ui/Field';
import { Select } from '../../components/ui/Select';
import { TextInput } from '../../components/ui/TextInput';
import { DESTINATION_OPTION_KEY, DESTINATIONS } from '../../constants/destinations';
import { TRANSPORT_MODE_KEY, TRANSPORT_MODES } from '../../constants/transportModes';
import { useI18n } from '../../i18n/useI18n';
import { errorMessage } from '../../lib/errorMessage';
import { shipmentChanges } from '../../lib/shipmentChanges';

export interface EditShipmentDialogProps {
  shipment: Shipment;
  /** Documents are extracting: the destination cannot change until they are done. */
  extracting: boolean;
  onSave: (changes: ShipmentUpdate) => Promise<void>;
}

/** Reference, destination and transport mode. Past validations stay as they were, as history. */
export function EditShipmentDialog({ shipment, extracting, onSave }: EditShipmentDialogProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [reference, setReference] = useState('');
  const [destination, setDestination] = useState<Destination>('CA');
  const [transportMode, setTransportMode] = useState<TransportMode>('SEA');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  const openWith = (next: boolean) => {
    if (next) {
      setReference(shipment.reference ?? '');
      setDestination(shipment.destination ?? 'CA');
      setTransportMode(shipment.transportMode ?? 'SEA');
      setError(undefined);
    }
    setOpen(next);
  };

  const changes = shipmentChanges(shipment, { reference, destination, transportMode });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!changes) return setOpen(false);
    setSaving(true);
    setError(undefined);
    try {
      await onSave(changes);
      setOpen(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={openWith}>
      <Dialog.Trigger asChild>
        <Button className="no-print">
          <Pencil1Icon aria-hidden /> {t('shipment.edit.button')}
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog">
          <Dialog.Title className="dialog-title">{t('shipment.edit.title')}</Dialog.Title>
          <Dialog.Description className="dialog-description">{t('shipment.edit.text')}</Dialog.Description>
          <form className="stack-form" onSubmit={submit} aria-busy={saving}>
            <Field label={t('newShipment.reference')}>
              {(id) => <TextInput id={id} value={reference} maxLength={200} onChange={(e) => setReference(e.target.value)} placeholder={t('newShipment.referencePlaceholder')} />}
            </Field>
            <Field label={t('newShipment.destination')}>
              {(id) => (
                <Select id={id} value={destination} disabled={extracting} options={DESTINATIONS.map((d) => ({ value: d, label: t(DESTINATION_OPTION_KEY[d]) }))} onValueChange={setDestination} />
              )}
            </Field>
            {extracting && <p className="muted small">{t('shipment.edit.destinationWait')}</p>}
            {changes?.destination && <p className="muted small">{t('shipment.edit.destinationNote')}</p>}
            <Field label={t('shipment.edit.transportMode')}>
              {(id) => <Select id={id} value={transportMode} options={TRANSPORT_MODES.map((m) => ({ value: m, label: t(TRANSPORT_MODE_KEY[m]) }))} onValueChange={setTransportMode} />}
            </Field>
            {error && <Banner tone="error">{error}</Banner>}
            <div className="dialog-actions">
              <Dialog.Close asChild>
                <Button>{t('common.cancel')}</Button>
              </Dialog.Close>
              <Button type="submit" variant="primary" disabled={saving}>
                {saving ? t('common.saving') : t('common.save')}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
