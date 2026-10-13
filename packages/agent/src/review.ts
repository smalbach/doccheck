import type { LlmClient } from '@doccheck/extraction';
import type { RegulationIndex } from '@doccheck/regulations';
import { excerpt } from '@doccheck/regulations';
import { PROFILES, type ShipmentContext } from '@doccheck/rules';
import type { Finding, Party } from '@doccheck/schemas';
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

/**
 * Second pass over the rule findings:
 *  - X1 name mismatches: the model decides whether both names are the same company; a confident
 *    "yes" dismisses the finding, anything else keeps it with the model's rationale.
 *  - A1: the model checks the BL cargo description against the invoice goods.
 * Every decision is returned, including the ones that change nothing, so a reviewer can audit them.
 */
export async function reviewFindings(ctx: ShipmentContext, findings: Finding[], llm: LlmClient, index?: RegulationIndex): Promise<ReviewResult> {
  const decisions: AgentDecision[] = [];
  const out: Finding[] = [];
  const authority = PROFILES[ctx.destination].authority;

  for (const f of findings) {
    const isNameMismatch = f.ruleId === 'X1' && f.evidence[0]?.field === 'consignee.name';
    if (!isNameMismatch || !ctx.invoice?.data.consignee || !ctx.billOfLading) {
      out.push(f);
      continue;
    }
    const { output } = await judgeSameParty(llm, ctx.invoice.data.consignee, ctx.billOfLading.data.consignee, 'The consignee names differ between two documents of the same shipment.');
    const dismiss = output.sameParty === 'yes' && output.confidence >= ACT_CONFIDENCE;
    decisions.push({ ruleId: 'X1', question: 'Same consignee written differently?', verdict: output.sameParty, confidence: output.confidence, rationale: output.rationale, effect: dismiss ? 'dismissed' : 'kept' });
    if (!dismiss) out.push({ ...f, agentRationale: output.rationale });
  }

  const inv = ctx.invoice?.data;
  const bl = ctx.billOfLading?.data;
  if (inv && bl && ctx.invoice && ctx.billOfLading) {
    let regulation: string | undefined;
    if (index) {
      const [hit] = await index.search(authority === 'CBSA' ? 'detailed description of the goods' : 'detailed description of the merchandise', { authority, documents: [...INVOICE_REQUIREMENTS[authority]], language: 'en', limit: 1 });
      if (hit) regulation = excerpt(hit.chunk.text, 'detailed description', 400);
    }
    const lines = inv.lines.map((l) => `${l.description} (${l.quantity.value} ${l.quantity.unit})`);
    const { output } = await judgeDescription(llm, bl.cargoDescription, lines, regulation);
    const add = output.consistent === 'no' && output.confidence >= ACT_CONFIDENCE;
    decisions.push({ ruleId: 'A1', question: 'BL cargo description consistent with the invoice?', verdict: output.consistent, confidence: output.confidence, rationale: output.rationale, effect: add ? 'added' : 'none' });
    if (add) {
      out.push({
        id: `${ctx.shipmentId}:A1:0`,
        shipmentId: ctx.shipmentId,
        ruleId: 'A1',
        severity: 'MEDIUM',
        decidedBy: 'AGENT',
        message: `The BL describes the cargo as "${bl.cargoDescription}", which does not match the goods on the invoice.`,
        evidence: [
          { documentId: ctx.billOfLading.id, field: 'cargoDescription', value: bl.cargoDescription },
          ...inv.lines.map((l, i) => ({ documentId: ctx.invoice!.id, field: `lines[${i}].description`, value: l.description })),
        ],
        agentRationale: output.rationale,
        suggestedFix: 'Ask the carrier or forwarder to correct the BL description before the cargo report is filed.',
      });
    }
  }
  return { findings: out, decisions };
}
