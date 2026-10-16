import type { RuleDefinition, RuleResult, ShipmentContext } from '@doccheck/rules';
import type { Destination, Evidence, Finding } from '@doccheck/schemas';
import { agencyRequirements, type AgencyRequirement } from './agencies';
import { EXPORT_CONTROL_SOURCE, exportControlHints } from './export-control';
import { ENTRY_CODE, formatHs, hsDigits, hsFormat, isNationalChapter } from './hs-code';
import type { TariffSchedule } from './schedule';

/** What the tariff rules need besides the documents: the destination's schedule, when it is loaded. */
export interface TariffContext {
  schedule?: TariffSchedule;
}

export interface TariffRuleResult extends RuleResult {
  /** The legal source, when the rule knows it (agency tables); otherwise the citation step looks one up. */
  regulation?: Finding['regulation'];
}

export interface TariffRule {
  definition: RuleDefinition;
  /** Runs only when the schedule is loaded. */
  needsSchedule?: boolean;
  run(ctx: ShipmentContext, tariff: TariffContext): TariffRuleResult[];
}

/** Declared codes on the invoice lines, with where each one is. */
const invoiceCodes = (ctx: ShipmentContext) =>
  (ctx.invoice?.data.lines ?? [])
    .map((line, i) => ({ line, i, raw: line.hsCode?.trim() ?? '' }))
    .filter((x) => x.raw.length > 0)
    .map((x) => ({ ...x, digits: hsDigits(x.raw), evidence: { documentId: ctx.invoice!.id, field: `lines[${x.i}].hsCode`, value: x.raw } satisfies Evidence }));

const lineLabel = (lineNo: number, description: string) => `line ${lineNo} ("${description.length > 60 ? `${description.slice(0, 59)}…` : description}")`;

/** H1: each declared code is a whole HS subheading or tariff item, and the ISF has at least 6 digits. */
export const h1HsFormat: TariffRule = {
  definition: { id: 'H1', title: 'HS codes are complete: 6, 8 or 10 digits (ISF: at least 6)', appliesTo: 'ALL', requires: ['COMMERCIAL_INVOICE'], kind: 'DETERMINISTIC', severity: 'MEDIUM' },
  run(ctx) {
    const results: TariffRuleResult[] = [];
    for (const c of invoiceCodes(ctx)) {
      const format = hsFormat(c.raw);
      if (format === 'ok') continue;
      results.push({
        message:
          format === 'heading-only'
            ? `Invoice ${lineLabel(c.line.lineNo, c.line.description)} gives only the 4-digit heading ${c.raw}; the entry needs ${ENTRY_CODE[ctx.destination]}.`
            : `Invoice ${lineLabel(c.line.lineNo, c.line.description)} has HS code "${c.raw}", which is not 6, 8 or 10 digits.`,
        evidence: [c.evidence],
        suggestedFix: 'Ask the seller for the full HS code of this line (at least the 6-digit subheading), or have the broker classify it.',
      });
    }
    if (ctx.destination === 'US' && ctx.isf) {
      const raw = ctx.isf.data.htsCode.trim();
      const digits = hsDigits(raw);
      if (digits.length < 6 || !/^[\d.\s-]+$/.test(raw)) {
        results.push({
          message: `ISF commodity HTSUS number "${raw}" has ${digits.length} digits; the ISF needs at least the 6-digit subheading.`,
          evidence: [{ documentId: ctx.isf.id, field: 'htsCode', value: raw }],
          severity: 'HIGH',
          suggestedFix: 'Amend the ISF with the HTSUS number to at least six digits before the vessel arrives.',
        });
      }
    }
    return results;
  },
};

/** H2: each declared code exists in the destination's schedule (the HS subheading, then the national digits). */
export const h2HsExists: TariffRule = {
  definition: { id: 'H2', title: "HS codes exist in the destination's tariff schedule", appliesTo: 'ALL', requires: ['COMMERCIAL_INVOICE'], kind: 'DETERMINISTIC', severity: 'HIGH' },
  needsSchedule: true,
  run(ctx, { schedule }) {
    if (!schedule) return [];
    const results: TariffRuleResult[] = [];
    const edition = `${schedule.file.title}, ${schedule.file.edition}`;
    const check = (digits: string, raw: string, where: string, evidence: Evidence) => {
      if (![6, 8, 10].includes(digits.length) && !(digits.length === 4 && !isNationalChapter(digits))) return; // H1 reports the length
      if (isNationalChapter(digits)) {
        if (digits.length >= 8 && !schedule.hasCode(digits)) results.push({ message: `${where} has ${raw}, which is not in the ${edition}.`, evidence: [evidence], suggestedFix: 'Confirm the special classification provision with the broker.' });
        return;
      }
      const sub = digits.slice(0, 6);
      if (digits.length === 4 ? !schedule.hasHeading(digits) : !schedule.hasSubheading(sub)) {
        results.push({
          message: `${where} has ${raw}: ${digits.length === 4 ? 'heading' : 'subheading'} ${formatHs(digits.slice(0, Math.min(6, digits.length)))} does not exist in the Harmonized System (checked against the ${edition}).`,
          evidence: [evidence],
          suggestedFix: 'The code is probably mistyped: ask the seller for the correct one, or have the broker classify the goods.',
        });
        return;
      }
      if (digits.length >= 8 && !schedule.hasCode(digits)) {
        results.push({
          message: `${where} has ${raw}: subheading ${formatHs(sub)} exists, but ${formatHs(digits)} is not a ${schedule.id === 'US' ? 'HTSUS' : 'Canadian'} tariff number (${edition}). The digits after the sixth are national, and a seller often prints its own country's.`,
          evidence: [evidence],
          severity: 'MEDIUM',
          suggestedFix: `Use the 6-digit subheading from the invoice and have the broker find ${ENTRY_CODE[ctx.destination]}.`,
        });
      }
    };
    for (const c of invoiceCodes(ctx)) check(c.digits, c.raw, `Invoice ${lineLabel(c.line.lineNo, c.line.description)}`, c.evidence);
    if (ctx.destination === 'US' && ctx.isf) {
      const raw = ctx.isf.data.htsCode.trim();
      check(hsDigits(raw), raw, 'The ISF', { documentId: ctx.isf.id, field: 'htsCode', value: raw });
    }
    return results;
  },
};

/**
 * H3: the 6-digit subheading of a product is the same everywhere it appears: on every invoice line
 * with the same SKU, and on the packing list when it prints codes. (The ISF against the invoice is X11.)
 */
export const h3HsConsistent: TariffRule = {
  definition: { id: 'H3', title: 'Same product, same HS subheading across invoice lines and packing list', appliesTo: 'ALL', requires: ['COMMERCIAL_INVOICE'], kind: 'DETERMINISTIC', severity: 'MEDIUM' },
  run(ctx) {
    const results: TariffRuleResult[] = [];
    const codes = invoiceCodes(ctx).filter((c) => c.digits.length >= 6);
    const bySku = new Map<string, typeof codes>();
    for (const c of codes) if (c.line.sku) (bySku.get(c.line.sku) ?? bySku.set(c.line.sku, []).get(c.line.sku)!).push(c);
    for (const [sku, list] of bySku) {
      const subs = new Set(list.map((c) => c.digits.slice(0, 6)));
      if (subs.size > 1) {
        results.push({
          message: `SKU ${sku} appears on the invoice under different HS subheadings (${[...subs].map(formatHs).join(', ')}).`,
          evidence: list.map((c) => c.evidence),
          suggestedFix: 'One product has one classification: ask the seller which code is right.',
        });
      }
    }
    if (ctx.packingList) {
      const pl = ctx.packingList;
      pl.data.packages.forEach((group, g) =>
        group.contents.forEach((item, k) => {
          const raw = item.hsCode?.trim();
          if (!raw || !item.sku) return;
          const inv = codes.find((c) => c.line.sku === item.sku);
          const digits = hsDigits(raw);
          if (!inv || digits.length < 6 || inv.digits.slice(0, 6) === digits.slice(0, 6)) return;
          results.push({
            message: `SKU ${item.sku} is ${raw} on the packing list but ${inv.raw} on the invoice.`,
            evidence: [{ documentId: pl.id, field: `packages[${g}].contents[${k}].hsCode`, value: raw }, inv.evidence],
            suggestedFix: 'Ask the seller to correct the document with the wrong code.',
          });
        }),
      );
    }
    return results;
  },
};

const regulationOf = (r: AgencyRequirement | { source: AgencyRequirement['source'] }): Finding['regulation'] => ({ title: r.source.title, url: r.source.url, excerpt: r.source.excerpt });

/**
 * P1: the declared codes fall under a partner government agency (US) or other government department
 * (CA) requirement. One finding per requirement, listing the lines it covers. Informational: the
 * documents are not wrong, but the entry will need this agency's data, permit or licence.
 */
export const p1Agencies: TariffRule = {
  definition: { id: 'P1', title: 'Partner government agency (PGA / OGD) data or permit likely needed for the HS codes', appliesTo: 'ALL', requires: ['COMMERCIAL_INVOICE'], kind: 'DETERMINISTIC', severity: 'LOW' },
  run(ctx) {
    const hits = new Map<string, { req: AgencyRequirement; lines: ReturnType<typeof invoiceCodes> }>();
    for (const c of invoiceCodes(ctx)) {
      for (const req of agencyRequirements(c.digits, ctx.destination)) (hits.get(req.id) ?? hits.set(req.id, { req, lines: [] }).get(req.id)!).lines.push(c);
    }
    return [...hits.values()].map(({ req, lines }) => ({
      message: `${req.agency} (${req.program}) likely applies to ${lines.length === 1 ? `invoice ${lineLabel(lines[0].line.lineNo, lines[0].line.description)}` : `invoice lines ${lines.map((l) => l.line.lineNo).join(', ')}`}, HS ${[...new Set(lines.map((l) => formatHs(l.digits)))].join(', ')}. ${req.requirement}`,
      evidence: lines.map((l) => l.evidence),
      severity: req.severity,
      suggestedFix: `Have the ${req.agency} data, permit or certificate ready before arrival, and confirm with the broker${ctx.destination === 'CA' ? ' or CFIA AIRS' : ' (the ACE PGA flags for the 10-digit code)'} whether it applies to these goods.`,
      regulation: regulationOf(req),
    }));
  },
};

/** E1: a line looks like a dual-use item (Wassenaar categories 3, 4, 5; also 6 and 9). Informational. */
export const e1ExportControl: TariffRule = {
  definition: { id: 'E1', title: 'Possible dual-use item (export control list categories 3, 4, 5)', appliesTo: 'ALL', requires: ['COMMERCIAL_INVOICE'], kind: 'DETERMINISTIC', severity: 'LOW' },
  run(ctx) {
    const inv = ctx.invoice;
    if (!inv) return [];
    const list = ctx.destination === 'US' ? 'the US Commerce Control List (EAR Part 774)' : "Canada's Export Control List (Group 1)";
    return inv.data.lines.flatMap((line, i) => {
      const digits = line.hsCode ? hsDigits(line.hsCode) : undefined;
      return exportControlHints(digits, line.description).map((m) => ({
        message: `Invoice ${lineLabel(line.lineNo, line.description)} may be a dual-use item: ${m.hint.label}, from ${m.reason.startsWith('HS ') ? `HS ${formatHs(digits!)}` : m.reason}. Items in this category can be on ${list}.`,
        evidence: [
          { documentId: inv.id, field: `lines[${i}].description`, value: line.description },
          ...(line.hsCode ? [{ documentId: inv.id, field: `lines[${i}].hsCode`, value: line.hsCode }] : []),
        ],
        suggestedFix: "Ask the seller for the item's export classification (ECCN or ECL item) and whether it shipped under an export licence; a re-export may need one too.",
        regulation: regulationOf({ source: EXPORT_CONTROL_SOURCE[ctx.destination as Destination] }),
      }));
    });
  },
};

export const TARIFF_RULES: TariffRule[] = [h1HsFormat, h2HsExists, h3HsConsistent, p1Agencies, e1ExportControl];

/** Agent rule A2 (packages/agent): the model checks a declared code against the line description. */
export const A2_DEFINITION: RuleDefinition = {
  id: 'A2',
  title: 'Declared HS heading fits the goods description (agent, with the tariff notes)',
  appliesTo: 'ALL',
  requires: ['COMMERCIAL_INVOICE'],
  kind: 'AGENT',
  severity: 'MEDIUM',
};

/** Every tariff rule definition, for the rule catalog. */
export const TARIFF_RULE_DEFINITIONS: RuleDefinition[] = [...TARIFF_RULES.map((r) => r.definition), A2_DEFINITION];
