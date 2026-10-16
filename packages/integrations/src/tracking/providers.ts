import type { BillOfLading } from '@doccheck/schemas';
import type { ContainerEvent, ContainerEventType, TrackingProvider, TrackingProviderId, TrackingQuery } from './types';

/**
 * Normalizers for the JSON three container-tracking providers return, and providers that fetch it.
 * The shapes follow each provider's public documentation (project44 Ocean v4 tracked shipments,
 * Vizion container events, Terminal49 transport events, a JSON:API document); field names vary by
 * plan and version, so the normalizers read the common spellings and skip what they do not know.
 * Check them against your contract's samples before relying on them.
 */

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : undefined);

/** Maps a provider's event code or description to a milestone. DCSA codes (GTIN, LOAD, DEPA...) included. */
export function eventType(code: string | undefined): ContainerEventType {
  const c = (code ?? '').toUpperCase().replace(/[^A-Z]+/g, '_');
  if (/(^|_)(GTIN|GATE_IN|FULL_IN|RECEIVED|INGATE)(_|$)/.test(c)) return 'GATE_IN';
  if (/(^|_)(LOAD|LOADED|VESSEL_LOADED|LOADED_ON_VESSEL)(_|$)/.test(c)) return 'LOADED';
  if (/(^|_)(DEPA|DEPARTED|DEPARTURE|VESSEL_DEPARTED|DEPARTURE_FROM_STOP)(_|$)/.test(c)) return 'DEPARTED';
  if (/TRANSSHIP/.test(c)) return 'TRANSSHIPPED';
  if (/(^|_)(ARRI|ARRIVED|ARRIVAL|VESSEL_ARRIVED|ARRIVAL_AT_STOP)(_|$)/.test(c)) return 'ARRIVED';
  if (/(^|_)(DISC|DISCHARGED|UNLOADED|VESSEL_DISCHARGED)(_|$)/.test(c)) return 'DISCHARGED';
  if (/(^|_)(GTOT|GATE_OUT|FULL_OUT|OUTGATE)(_|$)/.test(c)) return 'GATE_OUT';
  if (/EMPTY_(RETURN|IN)/.test(c)) return 'EMPTY_RETURN';
  return 'OTHER';
}

const isActual = (v: unknown) => !/^(EST|PLAN|PRED|EXPECT)/i.test(str(v) ?? 'ACTUAL');

/** project44 Ocean: events reference stops (with UN/LOCODE identifiers), equipment and vehicles by id. */
export function fromProject44(body: unknown, containerNumber: string): ContainerEvent[] {
  const b = obj(body);
  const ids = (o: Json, type: string) => arr(o.identifiers).map(obj).find((i) => str(i.type)?.toUpperCase() === type)?.value;
  const stops = new Map(arr(b.stops).map(obj).map((s) => [str(s.id), obj(s.location)]));
  const vehicles = new Map(arr(b.vehicles).map(obj).map((v) => [str(v.id), v]));
  const equipment = new Map(arr(b.transportationEquipment).map(obj).map((e) => [str(e.id), str(ids(e, 'CONTAINER_ID'))]));
  return arr(b.events)
    .map(obj)
    .filter((e) => !e.transportationEquipmentId || equipment.get(str(e.transportationEquipmentId)) === undefined || equipment.get(str(e.transportationEquipmentId)) === containerNumber)
    .map((e) => {
      const loc = stops.get(str(e.stopId)) ?? {};
      const vehicle = vehicles.get(str(e.vehicleId)) ?? {};
      return {
        containerNumber,
        type: eventType(str(e.type)),
        at: str(e.dateTime) ?? '',
        actual: isActual(e.dateTimeType ?? (e.estimated === true ? 'ESTIMATED' : undefined)),
        location: { name: str(loc.name), unLocode: str(ids(loc, 'UN_LOCODE')) },
        vessel: str(vehicle.name) ?? str(obj(e.vessel).name),
        voyage: str(e.voyage) ?? str(e.voyageNumber),
        code: str(e.type),
      };
    })
    .filter((e) => e.at);
}

/** Vizion: { payload: { events: [{ event_code | description, timestamp, location: { name, unlocode }, vessel, voyage, estimated }] } }. */
export function fromVizion(body: unknown, containerNumber: string): ContainerEvent[] {
  const b = obj(body);
  const events = arr(obj(b.payload).events ?? b.events);
  return events
    .map(obj)
    .map((e) => {
      const loc = obj(e.location);
      return {
        containerNumber,
        type: eventType(str(e.event_code) ?? str(e.description)),
        at: str(e.timestamp) ?? str(e.event_time) ?? '',
        actual: e.estimated !== true && isActual(e.event_classifier),
        location: { name: str(loc.name), unLocode: str(loc.unlocode) ?? str(loc.locode) },
        vessel: str(obj(e.vessel).name) ?? str(e.vessel),
        voyage: str(e.voyage) ?? str(e.voyage_number),
        code: str(e.event_code) ?? str(e.description),
      };
    })
    .filter((e) => e.at);
}

/** Terminal49 transport events: JSON:API, with ports and vessels in `included`. */
export function fromTerminal49(body: unknown, containerNumber: string): ContainerEvent[] {
  const b = obj(body);
  const included = new Map(arr(b.included).map(obj).map((i) => [`${str(i.type)}:${str(i.id)}`, obj(i.attributes)]));
  const rel = (e: Json, name: string) => {
    const d = obj(obj(obj(e.relationships)[name]).data);
    return included.get(`${str(d.type)}:${str(d.id)}`) ?? {};
  };
  return arr(b.data)
    .map(obj)
    .filter((e) => !e.type || str(e.type) === 'transport_event')
    .map((e) => {
      const a = obj(e.attributes);
      const port = rel(e, 'location');
      const vessel = rel(e, 'vessel');
      return {
        containerNumber,
        type: eventType(str(a.event)?.replace(/^container\.transport\./, '')),
        at: str(a.timestamp) ?? '',
        actual: true,
        location: { name: str(port.name), unLocode: str(a.location_locode) ?? str(port.code) ?? str(port.locode) },
        vessel: str(vessel.name),
        voyage: str(a.voyage_number),
        code: str(a.event),
      };
    })
    .filter((e) => e.at);
}

const NORMALIZERS: Record<Exclude<TrackingProviderId, 'mock'>, (body: unknown, container: string) => ContainerEvent[]> = {
  project44: fromProject44,
  vizion: fromVizion,
  terminal49: fromTerminal49,
};

const AUTH: Record<Exclude<TrackingProviderId, 'mock'>, (key: string) => Record<string, string>> = {
  project44: (key) => ({ authorization: `Bearer ${key}` }),
  vizion: (key) => ({ 'x-api-key': key }),
  terminal49: (key) => ({ authorization: `Token ${key}` }),
};

export type FetchLike = (url: string, init: { headers: Record<string, string>; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/**
 * A provider read over HTTP: `endpoint` is a URL template with {container}, {bl} and {scac}, set to
 * the provider endpoint that returns a container's events for the account's subscription (each
 * provider needs the container registered for tracking first, which its own console or API does).
 */
export class HttpTrackingProvider implements TrackingProvider {
  constructor(
    readonly id: Exclude<TrackingProviderId, 'mock'>,
    private readonly endpoint: string,
    private readonly apiKey: string,
    private readonly fetchJson: FetchLike,
  ) {}

  async events(q: TrackingQuery): Promise<ContainerEvent[]> {
    const url = this.endpoint
      .replace(/\{container\}/g, encodeURIComponent(q.containerNumber))
      .replace(/\{bl\}/g, encodeURIComponent(q.blNumber ?? ''))
      .replace(/\{scac\}/g, encodeURIComponent(q.scac ?? ''));
    const res = await this.fetchJson(url, { headers: { accept: 'application/json', ...AUTH[this.id](this.apiKey) }, signal: AbortSignal.timeout(15_000) });
    if (res.status === 404) return [];
    if (!res.ok) throw new Error(`${this.id} answered ${res.status}`);
    return NORMALIZERS[this.id](await res.json(), q.containerNumber);
  }
}

/**
 * Events made up from the bill of lading itself, for trying the feature without a provider (and for
 * tests). "consistent": gate-in two days before the on-board date, loaded and departed on the BL's
 * vessel and voyage at its port of loading, so no finding comes out. "conflicting": another vessel and
 * voyage, loaded at Singapore, and a gate-in the day after the on-board date, so every check fires.
 */
export type MockScenario = 'consistent' | 'conflicting';

export function mockEvents(bl: Pick<BillOfLading, 'vessel' | 'voyage' | 'portOfLoading' | 'portOfDischarge' | 'shippedOnBoardDate' | 'dateOfIssue'>, containerNumber: string, scenario: MockScenario): ContainerEvent[] {
  const onBoard = bl.shippedOnBoardDate ?? bl.dateOfIssue ?? new Date().toISOString().slice(0, 10);
  const day = (offset: number) => new Date(Date.parse(`${onBoard}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);
  const conflicting = scenario === 'conflicting';
  const pol = conflicting ? { name: 'Singapore', unLocode: 'SGSIN' } : { name: bl.portOfLoading.name, unLocode: bl.portOfLoading.unLocode };
  const vessel = conflicting ? 'MOCK DIFFERENT VESSEL' : (bl.vessel ?? 'MOCK VESSEL');
  const voyage = conflicting ? '999W' : (bl.voyage ?? '001E');
  return [
    { containerNumber, type: 'GATE_IN', at: `${day(conflicting ? 1 : -2)}T09:00:00Z`, actual: true, location: pol, code: 'GTIN' },
    { containerNumber, type: 'LOADED', at: `${day(0)}T14:00:00Z`, actual: true, location: pol, vessel, voyage, code: 'LOAD' },
    { containerNumber, type: 'DEPARTED', at: `${day(0)}T22:00:00Z`, actual: true, location: pol, vessel, voyage, code: 'DEPA' },
    { containerNumber, type: 'ARRIVED', at: `${day(18)}T06:00:00Z`, actual: false, location: { name: bl.portOfDischarge.name, unLocode: bl.portOfDischarge.unLocode }, vessel, voyage, code: 'ARRI' },
  ];
}

/** Serves `mockEvents` for the bill of lading it is made with. */
export class MockTrackingProvider implements TrackingProvider {
  readonly id = 'mock' as const;
  constructor(
    private readonly bl: Parameters<typeof mockEvents>[0],
    private readonly scenario: MockScenario = 'consistent',
  ) {}

  async events(q: TrackingQuery): Promise<ContainerEvent[]> {
    return mockEvents(this.bl, q.containerNumber, this.scenario);
  }
}
