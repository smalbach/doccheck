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
| `classify.ts` | Invoice / packing list / bill of lading from title and vocabulary |
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
