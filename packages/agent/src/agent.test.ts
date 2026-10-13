import { LlmClient, type LlmProvider } from '@doccheck/extraction';
import { chunkDocument, loadCorpus, parseDocument, RegulationIndex, tokenize } from '@doccheck/regulations';
import { join } from 'node:path';
import { runRules, type ShipmentContext } from '@doccheck/rules';
import { sampleBillOfLading, sampleInvoice, samplePackingList } from '@doccheck/schemas';
import { describe, expect, it } from 'vitest';
import { attachRegulations, citationQuery } from './cite';
import { reviewFindings } from './review';

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
id: "memo"
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
    const [finding] = runRules(c).findings;
    expect(citationQuery(finding, 'CA')).toBe('Country of origin CI1 field 7');
  });

  it('attaches the matching passage, and nothing for rules the corpus does not cover', async () => {
    const c = ctx();
    delete c.invoice!.data.lines[0].countryOfOrigin;
    c.billOfLading!.data.containers[0].number = 'CSQU3054384';
    const findings = await attachRegulations(runRules(c).findings, 'CA', await index());
    expect(findings.find((f) => f.ruleId === 'C1')?.regulation?.excerpt).toMatch(/^Field 7/);
    expect(findings.find((f) => f.ruleId === 'X10')?.regulation).toBeUndefined();
  });
});

describe('citations on the real corpus', () => {
  // Keyword retrieval only (constant embeddings), so the test needs no model; the expected passages
  // are the CI1 field or 141.86 paragraph each rule is about.
  const EXPECTED: [string, 'CA' | 'US', string][] = [
    ['X2', 'CA', 'Field 11: Number of packages'],
    ['X6', 'CA', 'Field 10: Currency of settlement'],
    ['X9', 'CA', 'Field 2: Date of direct shipment'],
    ['X12', 'CA', 'Field 9: Conditions of sale'],
    ['X5', 'US', '(5) The purchase price of each item'],
    ['X12', 'US', '(8) All charges upon the merchandise'],
  ];
  it.each(EXPECTED)('%s (%s) quotes "%s"', async (ruleId, destination, start) => {
    const docs = await loadCorpus(join(__dirname, '../../../data/corpus'));
    const index = await RegulationIndex.build(docs.flatMap((d) => chunkDocument(d)), { id: 'flat', embed: async (t) => t.map(() => [1, 0]) });
    const [f] = await attachRegulations([{ id: ruleId, shipmentId: 's', ruleId, severity: 'LOW', decidedBy: 'RULE', message: '', evidence: [{ documentId: 'd', field: '', value: '' }] }], destination, index);
    expect(f.regulation?.excerpt.startsWith(start)).toBe(true);
  });
});

describe('agent review', () => {
  it('dismisses a name mismatch the model is confident is the same company', async () => {
    const c = ctx();
    c.billOfLading!.data.consignee = { ...sampleBillOfLading.consignee, name: 'Maple Retailers' };
    const findings = runRules(c).findings;
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
    const review = await reviewFindings(c, runRules(c).findings, llm);
    expect(review.findings.map((f) => [f.ruleId, f.decidedBy])).toEqual([['X1', 'RULE'], ['A1', 'AGENT']]);
    expect(review.findings[0].agentRationale).toBe('Cannot tell.');
  });
});
