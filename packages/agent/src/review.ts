import type { LlmClient } from '@doccheck/extraction';
import type { RegulationIndex } from '@doccheck/regulations';
import { excerpt } from '@doccheck/regulations';
import { PROFILES, type Authority, type ShipmentContext } from '@doccheck/rules';
import { clip, findingPreview, report, startStage, type AgentAnswer, type Finding, type Party, type ProgressCallback, type ValidationDetail } from '@doccheck/schemas';
import { z } from 'zod';
import { INVOICE_REQUIREMENTS } from './cite';

/** Bump when a prompt changes so cached decisions are not reused. */
export const AGENT_PROMPT_VERSION = 'agent-v2';

const SYSTEM = `You review freight documents for a customs pre-check, as a careful licensed customs broker would.
You get one specific question about a shipment and must answer from the documents given, nothing else.
Answer "unsure" whenever the documents do not let you decide; a wrong certain answer is worse than "unsure".
Keep the rationale to one or two sentences and quote the values you compared.
If regulation text is given, use it only as background: never claim it allows, requires or forbids anything it does not literally say.`;

export const PartyVerdict = z.object({
  sameParty: z.enum(['yes', 'no', 'unsure']),
  confidence: z.number().min(0).max(1),
  rationale: z.string(),
});
export type PartyVerdict = z.infer<typeof PartyVerdict>;

export const DescriptionVerdict = z.object({
  consistent: z.enum(['yes', 'no', 'unsure']),
  confidence: z.number().min(0).max(1),
  rationale: z.string(),
});
export type DescriptionVerdict = z.infer<typeof DescriptionVerdict>;

const describeParty = (p: Party) =>
  [p.name, ...p.address.lines, [p.address.city, p.address.region, p.address.postalCode].filter(Boolean).join(' '), p.address.country].filter(Boolean).join(', ');

/** Are two differently written names the same company? Used when X1 finds different consignee names. */
export async function judgeSameParty(llm: LlmClient, a: Party, b: Party, context: string) {
  return llm.call(AGENT_PROMPT_VERSION, {
    system: SYSTEM,
    user: `${context}

Party on the commercial invoice: ${describeParty(a)}
Party on the bill of lading: ${describeParty(b)}

Question: are these the same legal entity, written differently (abbreviation, typo, translation, trade name)?
Different companies that share a word, or a parent company and a different subsidiary, are not the same party.`,
    schema: PartyVerdict,
  });
}

/** Does the BL cargo description cover the goods on the invoice? Agent rule A1. */
export async function judgeDescription(llm: LlmClient, blDescription: string, invoiceLines: string[], regulation?: string) {
  return llm.call(AGENT_PROMPT_VERSION, {
    system: SYSTEM,
    user: `${regulation ? `Relevant regulation:\n${regulation}\n\n` : ''}Cargo description on the bill of lading: "${blDescription}"
Goods on the commercial invoice:
${invoiceLines.map((l) => `- ${l}`).join('\n')}

Question: is the BL description consistent with the invoice goods? A short or generic description of the same goods
("toys" for teddy bears, "and other goods as per invoice") is consistent. A description of different goods is not.`,
    schema: DescriptionVerdict,
  });
}

export interface AgentDecision {
  ruleId: string;
  question: string;
  verdict: 'yes' | 'no' | 'unsure';
  confidence: number;
  rationale: string;
  /** What happened to the rule finding, if the decision was about one. */
  effect: 'kept' | 'dismissed' | 'added' | 'none';
}

export interface ReviewResult {
  findings: Finding[];
  decisions: AgentDecision[];
}

/** Minimum confidence for the agent to dismiss a rule finding or add one of its own. */
const ACT_CONFIDENCE = 0.7;

/** Passage on how detailed the goods description must be, in each authority's own wording. */
const DESCRIPTION_QUERY: Record<Authority, string> = {
  CBSA: 'detailed description of the goods',
  CBP: 'detailed description of the merchandise',
  ANAM: 'descripción comercial detallada de las mercancías',
  UCC: 'description of goods',
  HMRC: 'description of the goods',
};

/** Progress reports carry the rationale cut to this length, so events stay small. */
const RATIONALE_CHARS = 500;

/** Agent progress: the `agent` stage of a validation. */
export type AgentProgress = ProgressCallback<Pick<ValidationDetail, 'agent'>>;

/** X1 consignee-name findings the model will be asked about. */
const isPartyQuestion = (ctx: ShipmentContext, f: Finding) => f.ruleId === 'X1' && f.evidence[0]?.field === 'consignee.name' && !!ctx.invoice?.data.consignee && !!ctx.billOfLading;

/** How many questions reviewFindings will ask the model (known before the first one, for progress). */
export function countAgentQuestions(ctx: ShipmentContext, findings: readonly Finding[]): number {
  return findings.filter((f) => isPartyQuestion(ctx, f)).length + (ctx.invoice && ctx.billOfLading ? 1 : 0);
}

const answerOf = (verdict: AgentAnswer['verdict'], confidence: number, rationale: string, effect: AgentAnswer['effect']): AgentAnswer => ({
  verdict,
  confidence,
  rationale: clip(rationale, RATIONALE_CHARS),
  effect,
});

/**
 * Second pass over the rule findings:
 *  - X1 name mismatches: the model decides whether both names are the same company; a confident
 *    "yes" dismisses the finding, anything else keeps it with the model's rationale.
 *  - A1: the model checks the BL cargo description against the invoice goods.
 * Every decision is returned, including the ones that change nothing, so a reviewer can audit them.
 */
export async function reviewFindings(ctx: ShipmentContext, findings: Finding[], llm: LlmClient, index?: RegulationIndex, onProgress?: AgentProgress): Promise<ReviewResult> {
  const total = countAgentQuestions(ctx, findings);
  const stage = await startStage(onProgress, 'agent', { model: llm.provider.id, total });
  try {
    const result = await review(ctx, findings, llm, index, { onProgress, total });
    await stage.done({ decisions: result.decisions.length, total });
    return result;
  } catch (err) {
    await stage.fail(err);
    throw err;
  }
}

async function review(ctx: ShipmentContext, findings: Finding[], llm: LlmClient, index: RegulationIndex | undefined, progress: { onProgress?: AgentProgress; total: number }): Promise<ReviewResult> {
  const decisions: AgentDecision[] = [];
  const out: Finding[] = [];
  const authority = PROFILES[ctx.destination].authority;
  /**
   * Reports a question as asked (about `findingId`, if any), runs it, then reports the decision it led to;
   * `addedOf` gives the finding the decision added, for its preview.
   */
  const ask = async <T>(ruleId: string, question: string, findingId: string | undefined, run: () => Promise<T>, decide: (result: T) => AgentDecision, addedOf?: (result: T) => Finding | undefined): Promise<T> => {
    const at = { index: decisions.length + 1, total: progress.total, ruleId, question, ...(findingId ? { findingId } : {}) };
    await report(progress.onProgress, { stage: 'agent', status: 'progress', detail: at });
    const result = await run();
    const d = decide(result);
    decisions.push(d);
    const added = d.effect === 'added' ? addedOf?.(result) : undefined;
    const answer = answerOf(d.verdict, d.confidence, d.rationale, d.effect);
    await report(progress.onProgress, { stage: 'agent', status: 'progress', detail: { ...at, answer, ...(added ? { findingId: added.id, added: findingPreview(added) } : {}) } });
    return result;
  };

  for (const f of findings) {
    if (!isPartyQuestion(ctx, f)) {
      out.push(f);
      continue;
    }
    const question = 'Same consignee written differently?';
    const { output } = await ask(
      'X1',
      question,
      f.id,
      () => judgeSameParty(llm, ctx.invoice!.data.consignee!, ctx.billOfLading!.data.consignee, 'The consignee names differ between two documents of the same shipment.'),
      ({ output: o }) => ({ ruleId: 'X1', question, verdict: o.sameParty, confidence: o.confidence, rationale: o.rationale, effect: o.sameParty === 'yes' && o.confidence >= ACT_CONFIDENCE ? 'dismissed' : 'kept' }),
    );
    const dismiss = output.sameParty === 'yes' && output.confidence >= ACT_CONFIDENCE;
    if (!dismiss) out.push({ ...f, agentRationale: output.rationale });
  }

  const inv = ctx.invoice?.data;
  const bl = ctx.billOfLading?.data;
  if (inv && bl && ctx.invoice && ctx.billOfLading) {
    let regulation: string | undefined;
    if (index) {
      const [hit] = await index.search(DESCRIPTION_QUERY[authority], { authority, documents: [...INVOICE_REQUIREMENTS[authority]], language: 'en', limit: 1 });
      if (hit) regulation = excerpt(hit.chunk.text, 'detailed description', 400);
    }
    const lines = inv.lines.map((l) => `${l.description} (${l.quantity.value} ${l.quantity.unit})`);
    const question = 'BL cargo description consistent with the invoice?';
    const mismatch = (rationale: string): Finding => ({
      id: `${ctx.shipmentId}:A1:0`,
      shipmentId: ctx.shipmentId,
      ruleId: 'A1',
      severity: 'MEDIUM',
      decidedBy: 'AGENT',
      message: `The BL describes the cargo as "${bl.cargoDescription}", which does not match the goods on the invoice.`,
      evidence: [
        { documentId: ctx.billOfLading!.id, field: 'cargoDescription', value: bl.cargoDescription },
        ...inv.lines.map((l, i) => ({ documentId: ctx.invoice!.id, field: `lines[${i}].description`, value: l.description })),
      ],
      agentRationale: rationale,
      suggestedFix: 'Ask the carrier or forwarder to correct the BL description before the cargo report is filed.',
    });
    const { output } = await ask(
      'A1',
      question,
      undefined,
      () => judgeDescription(llm, bl.cargoDescription, lines, regulation),
      ({ output: o }) => ({ ruleId: 'A1', question, verdict: o.consistent, confidence: o.confidence, rationale: o.rationale, effect: o.consistent === 'no' && o.confidence >= ACT_CONFIDENCE ? 'added' : 'none' }),
      ({ output: o }) => mismatch(o.rationale),
    );
    if (output.consistent === 'no' && output.confidence >= ACT_CONFIDENCE) out.push(mismatch(output.rationale));
  }
  return { findings: out, decisions };
}
