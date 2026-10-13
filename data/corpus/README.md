# Regulation corpus

Public regulation text the agent cites. Each file has front matter with the source URL and the date the text is effective as of.

| File | Source | Effective |
| --- | --- | --- |
| `cbsa/cbsa-d1-4-1-en.md`, `-fr.md` | CBSA Memorandum D1-4-1, CBSA Invoice Requirements | 2013-03-01 (page marked under review for CARM) |
| `cbp/cfr-19-141-86.md` | 19 CFR 141.86, Contents of invoices | eCFR, current as of the fetch date |
| `cbp/cfr-19-149.md` | 19 CFR Part 149, Importer Security Filing | eCFR, current as of the fetch date |

- `npm run corpus:fetch` downloads and converts the sources again (`scripts/fetch-corpus.mjs`).
- `npm run corpus:index` embeds the chunks with the local model (`EMBED_MODEL`, default `bge-m3`) into `index/<model>.json`.

Citations are informational and may lag behind the official text; always confirm against the source URL.
