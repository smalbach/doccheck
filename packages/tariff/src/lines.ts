import type { ShipmentContext } from '@doccheck/rules';
import { agencyRequirements } from './agencies';
import { exportControlHints } from './export-control';
import { formatHs, hsDigits, hsFormat, isNationalChapter } from './hs-code';
import type { TariffSchedule } from './schedule';

/** Whether a declared code is in the destination schedule. */
export type CodeStatus =
  /** 8 or 10 digits, in the schedule. */
  | 'valid'
  /** 6 digits, an existing HS subheading: right as far as it goes, the national digits are missing. */
  | 'subheading'
  /** 4 digits, an existing heading. */
  | 'heading'
  /** The HS subheading exists, the national digits do not. */
  | 'national-unknown'
  /** Not in the Harmonized System. */
  | 'unknown'
  /** Not 4, 6, 8 or 10 digits. */
  | 'malformed'
  /** The line prints no code. */
  | 'missing'
  /** No schedule loaded to check against. */
  | 'not-checked';

export interface AgencyFlag {
  id: string;
  agency: string;
  program: string;
  severity: 'LOW' | 'MEDIUM';
}

export interface HsSuggestion {
  /** 6-digit subheading, digits only. */
  code: string;
  title: string;
  confidence?: number;
  rationale?: string;
  agencies: AgencyFlag[];
}

/** The model's answer on whether the declared heading fits the description (agent rule A2). */
export interface HeadingFit {
  verdict: 'yes' | 'no' | 'unsure';
  confidence: number;
  rationale: string;
  notes: TariffNoteQuote[];
  /** "search": the search already ranks the declared heading among the top candidates, so the model was not asked. */
  by: 'agent' | 'search';
}

export interface TariffNoteQuote {
  ref: string;
  url: string;
  excerpt: string;
}

/** One invoice line as the tariff check sees it, for the shipment page. */
export interface TariffLineReport {
  index: number;
  lineNo: number;
  description: string;
  declared?: string;
  code?: string;
  status: CodeStatus;
  /** What the schedule calls the declared code. */
  title?: string;
  agencies: AgencyFlag[];
  exportControl: { id: string; category: number; label: string }[];
  fit?: HeadingFit;
  /** Top candidates when the line has no code (or the model doubts it): suggestions, not findings. */
  suggestions?: HsSuggestion[];
  /** Notes the suggestions were weighed against. */
  suggestionNotes?: TariffNoteQuote[];
}

export const agencyFlags = (digits: string, destination: ShipmentContext['destination']): AgencyFlag[] =>
  agencyRequirements(digits, destination).map((r) => ({ id: r.id, agency: r.agency, program: r.program, severity: r.severity }));

export function codeStatus(raw: string | undefined, schedule?: TariffSchedule): CodeStatus {
  if (!raw?.trim()) return 'missing';
  const format = hsFormat(raw);
  if (format === 'malformed') return 'malformed';
  if (!schedule) return 'not-checked';
  const digits = hsDigits(raw);
  if (isNationalChapter(digits)) return schedule.hasCode(digits) ? 'valid' : 'national-unknown';
  if (digits.length === 4) return schedule.hasHeading(digits) ? 'heading' : 'unknown';
  if (!schedule.hasSubheading(digits.slice(0, 6))) return 'unknown';
  if (digits.length === 6) return 'subheading';
  return schedule.hasCode(digits) ? 'valid' : 'national-unknown';
}

/** The deterministic part of the line reports; the agent adds `fit` and `suggestions`. */
export function tariffLines(ctx: ShipmentContext, schedule?: TariffSchedule): TariffLineReport[] {
  return (ctx.invoice?.data.lines ?? []).map((line, index) => {
    const declared = line.hsCode?.trim() || undefined;
    const code = declared ? hsDigits(declared) : undefined;
    const status = codeStatus(declared, schedule);
    const known = code && ['valid', 'subheading', 'heading', 'national-unknown'].includes(status);
    return {
      index,
      lineNo: line.lineNo,
      description: line.description,
      ...(declared ? { declared, code } : {}),
      status,
      ...(known && schedule ? { title: schedule.describe(status === 'national-unknown' ? code!.slice(0, 6) : code!) } : {}),
      agencies: code ? agencyFlags(code, ctx.destination) : [],
      exportControl: exportControlHints(code, line.description).map((m) => ({ id: m.hint.id, category: m.hint.category, label: m.hint.label })),
    };
  });
}

export { formatHs };
