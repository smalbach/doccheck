import { describe, expect, it } from 'vitest';
import { chunkDocument, parseDocument } from './corpus';
import { excerpt, RegulationIndex, tokenize, type Embedder } from './search';

const DOC = `---
id: "test-doc"
title: "Test memorandum"
authority: "CBSA"
language: "en"
url: "https://example.test/memo"
effectiveDate: "2020-01-01"
---

## Appendix A

### Field instructions

Field 7: Country of origin of goods - Indicate the country where the goods were produced.

Field 10: Currency of settlement - Indicate the currency in which payment is demanded.

## References

Customs Act, section 40.
`;

/** Deterministic fake embedding: bag of a few known words, so tests need no model. */
const VOCAB = ['origin', 'country', 'currency', 'settlement', 'payment', 'customs', 'act'];
const fake: Embedder = {
  id: 'fake',
  embed: async (texts) => texts.map((t) => VOCAB.map((w) => (tokenize(t).includes(w) ? 1 : 0.01))),
};

describe('corpus', () => {
  it('parses front matter and keeps heading paths on chunks', () => {
    const doc = parseDocument(DOC);
    expect(doc).toMatchObject({ id: 'test-doc', authority: 'CBSA', effectiveDate: '2020-01-01' });
    const chunks = chunkDocument(doc, 120);
    expect(chunks.map((c) => c.section)).toEqual(['Appendix A > Field instructions', 'Appendix A > Field instructions', 'References']);
    expect(chunks[0].text).toMatch(/^Field 7/);
  });
});

describe('search', () => {
  it('ranks the passage that answers the query first, filtered by authority', async () => {
    const index = await RegulationIndex.build(chunkDocument(parseDocument(DOC), 120), fake);
    const [hit] = await index.search('currency of settlement', { authority: 'CBSA' });
    expect(hit.chunk.text).toContain('Field 10');
    expect(hit.ranks.keyword).toBe(1);
    expect(await index.search('currency', { authority: 'CBP' })).toEqual([]);
  });

  it('restricts the search to the given documents', async () => {
    const other = parseDocument(DOC.replace('id: "test-doc"', 'id: "other-memo"').replace('Test memorandum', 'Other memorandum'));
    const index = await RegulationIndex.build([parseDocument(DOC), other].flatMap((d) => chunkDocument(d, 120)), fake);
    const hits = await index.search('currency of settlement', { documents: ['other'] });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.chunk.documentId === 'other-memo')).toBe(true);
    expect(await index.search('currency', { documents: ['missing'] })).toEqual([]);
  });

  it('quotes whole sentences around the query terms', () => {
    const text = 'Intro sentence here. The country of origin must be shown for each item. Another unrelated sentence follows.';
    expect(excerpt(text, 'country of origin', 80)).toBe('The country of origin must be shown for each item.');
  });

  it('keeps the paragraph label of the quoted definition', () => {
    const text = '(6) Ship to party. Name and address. (7) Country of origin. Country of manufacture, production, or growth of the article.';
    expect(excerpt(text, 'country of manufacture production growth', 200)).toBe('(7) Country of origin. Country of manufacture, production, or growth of the article.');
  });

  it('never runs a form field into the next one', () => {
    const text = 'Field 16: Total weight - Show both net and gross weight. Field 17: Invoice total - The total price.';
    expect(excerpt(text, 'net and gross weight')).toBe('Field 16: Total weight - Show both net and gross weight.');
  });
});
