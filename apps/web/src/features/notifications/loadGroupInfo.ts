import { api } from '../../api/client';
import type { RunGroup } from './groupRuns';
import type { GroupInfo } from './notificationText';

/**
 * The shipment's reference and file names (events carry ids only) and, for a validation with
 * findings, how many are critical. Missing pieces stay missing: the text falls back to generic words.
 */
export async function loadGroupInfo(group: RunGroup): Promise<GroupInfo> {
  const last = group.runs[group.runs.length - 1];
  const wantsValidation = group.outcome === 'validated' && last && (last.findings ?? 0) > 0;
  const [shipment, validation] = await Promise.all([
    api.shipment(group.shipmentId).catch(() => undefined),
    wantsValidation ? api.pastValidation(group.shipmentId, last.runId).catch(() => undefined) : undefined,
  ]);
  return {
    ...(shipment?.reference ? { reference: shipment.reference } : {}),
    fileNames: Object.fromEntries((shipment?.documents ?? []).map((d) => [d.id, d.fileName])),
    ...(validation ? { critical: validation.findings.filter((f) => f.severity === 'CRITICAL').length } : {}),
  };
}
