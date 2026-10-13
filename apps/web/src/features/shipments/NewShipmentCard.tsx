import { useState, type FormEvent } from 'react';
import type { Destination } from '../../api/types';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Field } from '../../components/ui/Field';
import { Select } from '../../components/ui/Select';
import { TextInput } from '../../components/ui/TextInput';
import { DESTINATION_OPTION_KEY, DESTINATIONS } from '../../constants/destinations';
import { useI18n } from '../../i18n/useI18n';

export interface NewShipmentCardProps {
  busy: boolean;
  disabled: boolean;
  onCreate: (input: { destination: Destination; reference?: string }) => void;
}

export function NewShipmentCard({ busy, disabled, onCreate }: NewShipmentCardProps) {
  const { t } = useI18n();
  const [destination, setDestination] = useState<Destination>('CA');
  const [reference, setReference] = useState('');
  const options = DESTINATIONS.map((d) => ({ value: d, label: t(DESTINATION_OPTION_KEY[d]) }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onCreate({ destination, reference: reference.trim() || undefined });
  };

  return (
    <Card title={t('newShipment.cardTitle')}>
      <p className="muted">{t('newShipment.cardText')}</p>
      <form className="form-row" onSubmit={submit} aria-busy={busy}>
        <Field label={t('newShipment.destination')}>{(id) => <Select id={id} value={destination} options={options} onValueChange={setDestination} />}</Field>
        <Field label={t('newShipment.reference')} grow>
          {(id) => <TextInput id={id} value={reference} onChange={(e) => setReference(e.target.value)} placeholder={t('newShipment.referencePlaceholder')} />}
        </Field>
        <Button type="submit" variant="primary" disabled={disabled}>
          {busy ? t('newShipment.creating') : t('newShipment.create')}
        </Button>
      </form>
    </Card>
  );
}
