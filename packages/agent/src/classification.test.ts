import { LlmClient, type LlmProvider } from '@doccheck/extraction';
import type { ShipmentContext } from '@doccheck/rules';
import { sampleBillOfLading, sampleInvoice, samplePackingList } from '@doccheck/schemas';
import { loadTariffData, TariffSearch, tariffLines, type TariffData } from '@doccheck/tariff';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { classificationExtension, planClassification, type ClassificationResources } from './classification';
import { reviewFindings } from './review';

let us: TariffData;
let res: ClassificationResources;
beforeAll(async () => {
  us = await loadTariffData(resolve(__dirname, '../../../data/tariff'), 'US');
  res = { ...us, search: new TariffSearch(us.schedule) };
});

const ctx = (lines: { description: string; hsCode?: string }[]): ShipmentContext => {
  const invoice = structuredClone(sampleInvoice);
  invoice.lines = lines.map((l, i) => ({ ...invoice.lines[0], lineNo: i + 1, sku: `S${i}`, description: l.description, hsCode: l.hsCode }));
  return { shipmentId: 'shp-1', destination: 'US', invoice: { id: 'inv', data: invoice }, packingList: { id: 'pl', data: structuredClone(samplePackingList) }, billOfLading: { id: 'bl', data: structuredClone(sampleBillOfLading) } };
};

/** Scripted model: answers each call with the next queued output, and keeps the prompts. */
function scripted(outputs: unknown[]) {
  const prompts: string[] = [];
  const provider: LlmProvider = {
    id: 'scripted',
    generate: async (req) => {
      prompts.push(JSON.stringify(req));
      return { output: outputs.shift() };
    },
  };
  return { llm: new LlmClient(provider), prompts };
}

describe('classification plan', () => {
  it('skips the model when the search already ranks the declared heading, asks otherwise, and suggests for a line without a code', async () => {
    const c = ctx([
      { description: 'Plush teddy bears, stuffed toys', hsCode: '9503.00' },
      { description: "Children's bicycle, 16 inch wheels", hsCode: '9503.00' },
      { description: 'Ball bearings 6204-2RS' },
    ]);
    const lines = tariffLines(c, us.schedule);
    const planned = await planClassification(lines, res);
    expect(planned.map((q) => [q.kind, q.line.index])).toEqual([
      ['fit', 1],
      ['suggest', 2],
    ]);
    expect(lines[0].fit).toMatchObject({ verdict: 'yes', by: 'search' });
  });
});

describe('classification review', () => {
  it('adds an A2 finding on a confident "no", cites the chapter note, keeps the declared code, and suggests headings', async () => {
    const c = ctx([{ description: "Children's bicycle, 16 inch wheels", hsCode: '9503.00' }, { description: 'Ball bearings 6204-2RS' }]);
    const lines = tariffLines(c, us.schedule);
    const { llm, prompts } = scripted([
      { consistent: 'yes', confidence: 0.9, rationale: 'Same goods.' }, // A1
      { fits: 'no', confidence: 0.9, rationale: "Chapter 95 Note 1(o) excludes children's bicycles (heading 8712)." },
      { terms: 'ball bearings of steel' },
      { candidates: [{ code: '8482.10', confidence: 0.8, rationale: 'Ball bearings.' }, { code: '9999.99', confidence: 0.5, rationale: 'Made up.' }] },
    ]);
    const ext = await classificationExtension(c, lines, llm, res);
    expect(ext.count).toBe(2);
    const out = await reviewFindings(c, [], llm, undefined, undefined, [ext]);
    const a2 = out.findings.filter((f) => f.ruleId === 'A2');
    expect(a2).toHaveLength(1);
    expect(a2[0]).toMatchObject({ decidedBy: 'AGENT', severity: 'MEDIUM', evidence: [{ field: 'lines[0].hsCode', value: '9503.00' }, { field: 'lines[0].description' }] });
    expect(a2[0].regulation?.title).toBe('HTSUS: Chapter 95, Note 1');
    expect(a2[0].regulation?.excerpt).toMatch(/bicycles \(heading 8712\)/);
    expect(c.invoice!.data.lines[0].hsCode).toBe('9503.00');
    expect(prompts[1]).toMatch(/Chapter 95, Note 1/);
    expect(lines[0].fit).toMatchObject({ verdict: 'no', by: 'agent' });
    expect(lines[0].suggestions?.map((s) => s.code)).toContain('871200');
    // Only offered codes are kept: the made-up one is dropped.
    expect(lines[1].suggestions?.map((s) => s.code)).toEqual(['848210']);
    expect(out.decisions.map((d) => [d.ruleId, d.effect])).toEqual([
      ['A1', 'none'],
      ['A2', 'added'],
      ['HS', 'none'],
    ]);
  });

  it('adds nothing when the model is unsure', async () => {
    const c = ctx([{ description: 'Assorted goods', hsCode: '8471.30' }]);
    const lines = tariffLines(c, us.schedule);
    const { llm } = scripted([{ consistent: 'yes', confidence: 0.9, rationale: '' }, { fits: 'unsure', confidence: 0.4, rationale: 'The description does not say what the goods are.' }]);
    const out = await reviewFindings(c, [], llm, undefined, undefined, [await classificationExtension(c, lines, llm, res)]);
    expect(out.findings).toEqual([]);
    expect(lines[0].fit?.verdict).toBe('unsure');
  });
});
