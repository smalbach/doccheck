# Tariff schedules

The two tariff schedules the HS code checks run against, normalized by `scripts/fetch-tariff.mjs` (`npm run tariff:fetch`), with their section and chapter notes.

| File | Source | Edition |
| --- | --- | --- |
| `us/schedule.json` | USITC HTS export, JSON (`https://hts.usitc.gov/reststop/exportList`) | 2026 HTS Revision 21, effective 2026-10-09 |
| `us/notes.json` | Section and chapter notes (with Additional U.S. Notes and statistical notes) from each chapter PDF of the current HTS | same |
| `ca/schedule.json` | CBSA Customs Tariff, Access database in `01-99-2026-2-eng.zip`, table `TPHS` | Customs Tariff 2026, consolidated to September 1, 2026 |
| `ca/notes.json` | Chapter notes from each CBSA chapter PDF; section notes from the CBSA section page | same |
| `index/<us\|ca>-bge-m3.json` + `.i8` | Embeddings of every 8- and 10-digit tariff line (`npm run tariff:index`, ~15 min per schedule). Git-ignored: about 45 MB | built locally |

A schedule entry is `[code, description, parent]`: `code` holds digits only (`""` for a US grouping row without a number), `parent` is the index of the entry it sits under (`-1` at the top), so the full wording of a code is the chain of descriptions above it. Both schedules have the same 5,612 HS subheadings (6 digits); the digits after the sixth are national.

Notes are split into numbered notes (`Chapter 95, Note 1`, `Section XVI, Note 2`, `Chapter 95, Subheading Note 1`, `Chapter 84, Additional U.S. Note 3`), each with the URL of its PDF, so a finding can quote the one note it relies on. The text is extracted from PDFs and may carry small layout artifacts; always confirm against the source.

When pgvector is installed in Postgres (migration `045_tariff_vectors.sql`), the API copies the index into the `tariff_vectors` table on first use and searches there; otherwise it keeps the vectors in memory. Without the index the search ranks by keywords only.

Run the fetch again when a new revision is published (the HTSUS changes several times a year, the Customs Tariff every January 1 with consolidations during the year), then rebuild the index.
