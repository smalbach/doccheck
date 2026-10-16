import { createContext, useContext } from 'react';
import type { Member, ShipmentCollab } from '../../api/teamTypes';

export interface ShipmentCollabState {
  shipmentId: string;
  collab?: ShipmentCollab;
  /** Members to assign and mention (empty for a client, who sees no one). */
  members: Member[];
  setCollab: (collab: ShipmentCollab) => void;
  /** After a decision that may have created or settled an approval request. */
  refresh: () => void;
}

export const ShipmentCollabContext = createContext<ShipmentCollabState | null>(null);

/** Teamwork on the shipment shown, or null outside a shipment page. */
export const useShipmentCollab = () => useContext(ShipmentCollabContext);
