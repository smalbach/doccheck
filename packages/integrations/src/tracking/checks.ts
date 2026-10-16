import type { BillOfLading, Finding } from '@doccheck/schemas';
import type { ContainerEvent, TrackingProviderId } from './types';

/**
 * Consistency of the bill of lading with what the carrier's terminals reported for its containers.
 * Deterministic: the same BL and events give the same findings. Only actual events count (never
 * estimates), and a check with nothing to compare on one side is skipped, never guessed.
 *
 * T1 vessel/voyage: the container was loaded on another vessel or voyage than the BL names.
 * T2 port of loading: the container was first loaded at another port than the BL's port of loading.
 * T3 gate-in after on board: the container entered the terminal after the BL's shipped-on-board
 *    date, which is impossible for a correct on-board date (backdated or wrong BL).
 */
export const TRACKING_RULES = {
  T1: 'Vessel or voyage on the BL differs from the carrier events',
  T2: 'Port of loading on the BL differs from where the container was loaded',
  T3: 'Container gated in after the BL shipped-on-board date',
} as const;

/** The pseudo document id tracking evidence cites: "tracking:<provider>". */
export const trackingDocumentId = (provider: TrackingProviderId) => `tracking:${provider}`;

/** "M/V Ever Given", "EVER-GIVEN" and "ever given" are the same vessel. */
export const normalizeVessel = (v: string) =>
  v
    .toUpperCase()
    .replace(/^(M\/?V|MV|MS|M\/S)[\s.]+/, '')
    .replace(/[^A-Z0-9]+/g, '');
/** "012E", "12E" and "0012 E" are the same voyage. */
export const normalizeVoyage = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]+/g, '').replace(/^0+(?=\d)/, '');
const normalizeName = (v: string) => v.toUpperCase().replace(/[^A-Z]+/g, '');

/** The calendar date of an event as the terminal reported it (its own offset, not UTC). */
const localDate = (iso: string) => iso.slice(0, 10);

export function trackingFindings(shipmentId: string, bl: { id: string; data: BillOfLading }, events: ContainerEvent[], provider: TrackingProviderId): Finding[] {
  const findings: Finding[] = [];
  const doc = trackingDocumentId(provider);
  const add = (ruleId: keyof typeof TRACKING_RULES, f: Omit<Finding, 'id' | 'shipmentId' | 'ruleId' | 'decidedBy'>) =>
    findings.push({ id: `${shipmentId}:${ruleId}:${findings.filter((x) => x.ruleId === ruleId).length}`, shipmentId, ruleId, decidedBy: 'RULE', ...f });
  const byContainer = new Map<string, ContainerEvent[]>();
  for (const e of events.filter((e) => e.actual)) byContainer.set(e.containerNumber, [...(byContainer.get(e.containerNumber) ?? []), e]);

  bl.data.containers.forEach((container, i) => {
    const list = (byContainer.get(container.number) ?? []).sort((a, b) => a.at.localeCompare(b.at));
    if (!list.length) return;
    const field = (name: string) => `containers[${i}].events.${name}`;
    // The first loading is at the port of loading; later ones are transshipments.
    const load = list.find((e) => e.type === 'LOADED') ?? list.find((e) => e.type === 'DEPARTED');

    // T1: compare with the first loading's vessel and voyage when both sides have them.
    if (load) {
      const vesselDiffers = !!(bl.data.vessel && load.vessel && normalizeVessel(bl.data.vessel) !== normalizeVessel(load.vessel));
      const voyageDiffers = !!(bl.data.voyage && load.voyage && normalizeVoyage(bl.data.voyage) !== normalizeVoyage(load.voyage));
      if (vesselDiffers || voyageDiffers) {
        add('T1', {
          severity: 'HIGH',
          message: `Container ${container.number} was loaded on ${[load.vessel, load.voyage && `voyage ${load.voyage}`].filter(Boolean).join(' ')} (${provider}), but the bill of lading says ${[bl.data.vessel, bl.data.voyage && `voyage ${bl.data.voyage}`].filter(Boolean).join(' ')}.`,
          evidence: [
            ...(vesselDiffers ? [{ documentId: bl.id, field: 'vessel', value: bl.data.vessel! }, { documentId: doc, field: field('loaded.vessel'), value: load.vessel! }] : []),
            ...(voyageDiffers ? [{ documentId: bl.id, field: 'voyage', value: bl.data.voyage! }, { documentId: doc, field: field('loaded.voyage'), value: load.voyage! }] : []),
          ],
          suggestedFix: 'Ask the carrier which sailing the container is on; if the cargo was rolled to another vessel, have the bill of lading and the manifest corrected.',
        });
      }
    }

    // T2: UN/LOCODEs when both sides have one, else the port names.
    const pol = bl.data.portOfLoading;
    const at = load?.location;
    if (load && at && (at.unLocode || at.name)) {
      const differs = pol.unLocode && at.unLocode ? pol.unLocode.toUpperCase() !== at.unLocode.toUpperCase() : !!(at.name && normalizeName(pol.name) !== normalizeName(at.name));
      if (differs) {
        const printed = pol.unLocode && at.unLocode ? { bl: pol.unLocode, ev: at.unLocode } : { bl: pol.name, ev: at.name! };
        add('T2', {
          severity: 'HIGH',
          message: `Container ${container.number} was loaded at ${at.name ?? at.unLocode}${at.unLocode && at.name ? ` (${at.unLocode})` : ''}, but the bill of lading's port of loading is ${pol.name}${pol.unLocode ? ` (${pol.unLocode})` : ''}.`,
          evidence: [
            { documentId: bl.id, field: pol.unLocode && at.unLocode ? 'portOfLoading.unLocode' : 'portOfLoading.name', value: printed.bl },
            { documentId: doc, field: field(pol.unLocode && at.unLocode ? 'loaded.location.unLocode' : 'loaded.location.name'), value: printed.ev },
          ],
          suggestedFix: 'Confirm the port of loading with the carrier and have the bill of lading corrected; the port of loading drives the manifest and the origin checks.',
        });
      }
    }

    // T3: the first gate-in, by the terminal's calendar date, after the on-board date.
    const gateIn = list.find((e) => e.type === 'GATE_IN');
    const onBoard = bl.data.shippedOnBoardDate;
    if (gateIn && onBoard && localDate(gateIn.at) > onBoard) {
      add('T3', {
        severity: 'HIGH',
        message: `Container ${container.number} entered the terminal on ${localDate(gateIn.at)} (${provider}), after the bill of lading's shipped-on-board date ${onBoard}.`,
        evidence: [
          { documentId: bl.id, field: 'shippedOnBoardDate', value: onBoard },
          { documentId: doc, field: field('gateIn.date'), value: localDate(gateIn.at) },
        ],
        suggestedFix: 'An on-board date before the container reached the port cannot be right: ask the carrier for the actual on-board date and a corrected bill of lading.',
      });
    }
  });
  return findings;
}
