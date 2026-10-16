import { describe, expect, it } from 'vitest';
import { LlmClient, type LlmProvider } from '@doccheck/extraction';
import type { Finding } from '@doccheck/schemas';
import { reviewScreeningMatches } from './screening';

function scripted(outputs: unknown[]): LlmClient {
  const provider: LlmProvider = { id: 'scripted', generate: async () => ({ output: outputs.shift() }) };
  return new LlmClient(provider);
}

const finding = (id: string, ruleId: string, severity: Finding['severity']): Finding => ({
  id,
  shipmentId: 's',
  ruleId,
  severity,
  decidedBy: 'RULE',
  message: 'm',
  evidence: [{ documentId: 'inv', field: 'seller.name', value: 'X' }],
});

describe('screening review', () => {
  it('asks only about S2, never dismisses, and raises a confident same-party answer to HIGH', async () => {
    const findings = [finding('s:S1:0', 'S1', 'HIGH'), finding('s:S2:0', 'S2', 'MEDIUM'), finding('s:S2:1', 'S2', 'MEDIUM')];
    const llm = scripted([
      { sameParty: 'yes', confidence: 0.9, rationale: 'Same name and city.' },
      { sameParty: 'no', confidence: 0.95, rationale: 'Different country.' },
    ]);
    const questions = [
      { findingId: 's:S2:0', party: 'A', entry: 'A listed' },
      { findingId: 's:S2:1', party: 'B', entry: 'B listed' },
    ];
    const out = await reviewScreeningMatches(findings, questions, llm);
    expect(out.findings.map((f) => [f.ruleId, f.severity, f.agentRationale])).toEqual([
      ['S1', 'HIGH', undefined],
      ['S2', 'HIGH', 'Same name and city.'],
      ['S2', 'MEDIUM', 'Different country.'],
    ]);
    expect(out.decisions.map((d) => [d.verdict, d.effect])).toEqual([['yes', 'kept'], ['no', 'kept']]);
  });

  it('keeps the finding as it is when the model fails', async () => {
    const provider: LlmProvider = { id: 'down', generate: async () => { throw new Error('offline'); } };
    const out = await reviewScreeningMatches([finding('s:S2:0', 'S2', 'MEDIUM')], [{ findingId: 's:S2:0', party: 'A', entry: 'B' }], new LlmClient(provider));
    expect(out).toMatchObject({ failed: 1, decisions: [], findings: [{ severity: 'MEDIUM' }] });
  });
});
