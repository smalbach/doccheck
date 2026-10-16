import type { LlmClient } from '@doccheck/extraction';
import type { Finding } from '@doccheck/schemas';
import { z } from 'zod';
import type { AgentDecision } from './review';

/** Bump when the prompt changes so cached answers are not reused. */
export const SCREENING_PROMPT_VERSION = 'screening-v1';

const SYSTEM = `You help a compliance analyst review possible matches between a party on freight documents and an entry on a sanctions or restricted party list.
Compare only what is given: names, aliases, addresses, countries. Answer "unsure" whenever they do not settle it; a wrong certain answer is worse than "unsure".
Keep the rationale to one or two sentences and quote the values you compared.`;

export const ListMatchVerdict = z.object({
  sameParty: z.enum(['yes', 'no', 'unsure']),
  confidence: z.number().min(0).max(1),
  rationale: z.string(),
});
export type ListMatchVerdict = z.infer<typeof ListMatchVerdict>;

/** Is the party on the documents the listed party? Asked only for borderline (S2) matches. */
export async function judgeListMatch(llm: LlmClient, party: string, entry: string) {
  return llm.call(SCREENING_PROMPT_VERSION, {
    system: SYSTEM,
    user: `Party on the shipment documents: ${party}
List entry: ${entry}

Question: is the party on the documents the same legal entity or person as the list entry, written differently (transliteration, abbreviation, legal form, typo)?
Companies that only share a common word, or are in different countries with nothing else in common, are not the same party.`,
    schema: ListMatchVerdict,
  });
}

/** Confidence at which the model's "yes" raises a possible match to HIGH. */
const ACT_CONFIDENCE = 0.7;

/**
 * Second look at the borderline screening matches (S2). The model compares the party with the list
 * entry and its rationale is attached; a confident "same party" raises the finding to HIGH. It never
 * dismisses one: clearing a possible sanctions match is a person's decision, recorded with a reason
 * (the allowlist). Strong matches (S1) are never sent to the model at all.
 */
export async function reviewScreeningMatches(
  findings: Finding[],
  questions: { findingId: string; party: string; entry: string }[],
  llm: LlmClient,
): Promise<{ findings: Finding[]; decisions: AgentDecision[]; failed: number }> {
  const decisions: AgentDecision[] = [];
  const byId = new Map(questions.map((q) => [q.findingId, q]));
  let failed = 0;
  const out: Finding[] = [];
  for (const f of findings) {
    const q = f.ruleId === 'S2' ? byId.get(f.id) : undefined;
    if (!q) {
      out.push(f);
      continue;
    }
    const question = 'Same party as the list entry?';
    try {
      const { output: o } = await judgeListMatch(llm, q.party, q.entry);
      const raise = o.sameParty === 'yes' && o.confidence >= ACT_CONFIDENCE;
      decisions.push({ ruleId: 'S2', question, verdict: o.sameParty, confidence: o.confidence, rationale: o.rationale, effect: 'kept' });
      out.push({ ...f, ...(raise ? { severity: 'HIGH' as const } : {}), agentRationale: o.rationale });
    } catch {
      // No model (or no cached answer in the demo): the finding stands as the rule wrote it.
      failed++;
      out.push(f);
    }
  }
  return { findings: out, decisions, failed };
}
