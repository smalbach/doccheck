import { describe, expect, it } from 'vitest';
import { expandPattern, fieldConfidence, jsonLeafSpans, leafLogprobs, lowConfidence, ocrWordConfidence } from './confidence';
import { LlmClient, type LlmProvider } from './llm';
import type { PdfText } from './pdf-text';
import { RawInvoice } from './raw-schemas';
import { detectSupplier, exampleFromCorrection, examplesPrompt, pointerToField, rawFieldOf, supplierKey } from './supplier-examples';
import { extractionRequest } from './extract';

const pdf = (lines: string[], extra: Partial<PdfText> = {}): PdfText => ({
  pageCount: 1,
  text: lines.join('\n'),
  lines: lines.map((text, i) => ({ page: 1, text, bbox: [10, 10 + i * 12, 300, 10] as [number, number, number, number] })),
  ...extra,
});

describe('field confidence', () => {
  const lines = ['COMMERCIAL INVOICE  No. INV-2026-001', 'Date 14-MAR-2026', 'NET WEIGHT 1,200 KG   GROSS WEIGHT 1,250 KG', 'TOTAL USD 48,600.00'];
  const raw = { invoiceNumber: 'INV-2026-001', invoiceDate: '14-MAR-2026', netWeight: { value: '1,200', unit: 'KG' }, grossWeight: { value: '1,520', unit: 'KG' }, invoiceTotal: '48,600.00', lines: [] };
  const data = { invoiceNumber: 'INV-2026-001', invoiceDate: '2026-03-14', netWeight: { kg: '1200', raw: { value: '1200', unit: 'KG' } }, grossWeight: { kg: '1520', raw: { value: '1520', unit: 'KG' } }, invoiceTotal: { amount: '48600.00', currency: 'USD' }, lines: [] };

  it('is sure of values printed on the document and doubts one that is not', () => {
    const fields = fieldConfidence({ type: 'COMMERCIAL_INVOICE', documentId: 'd1', raw, data, pdf: pdf(lines), issues: [] });
    const by = Object.fromEntries(fields.map((f) => [f.path, f]));
    expect(by['/invoiceNumber']).toMatchObject({ confidence: 1, reasons: [], source: { page: 1, rawText: lines[0] } });
    // Dates are compared as printed, not as normalized.
    expect(by['/invoiceDate']?.confidence).toBe(1);
    expect(by['/netWeight/kg']).toMatchObject({ confidence: 1, printed: '1,200' });
    // "1,520" is not on the page: the model misread "1,250".
    expect(by['/grossWeight/kg']).toMatchObject({ confidence: 0.5, reasons: ['not-printed'] });
    expect(lowConfidence(fields).map((f) => f.path)).toEqual(['/grossWeight/kg']);
  });

  it('caps values on pages read with OCR by the engine confidence', () => {
    const fields = fieldConfidence({ type: 'COMMERCIAL_INVOICE', documentId: 'd1', raw, data, pdf: pdf(lines, { ocrPages: [1], ocrConfidence: 72 }), issues: [] });
    expect(fields.find((f) => f.path === '/invoiceNumber')).toMatchObject({ confidence: 0.72, reasons: ['ocr'] });
  });

  it('takes the OCR scores of the words a value is read from', () => {
    const line = { page: 1, text: 'TOTAL USD 48,600.00', bbox: [0, 0, 1, 1] as [number, number, number, number], ocr: [[0, 5, 96], [6, 9, 91], [10, 19, 58]] as [number, number, number][] };
    expect(ocrWordConfidence(line, '48,600.00')).toBe(0.58);
    expect(ocrWordConfidence(line, 'USD')).toBe(0.91);
    // Not on the line as copied: the weakest word of the line.
    expect(ocrWordConfidence(line, 'EUR')).toBe(0.58);
    expect(ocrWordConfidence({ ...line, ocr: undefined }, 'USD')).toBeUndefined();
    const scan = pdf([lines[0]!], { ocrPages: [1], ocrConfidence: 90 });
    scan.lines[0]!.ocr = [[0, 18, 99], [21, 36, 64]];
    const fields = fieldConfidence({ type: 'COMMERCIAL_INVOICE', documentId: 'd1', raw: { invoiceNumber: 'INV-2026-001' }, data: { invoiceNumber: 'INV-2026-001' }, pdf: scan, issues: [] });
    expect(fields[0]).toMatchObject({ path: '/invoiceNumber', confidence: 0.64, reasons: ['ocr'] });
  });

  it('lists a value the normalizer dropped, with where it is printed', () => {
    const fields = fieldConfidence({
      type: 'COMMERCIAL_INVOICE',
      documentId: 'd1',
      raw,
      data: { ...data, invoiceTotal: undefined },
      pdf: pdf(lines),
      issues: ['invoiceTotal.amount: could not normalize "48,600.00"', 'Read with OCR (page 1): check values against the scan'],
    });
    expect(fields.find((f) => f.path === '/invoiceTotal/amount')).toMatchObject({ value: null, printed: '48,600.00', confidence: 0.3, reasons: ['normalizer'], source: { rawText: lines[3] } });
  });

  it('doubts what a second reading reads differently, and uses token probabilities when given', () => {
    const fields = fieldConfidence({
      type: 'COMMERCIAL_INVOICE',
      documentId: 'd1',
      raw,
      data,
      pdf: pdf(lines),
      issues: [],
      secondRaw: { ...raw, invoiceNumber: 'INV-2026-007' },
      logprobs: { invoiceDate: Math.log(0.6) },
    });
    expect(fields.find((f) => f.path === '/invoiceNumber')).toMatchObject({ confidence: 0.4, reasons: ['passes-disagree'] });
    expect(fields.find((f) => f.path === '/invoiceDate')).toMatchObject({ confidence: 0.6, reasons: ['low-logprob'] });
  });

  it('expands [*] over the items of each array', () => {
    expect(expandPattern({ lines: [{}, {}] }, 'lines[*].quantity.value')).toEqual(['lines[0].quantity.value', 'lines[1].quantity.value']);
    expect(expandPattern({}, 'lines[*].x')).toEqual([]);
  });
});

describe('token log-probabilities per field', () => {
  it('finds the span of every leaf value', () => {
    const text = '{"a": "x1", "b": {"c": 12}, "d": [ "p", null ], "e": null}';
    const spans = jsonLeafSpans(text);
    expect(text.slice(...spans.get('a')!)).toBe('x1');
    expect(text.slice(...spans.get('b.c')!)).toBe('12');
    expect(text.slice(...spans.get('d[0]')!)).toBe('p');
    expect(spans.has('d[1]')).toBe(false);
  });

  it('takes the lowest token of each value, only when the tokens spell the whole answer', () => {
    const content = '{"total": "48,6OO.00"}';
    const tokens = [
      { token: '{"', logprob: -0.01 }, { token: 'total', logprob: 0 }, { token: '": "', logprob: 0 },
      { token: '48', logprob: -0.05 }, { token: ',6', logprob: -0.1 }, { token: 'OO', logprob: -1.2 }, { token: '.00', logprob: -0.02 }, { token: '"}', logprob: 0 },
    ];
    expect(leafLogprobs(content, tokens)).toEqual({ total: -1.2 });
    // Ollama with a schema returns only the first token: nothing to map.
    expect(leafLogprobs(content, [{ token: '{', logprob: -12 }])).toBeUndefined();
  });

  it('come back from a provider through the client, and from its cache', async () => {
    const content = '{"n": "7"}';
    const provider: LlmProvider = {
      id: 'fake',
      generate: async () => ({ output: { n: '7' }, content, logprobs: [{ token: '{"n": "', logprob: 0 }, { token: '7', logprob: -0.5 }, { token: '"}', logprob: 0 }] }),
    };
    const { z } = await import('zod');
    const llm = new LlmClient(provider);
    const r = await llm.call('v', { system: 's', user: 'u', schema: z.object({ n: z.string() }), logprobs: true });
    expect(r.logprobs).toEqual({ n: -0.5 });
  });
});

describe('supplier examples', () => {
  const lines = ['ACME TOYS CO., LTD.  Shenzhen', 'NET WEIGHT 1,250 KG   GROSS WEIGHT 1,200 KG'];

  it('maps a corrected value to the answer field the model fills', () => {
    expect(pointerToField('/lines/0/quantity/value')).toBe('lines[0].quantity.value');
    expect(rawFieldOf('COMMERCIAL_INVOICE', 'lines[3].quantity.value')).toBe('lines[3].quantity');
    expect(rawFieldOf('COMMERCIAL_INVOICE', 'netWeight.kg')).toBe('netWeight.value');
    expect(rawFieldOf('COMMERCIAL_INVOICE', 'language')).toBeUndefined();
  });

  it('turns a correction into an example with the line it is printed on', () => {
    const raw = { netWeight: { value: '1,250', unit: 'KG' } };
    expect(exampleFromCorrection({ documentType: 'COMMERCIAL_INVOICE', path: '/netWeight/kg', newValue: '1200', raw, pdf: pdf(lines) })).toEqual({
      documentType: 'COMMERCIAL_INVOICE',
      field: 'netWeight.value',
      modelValue: '1,250',
      correctValue: '1200',
      line: 'NET WEIGHT 1,250 KG GROSS WEIGHT 1,200 KG',
    });
    // Fields the model does not fill directly are not learned.
    expect(exampleFromCorrection({ documentType: 'COMMERCIAL_INVOICE', path: '/language', newValue: 'en', raw })).toBeUndefined();
  });

  it('adds the examples to the prompt only when there are some, for that document type', () => {
    const text = pdf(lines);
    const base = extractionRequest(text, 'COMMERCIAL_INVOICE');
    expect(extractionRequest(text, 'COMMERCIAL_INVOICE', { supplier: 'ACME', examples: [] }).system).toBe(base.system);
    const example = { documentType: 'COMMERCIAL_INVOICE' as const, field: 'netWeight.value', modelValue: '1,250', correctValue: '1200' };
    const withExample = extractionRequest(text, 'COMMERCIAL_INVOICE', { supplier: 'ACME', examples: [example, { ...example, documentType: 'PACKING_LIST' }] }).system;
    expect(withExample.startsWith(base.system)).toBe(true);
    expect(withExample).toContain('"netWeight.value": you copied "1,250", but the right value is "1200" kg.');
    expect(withExample.match(/netWeight/g)).toHaveLength(1);
    expect(examplesPrompt('ACME', [])).toBe('');
    expect(base.schema).toBe(RawInvoice);
  });

  it('recognizes a known supplier in the text before the model runs', () => {
    const known = [{ key: supplierKey('ACME'), name: 'ACME' }, { key: supplierKey('Acme Toys Co., Ltd.'), name: 'Acme Toys Co., Ltd.' }, { key: supplierKey('Bolt'), name: 'Bolt' }];
    expect(supplierKey('Acme Toys Co., Ltd.')).toBe('ACME TOYS');
    expect(detectSupplier(pdf(lines), known)?.name).toBe('Acme Toys Co., Ltd.');
    expect(detectSupplier(pdf(['Nothing here']), known)).toBeUndefined();
  });
});
