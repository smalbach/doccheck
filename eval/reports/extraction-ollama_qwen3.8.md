# Extraction report — ollama:qwen3.8

Data `v1` · model build aaee06c39dcf · prompt `extract-v3` · OCR tesseract · 200 shipments · 600 PDFs · 0 failed · 600 from cache

**Field accuracy 99.8%** (13172/13198: 17 wrong, 9 missing, 0 spurious) · classification 100.0% · 600/600 documents valid (rules can run on them)

| Document | Accuracy | Correct | Wrong | Missing | Spurious | Valid documents |
| --- | --- | --- | --- | --- | --- | --- |
| COMMERCIAL_INVOICE | 100.0% | 5846 | 1 | 1 | 0 | 200/200 |
| PACKING_LIST | 99.6% | 3337 | 5 | 8 | 0 | 200/200 |
| BILL_OF_LADING | 99.7% | 3989 | 11 | 0 | 0 | 200/200 |

## By template

| Template | Accuracy | Fields |
| --- | --- | --- |
| BILL_OF_LADING · classic | 100.0% | 1520 |
| BILL_OF_LADING · legacy | 100.0% | 1240 |
| BILL_OF_LADING · modern | 99.1% | 1240 |
| COMMERCIAL_INVOICE · classic | 100.0% | 2199 |
| COMMERCIAL_INVOICE · legacy | 100.0% | 1794 |
| COMMERCIAL_INVOICE · modern | 100.0% | 1855 |
| PACKING_LIST · classic | 99.9% | 1269 |
| PACKING_LIST · legacy | 99.2% | 963 |
| PACKING_LIST · modern | 99.6% | 1118 |

## Weakest fields

| Document | Field | Accuracy | Wrong | Missing | Spurious |
| --- | --- | --- | --- | --- | --- |
| BILL_OF_LADING | `vessel` | 97.0% | 6 | 0 | 0 |
| PACKING_LIST | `packages[*].type` | 98.5% | 5 | 0 | 0 |
| PACKING_LIST | `packages[*].netWeight.kg` | 98.8% | 0 | 4 | 0 |
| PACKING_LIST | `packages[*].grossWeight.kg` | 98.8% | 0 | 4 | 0 |
| COMMERCIAL_INVOICE | `portOfEntry.name` | 99.0% | 0 | 1 | 0 |
| BILL_OF_LADING | `portOfDischarge.name` | 99.0% | 2 | 0 | 0 |
| BILL_OF_LADING | `placeOfDelivery.name` | 99.0% | 2 | 0 | 0 |
| COMMERCIAL_INVOICE | `poNumber` | 99.5% | 1 | 0 | 0 |
| BILL_OF_LADING | `voyage` | 99.5% | 1 | 0 | 0 |

## Rules on extracted documents vs injected errors

200 of 200 shipments had all their PDFs extracted.

| Rule | Recall | Precision | TP | FP | FN |
| --- | --- | --- | --- | --- | --- |
| C1 | 100.0% | 100.0% | 6 | 0 | 0 |
| U1 | 100.0% | 87.5% | 7 | 1 | 0 |
| X1 | 100.0% | 100.0% | 29 | 0 | 0 |
| X10 | 100.0% | 100.0% | 26 | 0 | 0 |
| X2 | 100.0% | 100.0% | 28 | 0 | 0 |
| X3 | 100.0% | 100.0% | 43 | 0 | 0 |
| X4 | 100.0% | 100.0% | 22 | 0 | 0 |
| X5 | 100.0% | 100.0% | 52 | 0 | 0 |
| X6 | 100.0% | 100.0% | 27 | 0 | 0 |
| X7 | 100.0% | 100.0% | 50 | 0 | 0 |

Tokens: 408,511 in / 497,684 out · 2 s wall clock (cached documents count the tokens of the original call).
