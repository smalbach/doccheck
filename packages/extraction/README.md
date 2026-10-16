# @doccheck/extraction

PDF in, typed document out, with every value traceable to a page and a bounding box. Runs on a local model through Ollama.

```
PDF ──► pdf-text (pdf.js) ──► classify ──► LLM: raw schema, values as printed ──► normalize ──► canonical Zod schema
           │                                                                                   │
           └──────────────────────── findSource: value -> page + bbox ◄─────────────── rule evidence
```

| File | Role |
| --- | --- |
| `pdf-text.ts` | Text lines with page and bbox; cells padded to their column so tables stay aligned |
| `ocr.ts` | For pages without a text layer: render with pdf.js + @napi-rs/canvas at 288 dpi, tesseract.js (PSM 6, English + French models from npm), words back in PDF points |
| `ocr-eval-cli.ts` | Text recall: share of truth values found in the text read from each PDF, without a model (`npm run eval:ocr`) |
| `classify.ts` | Document type from title and vocabulary: invoice, packing list, bill of lading, ISF, air waybill, certificate of origin, CUSMA certification, arrival notice, wood packaging certificate, dangerous goods declaration |
| `split.ts` | One upload holding several documents: page-by-page classification, boundaries where a page is titled as another type or its page marker restarts; parts keep the upload's page numbers |
| `raw-schemas-documents.ts`, `normalize-documents.ts` | Raw schemas and normalizers of the other documents (AWB numbers, IATA airports, PP/CC, UN numbers, classes, packing groups, ISPM marks, CUSMA criteria) |
| `printed-documents.ts` | Values the model fills in although the paper leaves them blank, dropped (CUSMA elements, an unstated origin, a packing group, a computed chargeable weight) |
| `spreadsheet.ts`, `zip.ts` | .xlsx (a minimal ZIP + XML reader and writer, no dependency) and .csv read into a grid; the grid laid out as text with each row's cells, so citations name the cell |
| `spreadsheet-extract.ts` | Header row by vocabulary, column mapping (the model only for headers the vocabulary does not know, sent without any value), labelled cells, party blocks, totals row -> the raw invoice or packing list |
| `image.ts` | Photos (JPEG, PNG, HEIC): EXIF orientation, deskew by projection profile, crop to the paper, image-only PDF for the OCR path |
| `attestation.ts` | Signature and stamp on the rendered page: ink near a signature label that is neither text nor a table rule; a compact patch of saturated colour |
| `inputs.ts` | Upload formats and the reading of a stored file (PDF or spreadsheet), its parts and the extraction of one part |
| `inputs-eval-cli.ts` | Scores spreadsheets, photos and combined PDFs on set v1-inputs |
| `raw-schemas.ts` | What the model returns: strings as printed, `null` when not printed |
| `llm.ts` | Ollama client with JSON-schema output, schema validation + one retry, on-disk cache |
| `normalize.ts` | Printed text to canonical values (decimals, dates, lb to kg, countries, units) |
| `provenance.ts` | Finds where a value is printed, for citations in findings |
| `score.ts` | Field-level comparison against ground truth |
| `eval-cli.ts` | Runs the evaluation set and writes `eval/reports/extraction-<model>.{md,json}` |

```bash
ollama pull qwen3.8                                   # or any model with structured output support
npm run eval:extraction -- --limit 10                 # 5 CA + 5 US shipments
LLM_MODEL=gemma4 npm run eval:extraction -- --limit 10
npm run eval:extraction -- --ids CA-001,US-014
npm run eval:extraction -- --data data/eval/v1-scans   # scanned set, read with OCR
LLM_CACHE_MODE=replay npm run eval:extraction         # cached responses only, no model needed
```

Environment: `LLM_MODEL` (default `qwen3.8`), `OLLAMA_BASE_URL` (default `http://localhost:11434`), `LLM_CACHE_DIR`, `LLM_CACHE_MODE` (`readwrite`, `replay`, `off`).

Bump `PROMPT_VERSION` in `extract.ts` whenever the prompt or raw schemas change, so cached answers from the old prompt are not reused.
