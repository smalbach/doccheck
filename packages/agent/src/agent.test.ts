import { LlmClient, type LlmProvider } from '@doccheck/extraction';
import { chunkDocument, loadCorpus, parseDocument, RegulationIndex, tokenize } from '@doccheck/regulations';
import { join } from 'node:path';
import { runRules, type ShipmentContext } from '@doccheck/rules';
import { sampleBillOfLading, sampleInvoice, samplePackingList, type ValidationUpdate } from '@doccheck/schemas';
import { describe, expect, it } from 'vitest';
import { attachRegulations, citationQuery } from './cite';
import { countAgentQuestions, reviewFindings } from './review';

// The fixture BL's carrier SCAC (EXLN) is made up: known to the account, as an NVOCC's would be (X15).
const rules = (c: ShipmentContext) => runRules(c, { knownScacs: ['EXLN'] });

const ctx = (): ShipmentContext =>
  structuredClone({
    shipmentId: 'shp-1',
    destination: 'CA',
    invoice: { id: 'inv', data: sampleInvoice },
    packingList: { id: 'pl', data: samplePackingList },
    billOfLading: { id: 'bl', data: sampleBillOfLading },
  });

/** Scripted model: answers each call with the next queued output. */
function scripted(outputs: unknown[]): LlmClient {
  const provider: LlmProvider = { id: 'scripted', generate: async () => ({ output: outputs.shift() }) };
  return new LlmClient(provider);
}

const CORPUS = parseDocument(`---
id: "cbsa-d1-4-1-en"
title: "Memo"
authority: "CBSA"
language: "en"
url: "https://example.test/memo"
---

## Appendix A

Field 7: Country of origin of goods - Indicate the country of origin.

Field 4: Consignee - The name and address of the party to which the goods are shipped to.
`);
const VOCAB = ['country', 'origin', 'consignee', 'address', 'shipped'];
const index = () => RegulationIndex.build(chunkDocument(CORPUS, 80), { id: 'fake', embed: async (t) => t.map((x) => VOCAB.map((w) => (tokenize(x).includes(w) ? 1 : 0.01))) });

describe('citations', () => {
  it('builds the query of a completeness finding from its field label and reference', () => {
    const c = ctx();
    delete c.invoice!.data.lines[0].countryOfOrigin;
    const [finding] = rules(c).findings;
    expect(citationQuery(finding, 'CA')).toBe('Country of origin CI1 field 7');
  });

  it('attaches the matching passage, and nothing for rules the corpus does not cover', async () => {
    const c = ctx();
    delete c.invoice!.data.lines[0].countryOfOrigin;
    c.billOfLading!.data.containers[0].number = 'CSQU3054384';
    const cited: string[] = [];
    const findings = await attachRegulations(rules(c).findings, 'CA', await index(), (f) => {
      cited.push(f.id);
      throw new Error('ignored');
    });
    expect(findings.find((f) => f.ruleId === 'C1')?.regulation?.excerpt).toMatch(/^Field 7/);
    expect(findings.find((f) => f.ruleId === 'X10')?.regulation).toBeUndefined();
    expect(cited).toEqual(findings.filter((f) => f.regulation).map((f) => f.id));
  });
});

describe('citations on the real corpus', () => {
  // Keyword retrieval only (constant embeddings), so the test needs no model; the expected passages
  // are the CI1 field, 141.86 paragraph or 149.3 element each rule is about. The corpus also has
  // marking, origin and valuation documents that must not take these citations.
  const realIndex = async () => {
    const docs = await loadCorpus(join(__dirname, '../../../data/corpus'));
    return RegulationIndex.build(docs.flatMap((d) => chunkDocument(d)), { id: 'flat', embed: async (t) => t.map(() => [1, 0]) });
  };
  const EXPECTED: [string, 'CA' | 'US', string, string][] = [
    ['X2', 'CA', '', 'Field 11: Number of packages'],
    ['X5', 'CA', '', 'Field 17: Invoice total'],
    ['X6', 'CA', '', 'Field 10: Currency of settlement'],
    ['X9', 'CA', '', 'Field 2: Date of direct shipment'],
    ['X12', 'CA', '', 'Field 9: Conditions of sale'],
    ['X1', 'US', '', '(2) The time when, the place where, and the person by whom'],
    ['X3', 'US', '', '(4) The quantities in the weights and measures'],
    ['X5', 'US', '', '(5) The purchase price of each item'],
    ['X6', 'US', '', '(5) The purchase price of each item'],
    ['X12', 'US', '', '(8) All charges upon the merchandise'],
    ['X11', 'US', 'countryOfOrigin', '(7) Country of origin.'],
    ['X11', 'US', 'htsCode', '(8) Commodity HTSUS number.'],
    ['X11', 'US', 'seller.name', '(1) Seller.'],
    ['X11', 'US', 'buyer.name', '(2) Buyer.'],
  ];
  it.each(EXPECTED)('%s (%s) %s quotes "%s"', async (ruleId, destination, field, start) => {
    const [f] = await attachRegulations([{ id: ruleId, shipmentId: 's', ruleId, severity: 'LOW', decidedBy: 'RULE', message: '', evidence: [{ documentId: 'd', field, value: '' }] }], destination, await realIndex());
    expect(f.regulation?.excerpt.startsWith(start)).toBe(true);
  });

  it('cites the invoice field for a missing country of origin, not the marking or origin memoranda', async () => {
    const index = await realIndex();
    for (const [destination, ruleId, url, start] of [
      ['CA', 'C1', 'd1-4-1-eng', 'Field 7: Country of origin'],
      ['US', 'U1', 'section-141.86', '(10) The country of origin'],
    ] as const) {
      const c = { ...ctx(), destination };
      delete c.invoice!.data.lines[0].countryOfOrigin;
      const findings = await attachRegulations(rules(c).findings.filter((f) => f.ruleId === ruleId && /^Country of origin/.test(f.message)), destination, index);
      expect(findings).toHaveLength(1);
      expect(findings[0].regulation?.url).toContain(url);
      expect(findings[0].regulation?.excerpt.startsWith(start)).toBe(true);
    }
  });

  it('gives the A1 model the description paragraph of 141.86, not 141.89', async () => {
    const prompts: string[] = [];
    const provider: LlmProvider = {
      id: 'scripted',
      generate: async (req) => {
        prompts.push(JSON.stringify(req));
        return { output: { consistent: 'yes', confidence: 0.9, rationale: 'Toys.' } };
      },
    };
    await reviewFindings({ ...ctx(), destination: 'US' }, [], new LlmClient(provider), await realIndex());
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('(3) A detailed description of the merchandise');
  });
});

describe('agent review', () => {
  it('dismisses a name mismatch the model is confident is the same company', async () => {
    const c = ctx();
    c.billOfLading!.data.consignee = { ...sampleBillOfLading.consignee, name: 'Maple Retailers' };
    const findings = rules(c).findings;
    expect(findings.map((f) => f.ruleId)).toEqual(['X1']);
    const llm = scripted([
      { sameParty: 'yes', confidence: 0.9, rationale: 'Same company.' },
      { consistent: 'yes', confidence: 0.9, rationale: 'Toys.' },
    ]);
    const review = await reviewFindings(c, findings, llm);
    expect(review.findings).toEqual([]);
    expect(review.decisions.map((d) => [d.ruleId, d.effect])).toEqual([['X1', 'dismissed'], ['A1', 'none']]);
  });

  it('keeps the finding when unsure and adds A1 when the BL describes other goods', async () => {
    const c = ctx();
    c.billOfLading!.data.consignee = { ...sampleBillOfLading.consignee, name: 'Maple Holdings' };
    const llm = scripted([
      { sameParty: 'unsure', confidence: 0.5, rationale: 'Cannot tell.' },
      { consistent: 'no', confidence: 0.9, rationale: 'Steel pipes are not toys.' },
    ]);
    const review = await reviewFindings(c, rules(c).findings, llm);
    expect(review.findings.map((f) => [f.ruleId, f.decidedBy])).toEqual([['X1', 'RULE'], ['A1', 'AGENT']]);
    expect(review.findings[0].agentRationale).toBe('Cannot tell.');
  });

  it('reports each question asked and answered, numbered against the total known up front', async () => {
    const c = ctx();
    c.billOfLading!.data.consignee = { ...sampleBillOfLading.consignee, name: 'Maple Retailers' };
    const findings = rules(c).findings;
    expect(countAgentQuestions(c, findings)).toBe(2);
    expect(countAgentQuestions({ ...c, billOfLading: undefined }, findings)).toBe(0);
    const llm = scripted([
      { sameParty: 'yes', confidence: 0.9, rationale: 'Same company.' },
      { consistent: 'yes', confidence: 0.9, rationale: 'Toys.' },
    ]);
    const seen: ValidationUpdate[] = [];
    await reviewFindings(c, findings, llm, undefined, (u) => void seen.push(u));
    expect(seen.map((u) => [u.status, u.detail && 'index' in u.detail ? u.detail.index : undefined, u.detail && 'answer' in u.detail ? u.detail.answer?.verdict : undefined])).toEqual([
      ['started', undefined, undefined],
      ['progress', 1, undefined],
      ['progress', 1, 'yes'],
      ['progress', 2, undefined],
      ['progress', 2, 'yes'],
      ['done', undefined, undefined],
    ]);
    expect(seen[0].detail).toEqual({ model: 'scripted', total: 2 });
    expect(seen[2].detail).toMatchObject({ ruleId: 'X1', question: 'Same consignee written differently?', total: 2, answer: { confidence: 0.9, rationale: 'Same company.', effect: 'dismissed' } });
    expect(seen[5]).toMatchObject({ durationMs: expect.any(Number), detail: { decisions: 2 } });
  });

  it('names the finding each question is about, and previews a finding the agent adds', async () => {
    const c = ctx();
    c.billOfLading!.data.consignee = { ...sampleBillOfLading.consignee, name: 'Maple Holdings' };
    const findings = rules(c).findings;
    const x1 = findings.find((f) => f.ruleId === 'X1')!;
    const llm = scripted([
      { sameParty: 'unsure', confidence: 0.5, rationale: 'Cannot tell.' },
      { consistent: 'no', confidence: 0.9, rationale: 'Steel pipes are not toys.' },
    ]);
    const seen: ValidationUpdate[] = [];
    const review = await reviewFindings(c, findings, llm, undefined, (u) => void seen.push(u));
    const progress = seen.filter((u) => u.status === 'progress').map((u) => u.detail as Record<string, unknown>);
    expect(progress[0]).toMatchObject({ ruleId: 'X1', findingId: x1.id });
    expect(progress[1]).toMatchObject({ findingId: x1.id, answer: { effect: 'kept' } });
    expect(progress[2]).not.toHaveProperty('findingId');
    const added = review.findings.find((f) => f.ruleId === 'A1')!;
    expect(progress[3]).toMatchObject({ findingId: added.id, added: { id: added.id, severity: 'MEDIUM', message: added.message }, answer: { effect: 'added' } });
  });

  it('reports a failed model call on the agent stage', async () => {
    const seen: ValidationUpdate[] = [];
    await expect(reviewFindings(ctx(), [], scripted([{ nonsense: true }, { nonsense: true }]), undefined, (u) => void seen.push(u))).rejects.toThrow();
    expect(seen.at(-1)).toMatchObject({ stage: 'agent', status: 'failed', detail: { error: expect.stringContaining('schema') } });
  });
});
