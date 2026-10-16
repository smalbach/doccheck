import type { RuleDefinition, ShipmentContext } from '@doccheck/rules';
import type { Evidence, Finding, Party } from '@doccheck/schemas';
import { FORCED_LABOUR_BASIS, highRiskSector, xinjiangTerm } from './forced-labour';
import type { Match, ScreeningIndex } from './matcher';
import { LISTS } from './sources';
import { displayName, partyKey } from './text';
import { DEFAULT_THRESHOLDS, type AllowlistEntry, type ScreeningThresholds } from './types';

export const SCREENING_RULES: RuleDefinition[] = [
  { id: 'S1', title: 'Party is on a denied or restricted party list', appliesTo: 'ALL', requires: [], kind: 'DETERMINISTIC', severity: 'HIGH' },
  { id: 'S2', title: 'Party may be on a denied or restricted party list: review', appliesTo: 'ALL', requires: [], kind: 'DETERMINISTIC', severity: 'MEDIUM' },
  { id: 'S3', title: 'Forced-labour risk: Xinjiang link or high-risk goods from China (UFLPA)', appliesTo: 'ALL', requires: [], kind: 'DETERMINISTIC', severity: 'MEDIUM' },
];

/** Where parties are on each document, and what the role is called in a finding. */
const ROLES = {
  invoice: [['seller', 'seller'], ['buyer', 'buyer'], ['consignee', 'consignee'], ['exporter', 'exporter'], ['originator', 'originator']],
  packingList: [['seller', 'seller'], ['consignee', 'consignee']],
  billOfLading: [['shipper', 'shipper'], ['consignee', 'consignee'], ['notifyParty', 'notify party']],
  isf: [['seller', 'seller'], ['buyer', 'buyer'], ['manufacturer', 'manufacturer'], ['shipToParty', 'ship-to party'], ['consolidator', 'consolidator']],
} as const;

const DOC_LABEL = { invoice: 'invoice', packingList: 'packing list', billOfLading: 'BL', isf: 'ISF' } as const;

/** One party as it appears across the shipment's documents: same name (after normalization) = same party. */
export interface ScreenedParty {
  key: string;
  name: string;
  country?: string;
  city?: string;
  /** Every place it is printed: document, field and role. */
  seen: { documentId: string; doc: keyof typeof ROLES; field: string; role: string; party: Party }[];
}

/** Every named party of the shipment, grouped by normalized name. "TO ORDER" consignees are not parties. */
export function shipmentParties(ctx: ShipmentContext): ScreenedParty[] {
  const parties = new Map<string, ScreenedParty>();
  for (const doc of Object.keys(ROLES) as (keyof typeof ROLES)[]) {
    const slot = ctx[doc];
    if (!slot) continue;
    for (const [field, role] of ROLES[doc]) {
      const party = (slot.data as unknown as Record<string, Party | undefined>)[field];
      if (!party?.name?.trim() || /^TO (THE )?ORDER\b/i.test(party.name.trim())) continue;
      const key = partyKey(party.name);
      if (!key) continue;
      const p = parties.get(key) ?? { key, name: party.name, seen: [] };
      p.country ??= party.address?.country;
      p.city ??= party.address?.city;
      p.seen.push({ documentId: slot.id, doc, field, role, party });
      parties.set(key, p);
    }
  }
  return [...parties.values()];
}

/** A borderline match the agent may compare (never a strong one: those stand until a person decides). */
export interface ScreeningQuestion {
  findingId: string;
  party: string;
  entry: string;
}

/** The list entry behind an S1 or S2 finding. */
export interface ScreeningHit {
  findingId: string;
  ruleId: 'S1' | 'S2';
  party: string;
  partyKey: string;
  list: string;
  entryId: string;
  entryName: string;
  matchedName: string;
  score: number;
}

export interface ScreeningOutput {
  findings: Finding[];
  hits: ScreeningHit[];
  /** S2 findings with the two descriptions to compare. */
  questions: ScreeningQuestion[];
  /** Matches set aside by the allowlist, for the record. */
  allowlisted: { party: string; list: string; entryId: string; score: number }[];
  /** Parties screened. */
  parties: number;
}

export interface ScreenOptions {
  thresholds?: Partial<ScreeningThresholds>;
  allowlist?: readonly AllowlistEntry[];
  /** Version date per list id, cited with the match. */
  versions?: Record<string, string>;
  /** At most this many list findings per party (the best lists first). */
  perParty?: number;
}

const describeEntry = (m: Match) => {
  const e = m.entry;
  const where = e.addresses[0]?.text ?? (e.countries.length ? e.countries.join(', ') : undefined);
  const name = displayName(e);
  const aka = [e.name, ...e.aliases].filter((a) => a !== name).slice(0, 4);
  return [name, aka.length ? `also known as ${aka.join('; ')}` : undefined, where].filter(Boolean).join(', ');
};

export const describeParty = (p: Party) =>
  [p.name, ...p.address.lines, [p.address.city, p.address.region, p.address.postalCode].filter(Boolean).join(' '), p.address.country].filter(Boolean).join(', ');

const listEvidence = (p: ScreenedParty): Evidence[] => p.seen.map((s) => ({ documentId: s.documentId, field: `${s.field}.name`, value: s.party.name }));

const roles = (p: ScreenedParty) => [...new Set(p.seen.map((s) => `${DOC_LABEL[s.doc]} ${s.role}`))].join(', ');

/**
 * S1 and S2: every named party (seller and shipper, buyer, consignee, notify party, exporter,
 * ISF manufacturer, ship-to and consolidator) against every cached list. S1 at or above the match
 * threshold, S2 in the review band below it; one finding per party and list, best entry. A match
 * on the allowlist of the shipment's account is set aside and reported in `allowlisted`.
 *
 * S3: forced-labour risk. A party named or located in Xinjiang (goods of Chinese origin or a party
 * in China), and invoice lines of Chinese origin in a sector CBP's UFLPA enforcement prioritizes
 * (cotton, apparel, polysilicon, tomatoes). Parties on the UFLPA Entity List come through S1/S2.
 */
export function screenShipment(ctx: ShipmentContext, index: ScreeningIndex | undefined, opts: ScreenOptions = {}): ScreeningOutput {
  const thresholds = { ...DEFAULT_THRESHOLDS, ...opts.thresholds };
  const review = Math.min(thresholds.review, thresholds.match);
  const allow = new Set((opts.allowlist ?? []).map((a) => `${a.partyKey}|${a.list}|${a.entryId}`));
  const out: ScreeningOutput = { findings: [], hits: [], questions: [], allowlisted: [], parties: 0 };
  const counts: Record<string, number> = {};
  const push = (f: Omit<Finding, 'id' | 'shipmentId' | 'decidedBy'>) => {
    const i = counts[f.ruleId] ?? 0;
    counts[f.ruleId] = i + 1;
    const finding: Finding = { id: `${ctx.shipmentId}:${f.ruleId}:${i}`, shipmentId: ctx.shipmentId, decidedBy: 'RULE', ...f };
    out.findings.push(finding);
    return finding;
  };

  const parties = shipmentParties(ctx);
  out.parties = parties.length;
  if (index) {
    for (const p of parties) {
      const matches = index.search({ name: p.name, country: p.country, city: p.city }, { minScore: review, limit: 25 });
      const perList = new Map<string, Match>();
      for (const m of matches) {
        if (allow.has(`${p.key}|${m.entry.list}|${m.entry.id}`)) {
          out.allowlisted.push({ party: p.name, list: m.entry.list, entryId: m.entry.id, score: m.score });
          continue;
        }
        if (!perList.has(m.entry.list)) perList.set(m.entry.list, m);
      }
      for (const m of [...perList.values()].slice(0, opts.perParty ?? 5)) {
        const info = LISTS[m.entry.list];
        const strong = m.score >= thresholds.match;
        const listName = info?.name ?? m.entry.list;
        const version = opts.versions?.[m.entry.list];
        const finding = push({
          ruleId: strong ? 'S1' : 'S2',
          severity: strong ? 'HIGH' : 'MEDIUM',
          message: strong
            ? `${p.name} (${roles(p)}) matches "${m.matchedName}" on the ${listName} (score ${m.score.toFixed(2)}).`
            : `${p.name} (${roles(p)}) resembles "${m.matchedName}" on the ${listName} (score ${m.score.toFixed(2)}); review whether it is the same party.`,
          evidence: listEvidence(p),
          regulation: {
            title: `${listName}: ${displayName(m.entry)}${m.entry.list === 'dhs-uflpa' ? ' (UFLPA Entity List)' : ''}`,
            url: m.entry.url ?? info?.page ?? '',
            ...(version ? { effectiveDate: version } : {}),
            excerpt: [
              info?.consequence,
              `Entry ${m.entry.id}: ${describeEntry(m)}.`,
              m.entry.programs.length ? `Programs: ${m.entry.programs.join(', ')}.` : undefined,
              m.entry.remarks,
              `Name score ${m.nameScore.toFixed(2)}${m.countryAdjust ? `, country ${m.countryAdjust > 0 ? '+' : ''}${m.countryAdjust.toFixed(2)}` : ''}${m.cityAdjust ? `, city +${m.cityAdjust.toFixed(2)}` : ''}.`,
            ]
              .filter(Boolean)
              .join(' '),
          },
          suggestedFix: strong
            ? 'Stop and escalate to compliance before the goods move or are paid for: confirm the identity against the list entry, and do not deal with the party until cleared. Never clear a match on the name alone.'
            : 'Compare the address, country and identifiers with the list entry. If it is a different party, add it to the screening allowlist with the reason; if it is the same, treat it as a hit.',
        });
        out.hits.push({ findingId: finding.id, ruleId: strong ? 'S1' : 'S2', party: p.name, partyKey: p.key, list: m.entry.list, entryId: m.entry.id, entryName: displayName(m.entry), matchedName: m.matchedName, score: m.score });
        if (!strong) out.questions.push({ findingId: finding.id, party: describeParty(p.seen[0].party), entry: `${describeEntry(m)} (${listName})` });
      }
    }
  }

  // S3: forced labour.
  const inv = ctx.invoice?.data;
  const cnLines = (inv?.lines ?? []).map((l, i) => ({ l, i })).filter(({ l }) => l.countryOfOrigin === 'CN');
  const isfCn = ctx.isf?.data.countryOfOrigin === 'CN';
  const originEvidence: Evidence[] = cnLines.length
    ? [{ documentId: ctx.invoice!.id, field: `lines[${cnLines[0].i}].countryOfOrigin`, value: 'CN' }]
    : isfCn
      ? [{ documentId: ctx.isf!.id, field: 'countryOfOrigin', value: 'CN' }]
      : [];
  const basis = FORCED_LABOUR_BASIS[ctx.destination];
  const action =
    ctx.destination === 'US'
      ? 'Before shipping, get supply-chain tracing documents down to the raw material (UFLPA operational guidance), or expect CBP to detain the goods.'
      : 'Ask the supplier for supply-chain tracing documents down to the raw material; CBSA may detain goods suspected of forced labour.';
  for (const p of parties) {
    for (const s of p.seen) {
      const a = s.party.address;
      const inChina = a?.country === 'CN';
      if (!inChina && originEvidence.length === 0) continue;
      const places: [string, string | undefined][] = [
        ['name', s.party.name],
        ...(a?.lines ?? []).map((line, i): [string, string] => [`address.lines[${i}]`, line]),
        ['address.city', a?.city],
        ['address.region', a?.region],
      ];
      // Ambiguous place names (Aksu is also in Turkey) count for a party in China or with no country printed.
      const hit = places.find(([, text]) => text && xinjiangTerm(text, inChina || (!a?.country && originEvidence.length > 0)));
      if (!hit) continue;
      const term = xinjiangTerm(hit[1]!, true)!;
      push({
        ruleId: 'S3',
        severity: 'MEDIUM',
        message: `${p.name} (${roles(p)}) is linked to Xinjiang ("${hit[1]}", ${term}) and the goods are of Chinese origin: forced-labour presumption risk.`,
        evidence: [{ documentId: s.documentId, field: `${s.field}.${hit[0]}`, value: hit[1]! }, ...(inChina ? [] : originEvidence)],
        regulation: basis,
        suggestedFix: action,
      });
      break;
    }
  }
  // One finding per sector, citing each line's HS code and origin.
  const bySector = new Map<string, { codes: string[]; evidence: Evidence[] }>();
  const addLine = (sector: string, code: string, evidence: Evidence[]) => {
    const s = bySector.get(sector) ?? { codes: [], evidence: [] };
    if (!s.codes.includes(code)) s.codes.push(code);
    s.evidence.push(...evidence);
    bySector.set(sector, s);
  };
  for (const { l, i } of cnLines) {
    const risk = highRiskSector(l.hsCode);
    if (!risk) continue;
    addLine(risk.sector, l.hsCode!, [
      { documentId: ctx.invoice!.id, field: `lines[${i}].hsCode`, value: l.hsCode! },
      { documentId: ctx.invoice!.id, field: `lines[${i}].countryOfOrigin`, value: 'CN' },
    ]);
  }
  if (cnLines.length === 0 && isfCn) {
    const risk = highRiskSector(ctx.isf!.data.htsCode);
    if (risk) addLine(risk.sector, ctx.isf!.data.htsCode, [{ documentId: ctx.isf!.id, field: 'htsCode', value: ctx.isf!.data.htsCode }, ...originEvidence]);
  }
  for (const [sector, { codes, evidence }] of bySector) {
    const lines = evidence.filter((e) => e.field.endsWith('Code')).length;
    push({
      ruleId: 'S3',
      severity: 'MEDIUM',
      message: `${lines === 1 ? 'A line' : `${lines} lines`} of Chinese-origin ${sector} (HS ${codes.join(', ')}): a sector CBP prioritizes under UFLPA.`,
      evidence,
      regulation: basis,
      suggestedFix: action,
    });
  }
  return out;
}
