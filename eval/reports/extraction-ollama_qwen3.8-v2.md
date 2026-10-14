# Extraction report — ollama:qwen3.8

Data `v2` · model build aaee06c39dcf · prompt `extract-v3` · OCR tesseract · 60 shipments · 180 PDFs · 0 failed · 180 from cache

**Field accuracy 98.8%** (16679/16889: 74 wrong, 136 missing, 0 spurious) · classification 100.0% · 177/180 documents valid (rules can run on them)

| Document | Accuracy | Correct | Wrong | Missing | Spurious | Valid documents |
| --- | --- | --- | --- | --- | --- | --- |
| COMMERCIAL_INVOICE | 100.0% | 9503 | 0 | 0 | 0 | 60/60 |
| PACKING_LIST | 96.7% | 5982 | 68 | 136 | 0 | 57/60 |
| BILL_OF_LADING | 99.5% | 1194 | 6 | 0 | 0 | 60/60 |

## By template

| Template | Accuracy | Fields |
| --- | --- | --- |
| BILL_OF_LADING · classic | 100.0% | 240 |
| BILL_OF_LADING · euro | 100.0% | 320 |
| BILL_OF_LADING · grid | 100.0% | 180 |
| BILL_OF_LADING · legacy | 100.0% | 280 |
| BILL_OF_LADING · modern | 96.7% | 180 |
| COMMERCIAL_INVOICE · classic | 100.0% | 1274 |
| COMMERCIAL_INVOICE · euro | 100.0% | 1932 |
| COMMERCIAL_INVOICE · grid | 100.0% | 3963 |
| COMMERCIAL_INVOICE · legacy | 100.0% | 1228 |
| COMMERCIAL_INVOICE · modern | 100.0% | 1106 |
| PACKING_LIST · classic | 100.0% | 982 |
| PACKING_LIST · euro | 100.0% | 1746 |
| PACKING_LIST · grid | 91.1% | 2301 |
| PACKING_LIST · legacy | 100.0% | 364 |
| PACKING_LIST · modern | 100.0% | 793 |

## Weakest fields

| Document | Field | Accuracy | Wrong | Missing | Spurious |
| --- | --- | --- | --- | --- | --- |
| PACKING_LIST | `packages[*].count` | 93.2% | 65 | 0 | 0 |
| PACKING_LIST | `packages[*].netWeight.kg` | 93.2% | 0 | 65 | 0 |
| PACKING_LIST | `packages[*].grossWeight.kg` | 93.2% | 0 | 65 | 0 |
| PACKING_LIST | `totals.packageCount` | 95.0% | 3 | 0 | 0 |
| PACKING_LIST | `totals.netWeight.kg` | 95.0% | 0 | 3 | 0 |
| PACKING_LIST | `totals.grossWeight.kg` | 95.0% | 0 | 3 | 0 |
| BILL_OF_LADING | `vessel` | 96.7% | 2 | 0 | 0 |
| BILL_OF_LADING | `blNumber` | 98.3% | 1 | 0 | 0 |
| BILL_OF_LADING | `voyage` | 98.3% | 1 | 0 | 0 |
| BILL_OF_LADING | `portOfDischarge.name` | 98.3% | 1 | 0 | 0 |
| BILL_OF_LADING | `placeOfDelivery.name` | 98.3% | 1 | 0 | 0 |

## Rules on extracted documents vs injected errors

57 of 60 shipments had all their PDFs extracted.

| Rule | Recall | Precision | TP | FP | FN |
| --- | --- | --- | --- | --- | --- |
| C1 | 100.0% | 100.0% | 4 | 0 | 0 |
| U1 | 100.0% | 100.0% | 3 | 0 | 0 |
| X1 | 100.0% | 100.0% | 11 | 0 | 0 |
| X10 | 100.0% | 100.0% | 7 | 0 | 0 |
| X2 | 100.0% | 100.0% | 4 | 0 | 0 |
| X3 | 100.0% | 100.0% | 8 | 0 | 0 |
| X4 | 100.0% | 100.0% | 4 | 0 | 0 |
| X5 | 100.0% | 100.0% | 19 | 0 | 0 |
| X6 | 100.0% | 100.0% | 7 | 0 | 0 |
| X7 | 100.0% | 100.0% | 18 | 0 | 0 |

Tokens: 233,957 in / 410,772 out · 1 s wall clock (cached documents count the tokens of the original call).
