import { chunkDocument, loadCorpus, RegulationIndex } from '@doccheck/regulations';
import { join } from 'node:path';
import { runRules, type ShipmentContext } from '@doccheck/rules';
import { sampleBillOfLading, sampleInvoice, samplePackingList, type Destination, type Finding } from '@doccheck/schemas';
import { describe, expect, it } from 'vitest';
import { attachRegulations, citationQuery, citationScope } from './cite';

/** The sample shipment to Mexico, the EU or the UK, with the importer's number on the buyer. */
const ctx = (destination: 'MX' | 'EU' | 'GB', taxId: string): ShipmentContext => {
  const c: ShipmentContext = structuredClone({
    shipmentId: 'shp-1',
    destination: destination as Destination,
    invoice: { id: 'inv', data: sampleInvoice },
    packingList: { id: 'pl', data: samplePackingList },
    billOfLading: { id: 'bl', data: sampleBillOfLading },
  });
  c.invoice!.data.buyer = { ...c.invoice!.data.buyer, taxId };
  c.invoice!.data.consignee = c.invoice!.data.buyer;
  c.invoice!.data.seller = { ...c.invoice!.data.seller, taxId: '91440300MA5XXXXX1' };
  return c;
};

// Keyword retrieval only (constant embeddings), so the test needs no model.
const realIndex = async () => {
  const docs = await loadCorpus(join(__dirname, '../../../data/corpus'));
  return RegulationIndex.build(docs.flatMap((d) => chunkDocument(d)), { id: 'flat', embed: async (t) => t.map(() => [1, 0]) });
};

const cite = async (c: ShipmentContext, pick: (f: Finding) => boolean) => {
  const findings = runRules(c).findings.filter(pick);
  expect(findings).toHaveLength(1);
  return (await attachRegulations(findings, c.destination, await realIndex()))[0];
};

describe('citations for Mexico, the EU and the UK', () => {
  it('completeness queries keep the reference and drop the authority', () => {
    const c = ctx('EU', 'DE123456789012345');
    delete c.invoice!.data.lines[0].countryOfOrigin;
    const [f] = runRules(c).findings;
    expect(citationQuery(f, 'EU')).toBe('Country of origin Annex B D.E. 16 08 000 000');
    expect(citationScope(f, 'EU')).toEqual(['eu-2015-2446']);
  });

  it('M1 cites regla 3.1.8 for the place and date, regla 1.9.19 for the RFC', async () => {
    const c = ctx('MX', '');
    delete c.invoice!.data.invoiceDate;
    const date = await cite(c, (f) => f.ruleId === 'M1' && f.evidence[0].field === 'invoiceDate');
    expect(date.regulation?.title).toMatch(/Regla 3\.1\.8\./);
    const rfc = await cite(c, (f) => f.ruleId === 'M1' && f.evidence[0].field === 'buyer.taxId');
    expect(rfc.regulation?.title).toMatch(/Regla 1\.9\.19\./);
    expect(rfc.regulation?.url).toContain('dof.gob.mx');
  });

  it('M3 quotes the translation paragraph of regla 3.1.8', async () => {
    const c = ctx('MX', 'MAG041126GT8');
    c.invoice!.data.language = 'zh';
    const f = await cite(c, (x) => x.ruleId === 'M3');
    expect(f.regulation?.excerpt).toMatch(/^Cuando los datos a que se refiere la fracción III/);
  });

  it('E1 cites the Annex B data element; E2 the EORI definition', async () => {
    const c = ctx('EU', '');
    c.invoice!.data.consignee = { ...c.invoice!.data.consignee!, taxId: undefined };
    const e1 = await cite(c, (f) => f.ruleId === 'E1');
    expect(e1.regulation?.title).toContain('D.E. 13 04 017 000 Identification number (Importer)');
    const e2 = await cite(ctx('EU', 'GB123456789000'), (f) => f.ruleId === 'E2');
    expect(e2.regulation?.excerpt).toMatch(/^\(18\) ‘Economic Operators Registration and Identification number/);
  });

  it('K1 cites the CDS data element; K2 the EORI manual', async () => {
    const c = ctx('GB', '');
    c.invoice!.data.consignee = { ...c.invoice!.data.consignee!, taxId: undefined };
    const k1 = await cite(c, (f) => f.ruleId === 'K1');
    expect(k1.regulation?.title).toContain('DE 3/16 Importer Identification Number');
    const k2 = await cite(ctx('GB', 'DE123456789'), (f) => f.ruleId === 'K2');
    expect(k2.regulation?.excerpt).toMatch(/A GB EORI has 12 digits and the prefix ‘GB’/);
  });
});
