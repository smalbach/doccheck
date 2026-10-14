# DocCheck: catching freight document errors before customs does

Importing a container into Canada or the United States means up to four documents that must agree with each other and with the customs authority's rules: the commercial invoice, the packing list, the bill of lading and, for US ocean freight, the Importer Security Filing. When they disagree (a package count off by one, a weight in the wrong unit, a country of origin left blank), the entry is held, amended or penalized. Brokers catch most of this by reading documents side by side.

DocCheck automates that read-through. It takes the PDFs, extracts typed data with a local language model, runs deterministic cross-document and country rules, and uses the model again only where a rule cannot decide alone. Every finding cites the line of the PDF it comes from and the regulation that backs it.

## Design

```
PDF ─► text with positions ─► classify ─► LLM: values as printed ─► normalize ─► rules ─► agent ─► findings
                                                                                   │        │
                                                                         country profile   regulation search
```

**Deterministic first.** Fifteen rules do most of the work: package counts and weights across documents, invoice arithmetic, currency, quantities per SKU, invoice and BL dates, terms of sale against freight terms, ISO 6346 container check digits, ISF consistency, invoice language for CBSA, and the invoice fields CBSA (form CI1) and CBP (19 CFR 141.86) require. They are pure functions over typed documents, unit-tested without a server, and they never call a model. Money and weights are decimal strings with fixed-point arithmetic.

**The model copies, code converts.** Extraction asks the model for values exactly as printed (`"1,140.00"`, `"14-MAR-2026"`, `"2,513 LB"`) into a Zod schema, then plain code turns them into canonical types: decimals, ISO dates, kilograms, ISO country codes. A formatting rule is then a tested function instead of a prompt instruction. The first evaluation found two bugs this way: a number followed by a unit ("320 M2") and city lines copied into street addresses, both fixed in code and covered by tests.

**The agent decides narrow questions.** Rather than an open-ended agent loop, the model answers specific questions with a structured verdict, confidence and rationale: are two differently written consignee names the same company, and does the BL cargo description match the invoice goods. It only acts at confidence ≥ 0.7, and "unsure" never dismisses a finding. Every decision is stored with the validation run, so a reviewer can audit what the model changed.

**Citations are retrieved, not generated.** The regulation passage on each finding comes from hybrid search (embeddings plus BM25) over CBSA memoranda (invoices D1-4-1, marking D11-3-1, proof of origin D11-4-2, valuation D13-4-3 and D13-4-7) and 19 CFR (141.83, 141.86, 141.89, Parts 134 and 149, Part 152 subpart E), and is attached only when keyword search agrees it is relevant. The model never writes the legal basis. The PDF citation comes from the extraction layer, which keeps every text line with its page and bounding box; the web app opens the page with that line highlighted.

**Local by default.** Extraction, agent and embeddings run on Ollama (`qwen3.8`, `bge-m3`) on the developer's machine; documents never leave it. A model comparison on the same pilot set decided the model: `qwen3.8` reached 96.4% field accuracy against 56.7% for `gemma4`, which dropped the BL gross weight and with it most BLs.

## Evaluation

There is no public set of labeled freight documents, so DocCheck generates one. `packages/synth` builds 200 consistent shipments (100 per destination) from fictional parties and real port codes, renders them to PDF with three templates per document (including bilingual Canadian invoices and BL weights in pounds), and injects 1–3 labeled errors into 150 of them: 293 errors of 10 kinds, each recording the document, field, before and after values, and the rules expected to flag it.

Three measurements come out of it:

- **Extraction**, field by field against the ground truth, by document type, template and field.
- **Rules on ground truth**: a consistency check that the engine raises exactly the expected rules and nothing on clean shipments. It is 100% by construction for the 274 errors a rule covers, so it shows the rules do what they claim, not real-world recall.
- **Rules end to end on the extracted PDFs**, where extraction errors turn into missed or spurious findings. This is the number that matters.

Model responses are cached by prompt version, so the evaluation reruns in seconds without a model and prompt changes invalidate exactly what they should. Three more sets reuse the same shipments or generator: 40 shipments as simulated scans (image-only PDFs, rotated, blurred, at 110 to 150 dpi), the 100 US shipments with their ISF filing confirmation as a PDF, and set v2 (below).

### Results

All with `qwen3.8` (build `aaee06c39dcf`) on an M5 Pro. Full tables in [METRICS.md](METRICS.md).

| Set | PDFs | Field accuracy | Rules end to end |
| --- | --- | --- | --- |
| Text-layer PDFs (v1) | 600 | 99.8% (invoice 99.9%, packing list 99.6%, BL 99.7%) | recall 100%, precision 99.7% |
| ISF filing confirmations | 100 | 99.9% | X11 caught 20/20 ISF–invoice mismatches, no false alarms |
| Simulated scans, tesseract OCR | 120 | 81.5%; 93 of 120 documents complete enough for the rules | recall 81.8%, precision 67.5% (21 of 40 shipments usable) |
| Simulated scans, Unlimited-OCR (Apple Silicon) | 120 | 94.0%; 108 of 120 complete | recall 100%, precision 79.6% (29 of 40 usable) |
| Unseen formats (v2) | 180 | 98.8%; 177 of 180 documents complete enough for the rules | recall 100%, precision 100% |
| Agent, 80 cases with a known answer | — | 0 wrong decisions; 5 "unsure" on name variants, which keep the finding | — |

**The misses that matter are fields filled in that should be blank.** On v1, the only end-to-end misses are three missing required fields (C1/U1): an invoice with the consignee removed, where the model copied the buyer printed next to it, and two US invoices with the country of origin removed, where the model took the seller's country. The prompt says never to infer a value, and the model does it anyway when a plausible value sits a few lines away. For a broker this is the worst kind of error: the check passes on a document that would be rejected. The same thing happens with a field that is not printed at all: Canadian invoices carry no port of entry, and the model supplies one in 11 of 100, usually the place in the terms of sale ("CIF Halifax"); no Canadian rule reads it, so no finding changes, but the data is wrong. The fix was a second, cheap pass rather than a bigger model: a deterministic check keeps a consignee, country of origin or port of entry only if the PDF prints it under its own label, using the column positions the layout text already keeps. On the 260 text-layer invoices of v1 and v2 it drops no correct value and removes every filled-in one; end-to-end recall went from 99.0% to 100% on v1 (C1 6/6, U1 7/7) and from 95.3% to 100% on v2. It stays off for OCR text, where labels and columns shift enough that it would drop 31 correct values on 40 scans.

**Scans: the first number measured the validator, not the reader.** The first scan run scored 57.6%. Almost half the documents had been thrown away whole: one unreadable value (often the country line, lost by OCR) failed schema validation, and every field of the document then counted as missing. Keeping a party or place whose country is unreadable (inferring it from a Canadian or US postal code, or a UN/LOCODE, when possible) and scoring what was read from documents that still fail validation, while reporting how many are valid, moved it to 81.5% on the same cached model answers, with 93 of 120 documents valid instead of 63. What remained was real reading loss in tables: container rows on the BL and weights on the packing list, where tesseract breaks the row structure.

**A document OCR model fixed the tables, once it ran the right way.** Baidu's Unlimited-OCR (3B, MIT) returns each region with its box and tables as HTML. The build packaged for Ollama lost the table cell tags (numbers ran together: "1.8598,568.00") and scored below tesseract on a sample; the same model through MLX on the Mac kept them, found 96.8% of the printed values against 86.6% for tesseract (94.2% vs 69.3% on blurry 110 dpi scans) at about 2 s per page, and took the scans end to end from 81.5% to 94.0% field accuracy, with every labeled error caught. It is an optional engine (`OCR_ENGINE=unlimited`, served by a small local Python process); tesseract stays the default where there is no Apple Silicon. Most of what it still misses are values run together inside a multi-line cell ("PO" and the PO number), which a prompt for the extraction model may handle.

**Unseen formats (set v2).** 60 shipments generated after the prompt was frozen: a European letterhead layout ("48.600,00", "1 140,50 kg", "14.03.2026") and a numbered-box form for each document, invoices of 6 to 40 lines from product variants (13 PDFs run onto a second page), and parties with French, German, Spanish, Vietnamese, Portuguese and Turkish names. The v1 layouts stay in the mix as a control. Before any model call it exposed three normalization gaps (space-grouped thousands, dotted dates, European numbers in the PDF citation search), fixed with tests. Results: 98.7% field accuracy, 98.0% on the new layouts against 99.9% on the v1 layouts in the same set. Two things went wrong, both visible only on this set. The model dropped the UN/LOCODE from places printed as "Valencia (ESVLC)" and left the country empty, which made 15 bills of lading invalid; places now keep an unknown country and read the code when it is there. And on the numbered-box packing list it returned the per-row package count and weights empty on long tables although the text has them, a reading failure that only a prompt or model change fixes (91.1% on that layout). The rules missed only removed consignees or origins that the model filled in (recall 95.3%), and the printed-under-label check brings that to 100%.

## What I learned

- Splitting "read what is printed" from "decide what it means" made both halves testable. Most extraction gains came from layout and normalization, not from the prompt: aligning table cells by column fixed multi-line cells, and two normalization functions fixed what looked like model errors.
- Evaluating before building paid off twice: it chose the model, and it caught a rule (consignee comparison) that was perfect on ground truth and produced false positives on real extraction.
- Look at why a number is low before tuning anything. The scan score was mostly an all-or-nothing validator, fixed in code without touching the model; the v1 misses were the model filling in blanks, which no amount of OCR or layout work would fix.
- Long evaluations need the same care as production jobs: the full v1 run took about 14 hours (the laptop slept overnight), and a report written by a process that started before three rules existed showed them at 0%. Reports are now regenerated from the cache with the final code before they are published.
- Pin the model, not the tag. `qwen3.8:latest` was replaced by a newer build in the middle of the evaluation day; nothing broke, but results from before and after were silently from different models. Every cached response, trace and report now records the exact build.
- A local model is slow enough (≈30 s per page on an M5 Pro) that extraction had to move to a queue early, and caching responses was what made iterating on prompts affordable.

## Limitations

- The evaluation set is synthetic. Real invoices bring handwriting, stamps and layouts the templates do not cover; set v2 adds two unseen layouts, European number and date formats, tables of up to 40 rows across two pages and non-English party names, but it is still generated. Scans are simulated (rotation, blur, noise) and read with OCR (English and French models), which finds 86.6% of the expected values in the text against 99.7% from a text layer.
- The ground-truth rule results only cover error kinds the generator injects.
- The regulation corpus is eleven sources (five CBSA memoranda, three of them also in French, and six sections of 19 CFR), chosen for the rules DocCheck has. D1-4-1 dates from 2013 and is marked under review for CARM.
- Not customs advice; nothing is filed with CBSA or CBP.

## Next

Unlimited-OCR on a Linux GPU (the vLLM build) so scans need no Mac, real documents (the agent's decisions in particular), and the public demo: the read-only mode runs from cached answers without a model, so it fits a small server.
