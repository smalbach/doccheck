import { CameraIcon } from '@radix-ui/react-icons';
import { useState, type FormEvent } from 'react';
import type { Destination } from '../../api/types';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Field } from '../../components/ui/Field';
import { Select } from '../../components/ui/Select';
import { TextInput } from '../../components/ui/TextInput';
import { DESTINATION_OPTION_KEY, DESTINATIONS } from '../../constants/destinations';
import { useI18n } from '../../i18n/useI18n';
import { CameraCaptureDialog } from '../capture/CameraCaptureDialog';

export interface NewShipmentInput {
  destination: Destination;
  reference?: string;
}

export interface NewShipmentCardProps {
  busy: boolean;
  /** The scanned PDF is being uploaded to the new shipment. */
  scanning: boolean;
  disabled: boolean;
  onCreate: (input: NewShipmentInput) => void;
  /** Creates the shipment with the PDF made from the camera scan. */
  onScan: (input: NewShipmentInput, pdf: File) => void;
}

export function NewShipmentCard({ busy, scanning, disabled, onCreate, onScan }: NewShipmentCardProps) {
  const { t } = useI18n();
  const [destination, setDestination] = useState<Destination>('CA');
  const [reference, setReference] = useState('');
  const [scanOpen, setScanOpen] = useState(false);
  const options = DESTINATIONS.map((d) => ({ value: d, label: t(DESTINATION_OPTION_KEY[d]) }));

  const input = (): NewShipmentInput => ({ destination, reference: reference.trim() || undefined });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onCreate(input());
  };

  return (
    <Card title={t('newShipment.cardTitle')}>
      <p className="muted">{t('newShipment.cardText')}</p>
      <form className="form-row" onSubmit={submit} aria-busy={busy || scanning}>
        <Field label={t('newShipment.destination')}>{(id) => <Select id={id} value={destination} options={options} onValueChange={setDestination} />}</Field>
        <Field label={t('newShipment.reference')} grow>
          {(id) => <TextInput id={id} value={reference} onChange={(e) => setReference(e.target.value)} placeholder={t('newShipment.referencePlaceholder')} />}
        </Field>
        <Button type="submit" variant="primary" disabled={disabled}>
          {busy ? t('newShipment.creating') : t('newShipment.create')}
        </Button>
        <CameraCaptureDialog
          open={scanOpen}
          onOpenChange={setScanOpen}
          onDone={(pdf) => {
            setScanOpen(false);
            onScan(input(), pdf);
          }}
          trigger={
            <Button disabled={disabled}>
              <CameraIcon aria-hidden /> {scanning ? t('capture.uploading') : t('capture.open')}
            </Button>
          }
        />
      </form>
      <p className="muted capture-hint">{t('capture.hint')}</p>
    </Card>
  );
}
