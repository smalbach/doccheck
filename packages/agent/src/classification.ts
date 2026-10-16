import type { LlmClient } from '@doccheck/extraction';
import type { ShipmentContext } from '@doccheck/rules';
import type { Finding } from '@doccheck/schemas';
import {
  agencyFlags,
  formatHs,
  headingRef,
  quoteNote,
  type Candidate,
  type HsSuggestion,
  type TariffLineReport,
  type TariffNote,
  type TariffNotes,
  type TariffSchedule,
  type TariffSearch,
} from '@doccheck/tariff';
import { z } from 'zod';
import type { AgentDecision, AgentExtension } from './review';

/** Bump when a prompt changes so cached decisions are not reused. */
export const CLASSIFICATION_PROMPT_VERSION = 'tariff-v1';

/** Minimum confidence to add an A2 finding (same threshold as the other agent decisions). */
const ACT_CONFIDENCE = 0.7;

/** At most this many classification questions per validation; long invoices get the first lines. */
export const MAX_CLASSIFICATION_QUESTIONS = 12;

const SYSTEM = `You check tariff classification for a customs pre-check, as a careful licensed customs broker would.
Classification follows the General Interpretative Rules (GRI): by GRI 1 the terms of the headings and the section and chapter notes decide;
a note that excludes goods from a chapter overrides the wording of its headings.
Answer only from the goods description, the heading texts and the notes given. Never invent a heading or a note.
Answer "unsure" whenever the description does not say enough to decide (material, function or use is missing); a wrong certain answer is worse than "unsure".
Keep the rationale to one or two sentences, name the heading and quote the note you relied on, if any.`;

export const HeadingVerdict = z.object({
  fits: z.enum(['yes', 'no', 'unsure']),
  confidence: z.number().min(0).max(1),
  rationale: z.string(),
});
export type HeadingVerdict = z.infer<typeof HeadingVerdict>;

export const SuggestionAnswer = z.object({
  candidates: z
    .array(z.object({ code: z.string(), confidence: z.number().min(0).max(1), rationale: z.string() }))
    .max(3),
});
export type SuggestionAnswer = z.infer<typeof SuggestionAnswer>;

/** A heading as the model is shown it: "95.03 Tricycles, ... toys; ... (Chapter 95: TOYS, GAMES ...)". */
export interface HeadingText {
  code: string;
  text: string;
}

const noteBlock = (notes: { ref: string; text: string }[]) => (notes.length ? `\nTariff notes:\n${notes.map((n) => `- ${n.ref}: ${n.text}`).join('\n')}\n` : '');

/** Does the goods description fit the declared heading? Agent rule A2. */
export async function judgeHeading(llm: LlmClient, description: string, declared: HeadingText, notes: { ref: string; text: string }[], alternatives: HeadingText[] = []) {
  return llm.call(CLASSIFICATION_PROMPT_VERSION, {
    system: SYSTEM,
    user: `Goods description on the commercial invoice: "${description}"
Declared heading: ${declared.code} ${declared.text}
${alternatives.length ? `Other headings a keyword and meaning search ranks for this description (they may be wrong):\n${alternatives.map((a) => `- ${a.code} ${a.text}`).join('\n')}\n` : ''}${noteBlock(notes)}
Question: can goods with this description be classified in the declared heading ${declared.code}?
"yes" if the heading covers them (a broad heading such as "other toys" covers a specific toy).
"no" only if the description clearly names goods that the heading does not cover or that a note sends elsewhere.`,
    schema: HeadingVerdict,
  });
}

/** Up to three subheadings, among the search candidates, for a line without a code. */
export async function suggestHeadings(llm: LlmClient, description: string, candidates: HeadingText[], notes: { ref: string; text: string }[]) {
  return llm.call(CLASSIFICATION_PROMPT_VERSION, {
    system: SYSTEM,
    user: `Goods description on the commercial invoice: "${description}"
Candidate subheadings found by a search of the tariff (codes are 6-digit HS subheadings):
${candidates.map((c) => `- ${c.code} ${c.text}`).join('\n')}
${noteBlock(notes)}
Question: which of these candidates (at most three, best first) could this description be classified in, applying GRI 1 and the notes?
Use only codes from the list, exactly as written. Leave out candidates that do not fit; return an empty list if none does.
Give each a confidence and a one-sentence rationale.`,
    schema: SuggestionAnswer,
  });
}

/** Everything the classification check reads: schedule, notes and the search over the destination's tariff. */
export interface ClassificationResources {
  schedule: TariffSchedule;
  notes: TariffNotes;
  search: TariffSearch;
}

/** A question the review will ask the model, planned before the agent stage starts so it can count them. */
export type PlannedQuestion =
  | { kind: 'fit'; line: TariffLineReport; candidates: Candidate[] }
  | { kind: 'suggest'; line: TariffLineReport; candidates: Candidate[] };

const headingOf = (code: string) => code.slice(0, 4);
const headingText = (res: ClassificationResources, d4: string): HeadingText => {
  const entry = res.schedule.headingEntry(d4);
  const chapter = res.notes.chapterTitle(d4.slice(0, 2));
  return { code: headingRef(d4), text: `${entry?.description ?? ''}${chapter ? ` (Chapter ${Number(d4.slice(0, 2))}: ${chapter})` : ''}`.trim() };
};

/**
 * Plans the classification questions. A declared code whose heading the search already ranks among
 * the top candidates is taken as consistent without asking (the model comes back only for what the
 * search cannot settle); a line without a code gets candidates to choose from.
 */
export async function planClassification(lines: TariffLineReport[], res: ClassificationResources, limit = MAX_CLASSIFICATION_QUESTIONS): Promise<PlannedQuestion[]> {
  const planned: PlannedQuestion[] = [];
  const asked = new Set<string>();
  for (const line of lines) {
    const candidates = await res.search.search(line.description, { limit: 8 });
    if (line.code && ['valid', 'subheading', 'heading', 'national-unknown'].includes(line.status)) {
      const declared = headingOf(line.code);
      if (candidates.slice(0, 5).some((c) => c.heading === declared)) {
        line.fit = { verdict: 'yes', confidence: 1, rationale: `The tariff search ranks heading ${headingRef(declared)} among the top candidates for this description.`, notes: [], by: 'search' };
        continue;
      }
      const key = `fit|${line.description}|${declared}`;
      if (asked.has(key) || planned.length >= limit) continue;
      asked.add(key);
      planned.push({ kind: 'fit', line, candidates });
    } else if (line.status === 'missing') {
      const key = `suggest|${line.description}`;
      if (asked.has(key) || planned.length >= limit) continue;
      asked.add(key);
      planned.push({ kind: 'suggest', line, candidates });
    }
  }
  return planned;
}

/** Same signature as the ask helper of reviewFindings: reports the question, runs it, records the decision. */
export type AskFn = <T>(ruleId: string, question: string, findingId: string | undefined, run: () => Promise<T>, decide: (result: T) => AgentDecision, addedOf?: (result: T) => Finding | undefined) => Promise<T>;

const asNote = (n: TariffNote, focus: { heading?: string; text?: string }) => ({ ref: n.ref, url: n.url, excerpt: quoteNote(n, focus) });

/** Notes to show the model and cite: those of the declared chapter that send goods to a candidate heading, then the ones sharing most words. */
function notesFor(res: ClassificationResources, description: string, chapters: string[], candidates: Candidate[]): { ref: string; url: string; excerpt: string }[] {
  const out = new Map<string, { ref: string; url: string; excerpt: string }>();
  for (const chapter of chapters.slice(0, 1)) {
    for (const c of candidates.slice(0, 3)) {
      if (c.chapter === chapter) continue;
      for (const n of res.notes.pointingTo(chapter, c.heading)) if (!out.has(n.ref)) out.set(n.ref, asNote(n, { heading: c.heading }));
    }
  }
  for (const n of res.notes.relevant(description, chapters, 3)) if (!out.has(n.ref)) out.set(n.ref, asNote(n, { text: description }));
  return [...out.values()].slice(0, 4);
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/**
 * Asks the planned questions and fills the line reports. A confident "does not fit" adds an A2
 * finding that cites the tariff note behind it and lists the headings the search suggests; the
 * declared code is never changed. Suggestions for lines without a code stay suggestions.
 */
export async function runClassification(ctx: ShipmentContext, planned: PlannedQuestion[], llm: LlmClient, res: ClassificationResources, ask: AskFn): Promise<Finding[]> {
  const findings: Finding[] = [];
  const inv = ctx.invoice;
  if (!inv) return findings;
  const tariffName = res.schedule.id === 'US' ? 'HTSUS' : 'Customs Tariff';
  for (const q of planned) {
    const { line, candidates } = q;
    if (q.kind === 'fit') {
      const declared = headingOf(line.code!);
      const others = candidates.filter((c) => c.heading !== declared);
      const otherHeadings = [...new Set(others.map((c) => c.heading))].slice(0, 3);
      const notes = notesFor(res, line.description, [declared.slice(0, 2), ...otherHeadings.map((h) => h.slice(0, 2))], others);
      const question = `Does line ${line.lineNo} fit heading ${headingRef(declared)}?`;
      const suggestions: HsSuggestion[] = others.slice(0, 3).map((c) => ({ code: c.code, title: c.title, agencies: agencyFlags(c.code, ctx.destination) }));
      const finding = (rationale: string): Finding => ({
        id: `${ctx.shipmentId}:A2:${findings.length}`,
        shipmentId: ctx.shipmentId,
        ruleId: 'A2',
        severity: 'MEDIUM',
        decidedBy: 'AGENT',
        message: `Invoice line ${line.lineNo} ("${clip(line.description, 60)}") is declared under ${formatHs(line.code!)}, but the goods do not appear to fit heading ${headingRef(declared)} (${clip(headingText(res, declared).text, 120)}).${suggestions.length ? ` Headings the tariff search suggests: ${suggestions.map((s) => formatHs(s.code)).join(', ')}.` : ''}`,
        evidence: [
          { documentId: inv.id, field: `lines[${line.index}].hsCode`, value: line.declared! },
          { documentId: inv.id, field: `lines[${line.index}].description`, value: line.description },
        ],
        ...(notes[0] ? { regulation: { title: `${tariffName}: ${notes[0].ref}`, url: notes[0].url, excerpt: notes[0].excerpt } } : {}),
        agentRationale: rationale,
        suggestedFix: 'Ask the broker to review the classification with the seller. DocCheck does not change the declared code.',
      });
      const { output } = await ask(
        'A2',
        question,
        undefined,
        () => judgeHeading(llm, line.description, headingText(res, declared), notes.map((n) => ({ ref: n.ref, text: n.excerpt })), otherHeadings.map((h) => headingText(res, h))),
        ({ output: o }) => ({ ruleId: 'A2', question, verdict: o.fits, confidence: o.confidence, rationale: o.rationale, effect: o.fits === 'no' && o.confidence >= ACT_CONFIDENCE ? 'added' : 'none' }),
        ({ output: o }) => finding(o.rationale),
      );
      line.fit = { verdict: output.fits, confidence: output.confidence, rationale: output.rationale, notes, by: 'agent' };
      if (output.fits !== 'yes') line.suggestions = suggestions;
      if (output.fits === 'no' && output.confidence >= ACT_CONFIDENCE) findings.push(finding(output.rationale));
      continue;
    }

    const shown = candidates.slice(0, 8);
    const notes = notesFor(res, line.description, [...new Set(shown.slice(0, 3).map((c) => c.chapter))], []);
    const question = `Which HS subheadings fit line ${line.lineNo}?`;
    const { output } = await ask(
      'HS',
      question,
      undefined,
      () => suggestHeadings(llm, line.description, shown.map((c) => ({ code: formatHs(c.code), text: c.title })), notes.map((n) => ({ ref: n.ref, text: n.excerpt }))),
      ({ output: o }) => {
        const top = o.candidates[0];
        return { ruleId: 'HS', question, verdict: top ? 'yes' : 'unsure', confidence: top?.confidence ?? 0, rationale: top ? `${top.code}: ${top.rationale}` : 'None of the candidates fits the description.', effect: 'none' };
      },
    );
    // Only codes that were offered: a code the model makes up is dropped.
    const byCode = new Map(shown.map((c) => [c.code, c]));
    line.suggestions = output.candidates
      .map((s) => ({ s, c: byCode.get(s.code.replace(/\D/g, '').slice(0, 6)) }))
      .filter((x): x is { s: (typeof output.candidates)[number]; c: Candidate } => !!x.c)
      .filter((x, i, all) => all.findIndex((y) => y.c.code === x.c.code) === i)
      .map(({ s, c }) => ({ code: c.code, title: c.title, confidence: s.confidence, rationale: s.rationale, agencies: agencyFlags(c.code, ctx.destination) }));
    line.fit = undefined;
    if (notes.length) line.suggestionNotes = notes;
  }
  return findings;
}

/**
 * The classification questions as an extension of reviewFindings: planned now (so the agent stage
 * knows how many questions it will ask), asked in the same stage after the built-in ones.
 */
export async function classificationExtension(ctx: ShipmentContext, lines: TariffLineReport[], llm: LlmClient, res: ClassificationResources): Promise<AgentExtension> {
  const planned = await planClassification(lines, res);
  return { count: planned.length, run: (ask) => runClassification(ctx, planned, llm, res, ask) };
}
