import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ShipmentContext } from '@doccheck/rules';
import { sampleBillOfLading, sampleInvoice, samplePackingList, type Isf } from '@doccheck/schemas';
import { highRiskSector, xinjiangTerm } from './forced-labour';
import { loadScreening, type LoadedScreening } from './load';
import { ScreeningIndex } from './matcher';
import { parseCsl } from './parse/csl';
import { parseCsv } from './parse/formats';
import { parseEu } from './parse/eu';
import { parseOfac } from './parse/ofac';
import { parseSema } from './parse/sema';
import { parseUflpa, splitUflpaName } from './parse/uflpa';
import { parseUn } from './parse/un';
import { screenShipment, shipmentParties } from './screen';
import { SOURCES } from './sources';
import { readManifest, refreshLists } from './store';
import { countryCode, jaroWinkler, nameTokens, partyKey } from './text';
import type { ListEntry } from './types';

const FIXTURES = resolve(__dirname, '../fixtures');
const raw = (name: string) => readFile(join(FIXTURES, 'raw', name), 'utf8');

const clean = (): ShipmentContext =>
  structuredClone({
    shipmentId: 'shp-1',
    destination: 'US',
    invoice: { id: 'inv-1', data: sampleInvoice },
    packingList: { id: 'pl-1', data: samplePackingList },
    billOfLading: { id: 'bl-1', data: sampleBillOfLading },
  });

let lists: LoadedScreening;
beforeAll(async () => {
  lists = await loadScreening(FIXTURES);
});

describe('text', () => {
  it('computes Jaro-Winkler like the reference examples', () => {
    expect(jaroWinkler('MARTHA', 'MARHTA')).toBeCloseTo(0.961, 3);
    expect(jaroWinkler('DWAYNE', 'DUANE')).toBeCloseTo(0.84, 2);
    expect(jaroWinkler('DIXON', 'DICKSONX')).toBeCloseTo(0.813, 3);
    expect(jaroWinkler('ABC', 'ABC')).toBe(1);
    expect(jaroWinkler('', 'ABC')).toBe(0);
  });

  it('normalizes names like X1 and also drops list legal forms and filler', () => {
    expect(nameTokens('Hetian Taida Apparel Co., Ltd')).toEqual(['HETIAN', 'TAIDA', 'APPAREL']);
    expect(nameTokens('ROSOBORONEKSPORT OAO')).toEqual(['ROSOBORONEKSPORT']);
    expect(nameTokens('The Bank of Kunlun')).toEqual(['BANK', 'KUNLUN']);
    expect(partyKey('ABU TEIR, Mohammed')).toBe(partyKey('Mohammed Abu-Teir'));
  });

  it('maps country names the lists print to ISO codes', () => {
    expect(countryCode('Cuba')).toBe('CU');
    expect(countryCode("Democratic People's Republic of Korea")).toBe('KP');
    expect(countryCode('Iran (Islamic Republic of)')).toBe('IR');
    expect(countryCode('Belarus / Bélarus')).toBe('BY');
    expect(countryCode('Russia')).toBe('RU');
    expect(countryCode('CN')).toBe('CN');
    expect(countryCode('Atlantis')).toBeUndefined();
  });
});

describe('list parsers', () => {
  it('reads CSV with quoted delimiters, quotes and line breaks', () => {
    expect(parseCsv('a,"b, c","say ""hi""\nthere"\n1,2,3\n')).toEqual([['a', 'b, c', 'say "hi"\nthere'], ['1', '2', '3']]);
    expect(parseCsv('x;y\n"1;2";3', ';')).toEqual([['x', 'y'], ['1;2', '3']]);
  });

  it('reads the OFAC SDN files: names, aliases, addresses with cities and countries', async () => {
    const entries = parseOfac('ofac-sdn', { prim: await raw('sdn.csv'), add: await raw('add.csv'), alt: await raw('alt.csv') });
    expect(entries.map((e) => e.name)).toEqual(['AEROCARIBBEAN AIRLINES', 'ANGLO-CARIBBEAN CO., LTD.', 'BANCO NACIONAL DE CUBA']);
    const bnc = entries[2];
    expect(bnc).toMatchObject({ id: '306', type: 'entity', aliases: ['NATIONAL BANK OF CUBA'], programs: ['CUBA'], url: 'https://sanctionssearch.ofac.treas.gov/Details.aspx?id=306' });
    expect(bnc.countries).toEqual(['CH', 'ES', 'JP', 'PA']);
    expect(bnc.addresses[0]).toEqual({ text: 'Zweierstrasse 35, Zurich CH-8022, Switzerland', city: 'Zurich', country: 'CH' });
    expect(entries[1].addresses[0].city).toBe('London');
  });

  it('keeps only the BIS lists of the Consolidated Screening List', async () => {
    const byList = parseCsl(await raw('csl.json'));
    expect(byList.get('bis-el')).toHaveLength(1);
    expect(byList.get('bis-dpl')).toHaveLength(1);
    expect([...byList.values()].flat().some((e) => e.list.startsWith('ofac'))).toBe(false);
    const el = byList.get('bis-el')![0];
    expect(el.aliases.length).toBeGreaterThan(0);
    expect(el.url).toMatch(/^https:\/\//);
  });

  it('reads the SEMA list: persons, entities with aliases and ships, with the regime as program', async () => {
    const entries = parseSema(await raw('sema.xml'));
    expect(entries).toHaveLength(3);
    expect(entries[0]).toMatchObject({ name: 'Khazalbek Bakhtibekovich Atabekov', type: 'individual', countries: [], programs: ['SEMA Belarus, Schedule 1, Part 1'], listedOn: '2020-09-28' });
    expect(entries[1].type).toBe('entity');
    expect(entries[1].aliases.length).toBeGreaterThan(0);
    expect(entries[2].type).toBe('vessel');
  });

  it('reads the UN list with its generation date', async () => {
    const { entries, versionDate } = parseUn(await raw('un.xml'));
    expect(versionDate).toBe('2026-10-15');
    expect(entries.map((e) => [e.id, e.name, e.type])).toEqual([
      ['CDi.001', 'ERIC BADEGE', 'individual'],
      ['CDe.001', 'ADF', 'entity'],
    ]);
    expect(entries[1].aliases).toContain('Allied Democratic Forces');
    expect(entries[0].countries).toEqual(['RW', 'CD']);
  });

  it('groups the EU CSV rows by entity', async () => {
    const { entries, versionDate } = parseEu(await raw('eu.csv'));
    expect(versionDate).toBe('2026-10-15');
    expect(entries[0]).toMatchObject({ id: '13', name: 'Saddam Hussein Al-Tikriti', type: 'individual', programs: ['IRQ'] });
    expect(entries[0].aliases).toContain('Abu Ali');
    expect(entries.some((e) => e.type === 'entity')).toBe(true);
  });

  it('reads the UFLPA Entity List page and splits aliases out of the name', async () => {
    const { entries, versionDate } = parseUflpa(await raw('uflpa.html'));
    // The latest effective date in the list.
    expect(versionDate).toBe('2026-08-03');
    const haolin = entries.find((e) => e.name.startsWith('Hetian Haolin'));
    expect(haolin).toMatchObject({ list: 'dhs-uflpa', countries: ['CN'], aliases: ['Hotan Haolin Hair Accessories', 'Hollin Hair Accessories'], listedOn: '2022-06-21' });
    expect(splitUflpaName('Xinjiang Production and Construction Corps (including three aliases: XPCC; Xinjiang Corps; and Bingtuan) and its subordinate and affiliated entities')).toEqual({
      name: 'Xinjiang Production and Construction Corps',
      aliases: ['XPCC', 'Xinjiang Corps', 'Bingtuan'],
    });
    expect(splitUflpaName('Aksu Huafu Color Spinning Co., Ltd. (also known as Aksu Huafu Textiles Co., Ltd.; Akesu Huafu; and Akesu Huafu Melange Yarn Co., Ltd.)').aliases).toEqual([
      'Aksu Huafu Textiles Co., Ltd.',
      'Akesu Huafu',
      'Akesu Huafu Melange Yarn Co., Ltd.',
    ]);
  });
});

describe('matcher', () => {
  const top = (name: string, country?: string, city?: string) => lists.index.search({ name, country, city }, { minScore: 0.5 })[0];

  it('scores the same name 1, whatever the case, punctuation or legal form', () => {
    expect(top('Banco Nacional de Cuba S.A.')).toMatchObject({ score: 1, entry: { list: 'ofac-sdn', id: '306' } });
    expect(top('HETIAN TAIDA APPAREL CO LTD')).toMatchObject({ score: 1, entry: { list: 'dhs-uflpa' } });
    expect(top('Rosoboroneksport')).toMatchObject({ score: 1 });
  });

  it('finds an entry by its alias, and says which name matched', () => {
    const m = top('National Bank of Cuba');
    expect(m).toMatchObject({ score: 1, matchedName: 'NATIONAL BANK OF CUBA', entry: { name: 'BANCO NACIONAL DE CUBA' } });
    expect(top('Hotan Haolin Hair Accessories')?.entry.name).toBe('Hetian Haolin Hair Accessories Co. Ltd.');
  });

  it('tolerates a misspelt word and a different word order', () => {
    const typo = top('Hetian Tayda Apparel Co., Ltd.');
    expect(typo.entry.name).toBe('Hetian Taida Apparel Co., Ltd');
    expect(typo.score).toBeGreaterThan(0.9);
    expect(typo.score).toBeLessThan(1);
    expect(top('Satar Ghoura Abdul')).toMatchObject({ score: 1, entry: { name: 'Abdul Satar Ghoura' } });
  });

  it('weighs rare words over common ones', () => {
    // Sharing "Cotton" and "Linen" with a listed company is not enough.
    const shared = top('Shanghai Cotton and Linen Trading Co.');
    expect(shared === undefined || shared.score < 0.82).toBe(true);
    // An extra common word lowers the score a little only.
    expect(top('Banco Nacional de Cuba Trading').score).toBeGreaterThan(0.82);
  });

  it('matches short names only when written exactly', () => {
    expect(top('ADF')).toMatchObject({ score: 1, entry: { list: 'un-sc' } });
    expect(lists.index.search({ name: 'ADT Logistics' }, { minScore: 0.5 }).some((m) => m.entry.name === 'ADF')).toBe(false);
  });

  it('adds a little for the same country and city and takes off for another country', () => {
    const plain = top('Hetian Tayda Apparel').score;
    expect(top('Hetian Tayda Apparel', 'CN').score).toBeCloseTo(Math.min(1, plain + 0.03), 3);
    const anglo = top('Anglo Caribean Co', 'GB', 'London');
    expect(anglo.countryAdjust).toBe(0.03);
    expect(anglo.cityAdjust).toBe(0.02);
    expect(top('Anglo Caribean Co', 'FR').countryAdjust).toBe(-0.05);
  });

  it('is deterministic and orders ties by list, then id', () => {
    const a = lists.index.search({ name: 'Huawei Technologies Co Ltd' });
    const b = new ScreeningIndex([...lists.index.entries].reverse()).search({ name: 'Huawei Technologies Co Ltd' });
    expect(a.map((m) => `${m.entry.list}:${m.entry.id}:${m.score}`)).toEqual(b.map((m) => `${m.entry.list}:${m.entry.id}:${m.score}`));
    expect(a.slice(0, 2).map((m) => m.entry.list)).toEqual(['ofac-cons', 'bis-el']);
  });

  it('does not screen against vessels', () => {
    const vessel: ListEntry = { id: 'v1', list: 'ofac-sdn', name: 'OCEAN STAR', aliases: [], type: 'vessel', countries: [], addresses: [], programs: [] };
    expect(new ScreeningIndex([vessel]).search({ name: 'Ocean Star' })).toEqual([]);
  });
});

describe('screening rules', () => {
  it('finds nothing on the clean sample shipment', () => {
    const out = screenShipment(clean(), lists.index);
    expect(out.findings).toEqual([]);
    expect(out.parties).toBe(2);
  });

  it('groups a party printed on several documents and skips TO ORDER consignees', () => {
    const ctx = clean();
    ctx.billOfLading!.data.consignee = { name: 'TO ORDER OF SHIPPER', address: { lines: [] } };
    const parties = shipmentParties(ctx);
    const seller = parties.find((p) => p.name === 'Acme Toys Co., Ltd.')!;
    expect(seller.seen.map((s) => `${s.doc}.${s.field}`)).toEqual(['invoice.seller', 'packingList.seller', 'billOfLading.shipper']);
    expect(parties.some((p) => /ORDER/.test(p.name))).toBe(false);
  });

  it('S1: a seller on a list is a HIGH finding citing the entry, its list, score and link', () => {
    const ctx = clean();
    ctx.invoice!.data.seller.name = 'Hetian Taida Apparel Co., Ltd.';
    const out = screenShipment(ctx, lists.index, { versions: lists.versions });
    // Hetian (Hotan) is in Xinjiang: S3 flags the same seller.
    expect(out.findings.map((f) => f.ruleId)).toEqual(['S1', 'S3']);
    const s1 = out.findings.filter((f) => f.ruleId === 'S1');
    expect(s1).toHaveLength(1);
    // The sample prints the same seller on the invoice, the packing list and the BL (as shipper).
    expect(s1[0]).toMatchObject({ severity: 'HIGH', decidedBy: 'RULE' });
    expect(s1[0].evidence.map((e) => `${e.documentId} ${e.field}`)).toEqual(['inv-1 seller.name', 'pl-1 seller.name', 'bl-1 shipper.name']);
    expect(s1[0].message).toContain('DHS UFLPA Entity List');
    expect(s1[0].message).toContain('score 1.00');
    expect(s1[0].regulation).toMatchObject({ url: 'https://www.dhs.gov/uflpa-entity-list', effectiveDate: lists.versions['dhs-uflpa'] });
    expect(out.questions).toEqual([]);
  });

  it('S2: a borderline name is a review finding, and only those go to the agent', () => {
    const ctx = clean();
    ctx.billOfLading!.data.notifyParty = { name: 'Banco Nacional Cuba Holdings', address: { lines: ['1 Main St'] } };
    const out = screenShipment(ctx, lists.index);
    expect(out.findings.map((f) => [f.ruleId, f.severity])).toEqual([['S2', 'MEDIUM']]);
    expect(out.findings[0].evidence[0]).toMatchObject({ documentId: 'bl-1', field: 'notifyParty.name' });
    expect(out.questions).toEqual([{ findingId: out.findings[0].id, party: expect.stringContaining('Banco Nacional Cuba Holdings'), entry: expect.stringContaining('BANCO NACIONAL DE CUBA') }]);
  });

  it('screens the ISF manufacturer', () => {
    const ctx = clean();
    const party = { name: 'Xinjiang Junggar Cotton & Linen Co Ltd', address: { lines: ['Changji'], country: 'CN' } };
    const isf: Isf = { seller: ctx.invoice!.data.seller, buyer: ctx.invoice!.data.buyer, importerOfRecordNumber: '1', consigneeNumber: '1', manufacturer: party, shipToParty: ctx.invoice!.data.buyer, countryOfOrigin: 'CN', htsCode: '9503.00', containerStuffingLocation: { lines: [] }, consolidator: ctx.invoice!.data.seller };
    ctx.isf = { id: 'isf-1', data: isf };
    const out = screenShipment(ctx, lists.index);
    expect(out.findings.find((f) => f.ruleId === 'S1')?.evidence[0]).toMatchObject({ documentId: 'isf-1', field: 'manufacturer.name' });
    // Its name says Xinjiang too.
    expect(out.findings.find((f) => f.ruleId === 'S3')?.evidence[0]).toMatchObject({ documentId: 'isf-1', field: 'manufacturer.name' });
  });

  it('uses the thresholds it is given', () => {
    const ctx = clean();
    ctx.invoice!.data.seller.name = 'Hangzhou Hikvisoin Digital Technology Co., Ltd.';
    delete ctx.invoice!.data.seller.address.country;
    const rules = (t?: object) => screenShipment(ctx, lists.index, { thresholds: t }).findings.map((f) => f.ruleId);
    expect(rules()).toEqual(['S1']);
    expect(rules({ match: 0.995 })).toEqual(['S2']);
    expect(rules({ match: 0.999, review: 0.999 })).toEqual([]);
    // A review threshold above the match threshold is read as the match threshold.
    expect(rules({ match: 0.9, review: 0.99 })).toEqual(['S1']);
  });

  it('sets aside a match on the allowlist, and only that match', () => {
    const ctx = clean();
    ctx.invoice!.data.seller.name = 'Huawei Technologies Co., Ltd.';
    const before = screenShipment(ctx, lists.index).findings;
    expect(before.map((f) => f.regulation?.title.split(':')[0])).toEqual(['OFAC Consolidated Sanctions List (non-SDN)', 'BIS Entity List']);
    const bis = lists.index.entries.find((e) => e.list === 'bis-el' && e.name.startsWith('Huawei'))!;
    const out = screenShipment(ctx, lists.index, { allowlist: [{ partyKey: partyKey('Huawei Technologies Co., Ltd.'), list: 'bis-el', entryId: bis.id }] });
    expect(out.findings.map((f) => f.regulation?.title.split(':')[0])).toEqual(['OFAC Consolidated Sanctions List (non-SDN)']);
    expect(out.allowlisted).toEqual([{ party: 'Huawei Technologies Co., Ltd.', list: 'bis-el', entryId: bis.id, score: 1 }]);
  });

  it('S3: a party in Xinjiang with goods of Chinese origin', () => {
    const ctx = clean();
    ctx.invoice!.data.seller.address = { lines: ['88 Industrial Rd'], city: 'Urumqi', region: 'Xinjiang', country: 'CN' };
    const out = screenShipment(ctx, lists.index);
    const s3 = out.findings.filter((f) => f.ruleId === 'S3');
    expect(s3).toHaveLength(1);
    expect(s3[0]).toMatchObject({ severity: 'MEDIUM', evidence: [{ documentId: 'inv-1', field: 'seller.address.city', value: 'Urumqi' }] });
    expect(s3[0].regulation?.title).toMatch(/Uyghur Forced Labor Prevention Act/);
  });

  it('S3: an ambiguous place name counts only in China', () => {
    const ctx = clean();
    ctx.invoice!.data.seller.address = { lines: ['Organize Sanayi'], city: 'Aksu', country: 'TR' };
    expect(screenShipment(ctx, lists.index).findings).toEqual([]);
    ctx.invoice!.data.seller.address.country = 'CN';
    expect(screenShipment(ctx, lists.index).findings.map((f) => f.ruleId)).toEqual(['S3']);
  });

  it('S3: Chinese-origin cotton, apparel, polysilicon or tomatoes, one finding per sector, citing Canada for Canada', () => {
    const ctx = clean();
    ctx.destination = 'CA';
    const line = ctx.invoice!.data.lines[0];
    ctx.invoice!.data.lines = [
      { ...line, lineNo: 1, hsCode: '6109.10' },
      { ...line, lineNo: 2, hsCode: '6109.90' },
      { ...line, lineNo: 3, hsCode: '2804.61' },
      { ...line, lineNo: 4, hsCode: '6109.10', countryOfOrigin: 'VN' },
      { ...line, lineNo: 5, hsCode: '9503.00' },
    ];
    const s3 = screenShipment(ctx, lists.index).findings;
    expect(s3.map((f) => f.message)).toEqual([
      '2 lines of Chinese-origin cotton apparel (knitted) (HS 6109.10, 6109.90): a sector CBP prioritizes under UFLPA.',
      'A line of Chinese-origin polysilicon (HS 2804.61): a sector CBP prioritizes under UFLPA.',
    ]);
    expect(s3[0].evidence.map((e) => e.field)).toEqual(['lines[0].hsCode', 'lines[0].countryOfOrigin', 'lines[1].hsCode', 'lines[1].countryOfOrigin']);
    expect(s3[0].regulation?.title).toMatch(/9897\.00\.00/);
  });

  it('knows the high-risk sectors and Xinjiang place names', () => {
    expect(highRiskSector('5201.00')?.sector).toBe('cotton');
    expect(highRiskSector('0702.00.20')?.sector).toBe('tomatoes');
    expect(highRiskSector('2804.69')).toBeUndefined();
    expect(xinjiangTerm('No. 5 Road, Kashgar', false)).toBe('KASHGAR');
    expect(xinjiangTerm('Aksu', false)).toBeUndefined();
    expect(xinjiangTerm('Aksu', true)).toBe('AKSU');
  });

  it('runs S3 without any list cached', () => {
    const ctx = clean();
    ctx.invoice!.data.lines[0].hsCode = '5208.12';
    expect(screenShipment(ctx, undefined).findings.map((f) => f.ruleId)).toEqual(['S3']);
  });
});

describe('list cache', () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'screening-'));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const files: Record<string, string> = {};
  const fetcher = async (url: string) => {
    const source = SOURCES.find((s) => Object.values(s.files).includes(url))!;
    const key = Object.entries(source.files).find(([, u]) => u === url)![0];
    const name = { 'ofac-sdn': { prim: 'sdn.csv', add: 'add.csv', alt: 'alt.csv' }, 'un-sc': { xml: 'un.xml' } }[source.id as 'un-sc']?.[key as 'xml'];
    if (!name) throw new Error(`offline: ${url}`);
    files[name] ??= await raw(name);
    return { text: files[name], lastModified: 'Wed, 14 Oct 2026 12:00:00 GMT' };
  };

  it('writes each list with its version, checksum and size, and records failures', async () => {
    const { manifest, outcomes } = await refreshLists(dir, { fetcher, only: ['ofac-sdn', 'un-sc', 'dhs-uflpa'], now: () => new Date('2026-10-16T08:00:00Z') });
    expect(outcomes.map((o) => [o.source, o.ok])).toEqual([['ofac-sdn', true], ['un-sc', true], ['dhs-uflpa', false]]);
    const sdn = manifest.lists.find((l) => l.id === 'ofac-sdn')!;
    expect(sdn).toMatchObject({ entries: 3, versionDate: '2026-10-14', fetchedAt: '2026-10-16T08:00:00.000Z' });
    expect(sdn.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.lists.find((l) => l.id === 'un-sc')!.versionDate).toBe('2026-10-15');
    expect(manifest.lists.find((l) => l.id === 'dhs-uflpa')).toMatchObject({ entries: 0, lastError: expect.stringContaining('offline') });
    const loaded = await loadScreening(dir);
    expect(loaded.index.size).toBe(5);
  });

  it('keeps the previous version of a list whose refresh fails', async () => {
    const failing = async (url: string) => {
      throw new Error(`down: ${url}`);
    };
    await refreshLists(dir, { fetcher: failing, only: ['ofac-sdn'] });
    const sdn = (await readManifest(dir)).lists.find((l) => l.id === 'ofac-sdn')!;
    expect(sdn.entries).toBe(3);
    expect(sdn.lastError).toMatch(/^down:/);
    expect((await loadScreening(dir)).index.size).toBe(5);
  });
});

describe('evaluation on the synthetic set', () => {
  it('flags injected list names and nothing else (data/eval/v1, fixture lists)', async () => {
    const dir = resolve(__dirname, '../../../data/eval/v1');
    const { readdirSync, readFileSync, existsSync } = await import('node:fs');
    const ships: ShipmentContext[] = readdirSync(dir)
      .filter((id) => existsSync(join(dir, id, 'truth.json')))
      .sort()
      .map((id) => {
        const t = JSON.parse(readFileSync(join(dir, id, 'truth.json'), 'utf8'));
        const d = t.documents;
        return { shipmentId: id, destination: t.destination, invoice: { id: 'invoice', data: d.invoice }, billOfLading: { id: 'bl', data: d.billOfLading }, ...(d.isf ? { isf: { id: 'isf', data: d.isf } } : {}) };
      });
    const { evaluateScreening, STRONG_VARIANTS } = await import('./evaluate');
    const report = evaluateScreening(ships, lists.index);
    expect(report.shipments).toBe(200);
    expect(report.falsePositives).toEqual([]);
    for (const v of STRONG_VARIANTS) expect(report.recall[v].hit).toBe(report.recall[v].cases);
    const all = Object.values(report.recall).reduce((a, r) => ({ cases: a.cases + r.cases, flagged: a.flagged + r.flagged }), { cases: 0, flagged: 0 });
    expect(all.flagged / all.cases).toBeGreaterThan(0.95);
  });
});
