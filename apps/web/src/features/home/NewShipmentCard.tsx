import { useState, type FormEvent } from 'react';
import type { Destination } from '../../api/types';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Field } from '../../components/ui/Field';
import { Select } from '../../components/ui/Select';
import { TextInput } from '../../components/ui/TextInput';
import { DESTINATION_OPTIONS } from '../../constants/destinations';

export interface NewShipmentCardProps {
  busy: boolean;
  disabled: boolean;
  onCreate: (input: { destination: Destination; reference?: string }) => void;
}

export function NewShipmentCard({ busy, disabled, onCreate }: NewShipmentCardProps) {
  const [destination, setDestination] = useState<Destination>('CA');
  const [reference, setReference] = useState('');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onCreate({ destination, reference: reference.trim() || undefined });
  };

  return (
    <Card title="New shipment">
      <p className="muted">Create a shipment, upload its commercial invoice, packing list and bill of lading as PDFs, then validate.</p>
      <form className="form-row" onSubmit={submit}>
        <Field label="Destination">{(id) => <Select id={id} value={destination} options={DESTINATION_OPTIONS} onValueChange={setDestination} />}</Field>
        <Field label="Reference" grow>
          {(id) => <TextInput id={id} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. PO-4411 / booking" />}
        </Field>
        <Button type="submit" variant="primary" disabled={disabled}>
          {busy ? 'Creating…' : 'Create'}
        </Button>
      </form>
    </Card>
  );
}
