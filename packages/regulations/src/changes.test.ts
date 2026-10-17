import { describe, expect, it } from 'vitest';
import { diffPassages, passageHash, passagesOf } from './changes';
import { cbsaToMarkdown, ecfrToMarkdown } from './sources';

const doc = (body: string) => passagesOf({ id: 'cfr-19-149', body });

const V1 = `# PART 149

## § 149.3 Data elements

(a) Seller. Name and address.

(b) Buyer. Name and address.

(c) Country of origin.

## § 149.4 Bond

A bond is required.`;

describe('passagesOf', () => {
  it('keeps paragraphs with their heading path and hashes them ignoring whitespace', () => {
    const p = doc(V1);
    expect(p.map((x) => [x.ordinal, x.section, x.text])).toEqual([
      [0, 'PART 149 > § 149.3 Data elements', '(a) Seller. Name and address.'],
      [1, 'PART 149 > § 149.3 Data elements', '(b) Buyer. Name and address.'],
      [2, 'PART 149 > § 149.3 Data elements', '(c) Country of origin.'],
      [3, 'PART 149 > § 149.4 Bond', 'A bond is required.'],
    ]);
    expect(passageHash('A  bond\nis required.')).toBe(p[3].hash);
  });
});

describe('diffPassages', () => {
  it('finds nothing when only whitespace changed', () => {
    expect(diffPassages(doc(V1), doc(V1.replace('Name and address.', 'Name   and address.')))).toEqual([]);
  });

  it('reports an edited paragraph as changed, not as every later one', () => {
    const changes = diffPassages(doc(V1), doc(V1.replace('(b) Buyer. Name and address.', '(b) Buyer. Name, address and tax id.')));
    expect(changes.map((c) => c.kind)).toEqual(['changed']);
    const [c] = changes;
    expect(c.kind === 'changed' && [c.before.text, c.after.text]).toEqual(['(b) Buyer. Name and address.', '(b) Buyer. Name, address and tax id.']);
  });

  it('reports an inserted paragraph as added and keeps the rest matched', () => {
    const v2 = V1.replace('(c) Country of origin.', '(c) Manufacturer.\n\n(d) Country of origin.');
    const changes = diffPassages(doc(V1), doc(v2));
    expect(changes.map((c) => [c.kind, c.kind === 'removed' ? c.before.text : c.after.text])).toEqual([
      ['changed', '(c) Manufacturer.'],
      ['added', '(d) Country of origin.'],
    ]);
  });

  it('reports a dropped paragraph as removed and a moved section as removed plus added', () => {
    const changes = diffPassages(doc(V1), doc(V1.replace('\n\n(a) Seller. Name and address.', '')));
    expect(changes.map((c) => c.kind)).toEqual(['removed']);
    const moved = diffPassages(doc(V1), doc(V1.replace('## § 149.4 Bond\n\nA bond is required.', '## § 149.5 Bond\n\nA bond is required.')));
    expect(moved.map((c) => c.kind)).toEqual(['removed', 'added']);
  });

  it('treats every passage as added against an empty previous version', () => {
    expect(diffPassages([], doc(V1)).map((c) => c.kind)).toEqual(['added', 'added', 'added', 'added']);
  });
});

describe('source converters', () => {
  it('turns a CBSA page and an eCFR part into the corpus Markdown', () => {
    const html = '<meta name="dcterms.modified" content="2024-01-02"><main><h2>Guidelines</h2><p>Invoices &amp; forms.</p><table><tr><td>7</td><td>Country of origin</td></tr></table></main>';
    expect(cbsaToMarkdown(html)).toEqual({ markdown: '## Guidelines\n\nInvoices & forms.\n\nField 7: Country of origin', effectiveDate: '2024-01-02' });
    expect(ecfrToMarkdown('<HEAD>PART 149</HEAD><HEAD>§ 149.3 Data</HEAD><P>(a) Seller.</P>')).toBe('# PART 149\n\n## § 149.3 Data\n\n(a) Seller.');
  });
});
