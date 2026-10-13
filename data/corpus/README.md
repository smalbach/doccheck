# Regulation corpus

Public regulation text the agent cites. Each file has front matter with the source URL and the date the text is effective as of.

| File | Source | URL | Effective |
| --- | --- | --- | --- |
| `cbsa/cbsa-d1-4-1-en.md`, `-fr.md` | CBSA Memorandum D1-4-1, CBSA Invoice Requirements | [en](https://www.cbsa-asfc.gc.ca/publications/dm-md/d1/d1-4-1-eng.html), [fr](https://www.cbsa-asfc.gc.ca/publications/dm-md/d1/d1-4-1-fra.html) | 2013-03-01 (page marked under review for CARM) |
| `cbsa/cbsa-d11-3-1-en.md`, `-fr.md` | CBSA Memorandum D11-3-1, Marking of Imported Goods | [en](https://www.cbsa-asfc.gc.ca/publications/dm-md/d11/d11-3-1-eng.html), [fr](https://www.cbsa-asfc.gc.ca/publications/dm-md/d11/d11-3-1-fra.html) | 2023-04-14 (issued 2023-04-05) |
| `cbsa/cbsa-d11-4-2-en.md` | CBSA Memorandum D11-4-2, Proof of Origin of Imported Goods | [en](https://www.cbsa-asfc.gc.ca/publications/dm-md/d11/d11-4-2-eng.html) | 2023-01-31 (issued 2022-06-29); English only, the French URL serves a different memorandum |
| `cbsa/cbsa-d13-4-3-en.md` | CBSA Memorandum D13-4-3, Customs Valuation: Price Paid or Payable | [en](https://www.cbsa-asfc.gc.ca/publications/dm-md/d13/d13-4-3-eng.html) | 2023-03-08 (issued 2014-01-07) |
| `cbsa/cbsa-d13-4-7-en.md`, `-fr.md` | CBSA Memorandum D13-4-7, Adjustments to the Price Paid or Payable (Customs Act, s. 48) | [en](https://www.cbsa-asfc.gc.ca/publications/dm-md/d13/d13-4-7-eng.html), [fr](https://www.cbsa-asfc.gc.ca/publications/dm-md/d13/d13-4-7-fra.html) | 2023-03-08 (issued 2013-08-29) |
| `cbp/cfr-19-141-83.md` | 19 CFR 141.83, Type of invoice required | [eCFR](https://www.ecfr.gov/current/title-19/chapter-I/part-141/subpart-F/section-141.83) | eCFR, current as of 2026-10-08 |
| `cbp/cfr-19-141-86.md` | 19 CFR 141.86, Contents of invoices | [eCFR](https://www.ecfr.gov/current/title-19/chapter-I/part-141/subpart-F/section-141.86) | eCFR, current as of 2026-10-08 |
| `cbp/cfr-19-141-89.md` | 19 CFR 141.89, Additional information for certain classes of merchandise | [eCFR](https://www.ecfr.gov/current/title-19/chapter-I/part-141/subpart-F/section-141.89) | eCFR, current as of 2026-10-08 |
| `cbp/cfr-19-134.md` | 19 CFR Part 134, Country of Origin Marking | [eCFR](https://www.ecfr.gov/current/title-19/chapter-I/part-134) | eCFR, current as of 2026-10-08 |
| `cbp/cfr-19-149.md` | 19 CFR Part 149, Importer Security Filing | [eCFR](https://www.ecfr.gov/current/title-19/chapter-I/part-149) | eCFR, current as of 2026-10-08 |
| `cbp/cfr-19-152-e.md` | 19 CFR Part 152 Subpart E, Valuation of Merchandise | [eCFR](https://www.ecfr.gov/current/title-19/chapter-I/part-152/subpart-E) | eCFR, current as of 2026-10-08 |

The CBSA effective date is the page's `dcterms.modified` date; the memorandum's own issue date ("Ottawa, ...") is noted when it differs. No newer CARM-era invoice memorandum was found: D1-4-1 is still the invoice reference, with a CARM transition notice on the page.

Invoice findings cite only D1-4-1 (CI1 fields) or 19 CFR 141.86, and X11 only 19 CFR 149.3 (`citationScope` in `packages/agent/src/cite.ts`). The marking, origin and valuation documents are searchable (`cli.js search`) but would otherwise outrank the field definitions for terms like "country of origin" or "price paid or payable".

- `npm run corpus:fetch` downloads and converts the sources again (`scripts/fetch-corpus.mjs`).
- `npm run corpus:index` embeds the chunks with the local model (`EMBED_MODEL`, default `bge-m3`) into `index/<model>.json`.

Citations are informational and may lag behind the official text; always confirm against the source URL.
