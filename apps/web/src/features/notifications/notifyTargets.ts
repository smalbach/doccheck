import type { RunGroup } from './groupRuns';

export interface NotifyContext {
  /** The shipment whose page is open, if any: it already shows its runs ending, so no toast for them. */
  watchingShipmentId?: string;
  /** The tab is visible (document.visibilityState). */
  visible: boolean;
  /** The viewer opted in to browser notifications and the browser allows them. */
  backgroundAllowed: boolean;
}

/**
 * Where to tell that a group of runs ended: a toast unless its shipment's page is open (that page
 * shows the result prominently), a browser notification when DocCheck is in the background and the
 * viewer opted in (any shipment, the open one included: they are not looking).
 */
export function notifyTargets(group: Pick<RunGroup, 'shipmentId'>, ctx: NotifyContext): { toast: boolean; browser: boolean } {
  return {
    toast: group.shipmentId !== ctx.watchingShipmentId,
    browser: !ctx.visible && ctx.backgroundAllowed,
  };
}
