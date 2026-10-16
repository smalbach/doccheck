# Extraction report — ollama:qwen3.8

Data `v1-docs` · model build aaee06c39dcf · prompt `extract-v3` · OCR tesseract · 20 shipments · 43 PDFs · 0 failed · 34 from cache

**Field accuracy 100.0%** (401/401: 0 wrong, 0 missing, 0 spurious) · classification 100.0% · 43/43 documents valid (rules can run on them)

| Document | Accuracy | Correct | Wrong | Missing | Spurious | Valid documents |
| --- | --- | --- | --- | --- | --- | --- |
| AIR_WAYBILL | 100.0% | 130 | 0 | 0 | 0 | 9/9 |
| CERTIFICATE_OF_ORIGIN | 100.0% | 102 | 0 | 0 | 0 | 12/12 |
| CUSMA_CERTIFICATION | 100.0% | 28 | 0 | 0 | 0 | 3/3 |
| ARRIVAL_NOTICE | 100.0% | 83 | 0 | 0 | 0 | 11/11 |
| WOOD_PACKAGING_CERTIFICATE | 100.0% | 42 | 0 | 0 | 0 | 6/6 |
| DANGEROUS_GOODS_DECLARATION | 100.0% | 16 | 0 | 0 | 0 | 2/2 |

## By template

| Template | Accuracy | Fields |
| --- | --- | --- |
| AIR_WAYBILL · classic | 100.0% | 130 |
| ARRIVAL_NOTICE · classic | 100.0% | 83 |
| CERTIFICATE_OF_ORIGIN · classic | 100.0% | 102 |
| CUSMA_CERTIFICATION · classic | 100.0% | 28 |
| DANGEROUS_GOODS_DECLARATION · classic | 100.0% | 16 |
| WOOD_PACKAGING_CERTIFICATE · classic | 100.0% | 42 |

## Weakest fields

| Document | Field | Accuracy | Wrong | Missing | Spurious |
| --- | --- | --- | --- | --- | --- |

## Rules on extracted documents vs injected errors

20 of 20 shipments had all their PDFs extracted.

| Rule | Recall | Precision | TP | FP | FN |
| --- | --- | --- | --- | --- | --- |
| T10 | 100.0% | 100.0% | 1 | 0 | 0 |
| T11 | 100.0% | 100.0% | 2 | 0 | 0 |
| T12 | 100.0% | 100.0% | 6 | 0 | 0 |
| T2 | 100.0% | 100.0% | 3 | 0 | 0 |
| T3 | 100.0% | 100.0% | 1 | 0 | 0 |
| T7 | 100.0% | 100.0% | 4 | 0 | 0 |
| T8 | 100.0% | 100.0% | 5 | 0 | 0 |
| T9 | 100.0% | 100.0% | 2 | 0 | 0 |

Tokens: 26,083 in / 21,945 out · 512 s wall clock (cached documents count the tokens of the original call).
