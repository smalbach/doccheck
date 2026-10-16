import { useCallback, useEffect, useMemo, useState } from 'react';
import { teamApi } from '../../api/teamClient';
import type { Member, ShipmentCollab } from '../../api/teamTypes';
import type { ShipmentCollabState } from './ShipmentCollabContext';
import { useOrg } from './useOrg';

/** Loads the shipment's assignees, due date, approvals and comment counts, and the members to pick from. */
export function useShipmentCollabState(shipmentId: string, version?: string): ShipmentCollabState {
  const { can } = useOrg();
  const [collab, setCollab] = useState<ShipmentCollab>();
  const [members, setMembers] = useState<Member[]>([]);
  const [tick, setTick] = useState(0);
  const seesMembers = can('data.read');
  useEffect(() => {
    let active = true;
    teamApi.collab(shipmentId).then((c) => active && setCollab(c), () => undefined);
    return () => {
      active = false;
    };
  }, [shipmentId, version, tick]);
  useEffect(() => {
    if (!seesMembers) return;
    let active = true;
    teamApi.members().then((m) => active && setMembers(m), () => undefined);
    return () => {
      active = false;
    };
  }, [seesMembers]);
  const refresh = useCallback(() => setTick((n) => n + 1), []);
  return useMemo(() => ({ shipmentId, collab, members, setCollab, refresh }), [shipmentId, collab, members, refresh]);
}
