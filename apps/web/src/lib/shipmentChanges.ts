import type { Shipment, ShipmentUpdate } from '../api/types';

/** The fields of the form that differ from the shipment, or undefined when nothing changed. An empty reference clears it. */
export function shipmentChanges(shipment: Shipment, form: Required<Omit<ShipmentUpdate, 'reference'>> & { reference: string }): ShipmentUpdate | undefined {
  const changes: ShipmentUpdate = {};
  const reference = form.reference.trim();
  if (reference !== (shipment.reference ?? '')) changes.reference = reference || null;
  if (form.destination !== shipment.destination) changes.destination = form.destination;
  if (form.transportMode !== shipment.transportMode) changes.transportMode = form.transportMode;
  return Object.keys(changes).length ? changes : undefined;
}
