# DocCheck: catching freight document errors before customs does

Importing a container into Canada or the United States means four documents that must agree with each other and with the customs authority's rules: the commercial invoice, the packing list, the bill of lading and, for US ocean freight, the Importer Security Filing. When they disagree (a package count off by one, a weight in the wrong unit, a country of origin left blank), the entry is held, amended or penalized. Brokers catch most of this by reading documents side by side.

DocCheck automates that read-through. It takes the PDFs, extracts typed data with a local language model, runs deterministic cross-document and country rules, and uses the model again only where a rule cannot decide alone. Every finding cites the line of the PDF it comes from and the regulation that backs it.

## Design

```
PDF ─► text with positions ─► classify ─► LLM: values as printed ─► normalize ─► rules ─► agent ─► findings
                                                                                   │        │
                                                                         country profile   regulation search
```

**Deterministic first.** Thirteen rules do most of the work: package counts and weights across documents, invoice arithmetic, currency, quantities per SKU, ISO 6346 container check digits, ISF consistency, and the invoice fields CBSA (form CI1) and CBP (19 CFR 141.86) require. They are pure functions over typed documents, unit-tested without a server, and they never call a model. Money and weights are decimal strings with fixed-point arithmetic.

**The model copies, code converts.** Extraction asks the model for values exactly as printed (`"1,140.00"`, `"14-MAR-2026"`, `"2,513 LB"`) into a Zod schema, then plain code turns them into canonical types: decimals, ISO dates, kilograms, ISO country codes. A formatting rule is then a tested function instead of a prompt instruction. The first evaluation found two bugs this way: a number followed by a unit ("320 M2") and city lines copied into street addresses, both fixed in code and covered by tests.

**The agent decides narrow questions.** Rather than an open-ended agent loop, the model answers specific questions with a structured verdict, confidence and rationale: are two differently written consignee names the same company, and does the BL cargo description match the invoice goods. It only acts at confidence ≥ 0.7, and "unsure" never dismisses a finding. Every decision is stored with the validation run, so a reviewer can audit what the model changed.

**Citations are retrieved, not generated.** The regulation passage on each finding comes from hybrid search (embeddings plus BM25) over CBSA Memorandum D1-4-1 and 19 CFR 141.86 and Part 149, and is attached only when keyword search agrees it is relevant. The model never writes the legal basis. The PDF citation comes from the extraction layer, which keeps every text line with its page and bounding box; the web app opens the page with that line highlighted.

**Local by default.** Extraction, agent and embeddings run on Ollama (`qwen3.8`, `bge-m3`) on the developer's machine; documents never leave it. A model comparison on the same pilot set decided the model: `qwen3.8` reached 96.4% field accuracy against 56.7% for `gemma4`, which dropped the BL gross weight and with it most BLs.

## Evaluation

There is no public set of labeled freight documents, so DocCheck generates one. `packages/synth` builds 200 consistent shipments (100 per destination) from fictional parties and real port codes, renders them to PDF with three templates per document (including bilingual Canadian invoices and BL weights in pounds), and injects 1–3 labeled errors into 150 of them: 293 errors of 10 kinds, each recording the document, field, before and after values, and the rules expected to flag it.

Three measurements come out of it:

- **Extraction**, field by field against the ground truth, by document type, template and field.
- **Rules on ground truth**: a consistency check that the engine raises exactly the expected rules and nothing on clean shipments. It is 100% by construction for the 274 errors a rule covers, so it shows the rules do what they claim, not real-world recall.
- **Rules end to end on the extracted PDFs**, where extraction errors turn into missed or spurious findings. This is the number that matters.

Model responses are cached by prompt version, so the evaluation reruns in seconds without a model and prompt changes invalidate exactly what they should.

See [METRICS.md](METRICS.md) for the current numbers.

## What I learned

- Splitting "read what is printed" from "decide what it means" made both halves testable. Most extraction gains came from layout and normalization, not from the prompt: aligning table cells by column fixed multi-line cells, and two normalization functions fixed what looked like model errors.
- Evaluating before building paid off twice: it chose the model, and it caught a rule (consignee comparison) that was perfect on ground truth and produced false positives on real extraction.
- Pin the model, not the tag. `qwen3.8:latest` was replaced by a newer build in the middle of the evaluation day; nothing broke, but results from before and after were silently from different models. Every cached response, trace and report now records the exact build.
- A local model is slow enough (≈30 s per page on an M5 Pro) that extraction had to move to a queue early, and caching responses was what made iterating on prompts affordable.

## Limitations

- The evaluation set is synthetic. Real invoices bring handwriting, stamps, multi-page tables and layouts the three templates do not cover. Scans are simulated (rotation, blur, noise) and read with OCR, which is weaker on poor scans.
- The ground-truth rule results only cover error kinds the generator injects.
- The regulation corpus is three sources. D1-4-1 dates from 2013 and is marked under review for CARM.
- Not customs advice; nothing is filed with CBSA or CBP.

## Next

More templates and real scanned samples, the ISF as an uploadable document, more CBSA memoranda in the corpus, and the agent's decisions measured on real documents.
