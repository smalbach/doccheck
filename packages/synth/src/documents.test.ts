import { describe, expect, it } from 'vitest';
import { DOCUMENT_RULE_IDS, runRules, V1_RULE_IDS } from '@doccheck/rules';
import { DOCUMENT_SCHEMAS } from '@doccheck/schemas';
import { buildDataset } from './dataset';
import { buildDocsDataset, DOCS_ERROR_KINDS, docsContext } from './documents';
import { renderDocsHtml } from './render-documents';
import { RULES_SET_PARAMS } from './rules-set';

// Set v1-docs is labeled for the v1 rules and the rules on the other documents.
const ONLY = { only: [...V1_RULE_IDS, ...DOCUMENT_RULE_IDS] };

const dataset = buildDataset();
const docs = buildDocsDataset(dataset);
const SCHEMA_OF = { airWaybill: 'AIR_WAYBILL', certificateOfOrigin: 'CERTIFICATE_OF_ORIGIN', cusmaCertification: 'CUSMA_CERTIFICATION', arrivalNotice: 'ARRIVAL_NOTICE', woodPackaging: 'WOOD_PACKAGING_CERTIFICATE', dangerousGoods: 'DANGEROUS_GOODS_DECLARATION' } as const;

describe('set v1-docs', () => {
  it('is reproducible, leaves v1 alone and mixes the documents', () => {
    expect(JSON.stringify(buildDocsDataset(buildDataset()))).toBe(JSON.stringify(docs));
    expect(JSON.stringify(buildDataset())).toBe(JSON.stringify(dataset));
    expect(docs).toHaveLength(40);
    const has = (k: string) => docs.filter((e) => (e.shipment.documents as Record<string, unknown>)[k]).length;
    for (const k of Object.keys(SCHEMA_OF)) expect([k, has(k) > 2]).toEqual([k, true]);
    expect(new Set(docs.flatMap((e) => e.labels.map((l) => l.kind))).size).toBeGreaterThanOrEqual(DOCS_ERROR_KINDS.length - 1);
  });

  it('every document passes its schema', () => {
    for (const { shipment } of docs) {
      for (const [k, type] of Object.entries(SCHEMA_OF)) {
        const d = (shipment.documents as Record<string, unknown>)[k];
        if (d) expect([shipment.id, k, DOCUMENT_SCHEMAS[type].safeParse(d).error]).toEqual([shipment.id, k, undefined]);
      }
    }
  });

  it('the rules flag exactly what each label expects, and cite the labelled field', () => {
    for (const { shipment, labels } of docs) {
      const findings = runRules(docsContext(shipment), RULES_SET_PARAMS, ONLY).findings;
      const expected = [...new Set(labels.flatMap((l) => l.expectedRuleIds))].sort();
      expect([shipment.id, [...new Set(findings.map((f) => f.ruleId))].sort()]).toEqual([shipment.id, expected]);
      for (const l of labels) {
        const cited = findings.filter((f) => l.expectedRuleIds.includes(f.ruleId)).some((f) => f.evidence.some((ev) => ev.documentId === l.document && ev.field === l.field));
        expect([shipment.id, l.kind, cited]).toEqual([shipment.id, l.kind, true]);
      }
    }
  });

  it('prints the values the extraction is scored on', () => {
    for (const { shipment } of docs.slice(0, 20)) {
      const html = renderDocsHtml(shipment);
      const d = shipment.documents;
      if (d.airWaybill) expect(html['air-waybill']).toContain(d.airWaybill.awbNumber);
      if (d.certificateOfOrigin) expect(html['certificate-of-origin']).toContain(d.certificateOfOrigin.certificateNumber);
      if (d.arrivalNotice) expect(html['arrival-notice']).toContain(d.arrivalNotice.transportDocumentNumber);
      if (d.dangerousGoods) expect(html['dangerous-goods']).toContain('UN 3481');
    }
  });
});
