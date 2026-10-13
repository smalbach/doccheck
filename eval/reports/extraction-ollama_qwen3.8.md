# Extraction report — ollama:qwen3.8

Data `v1` · model build aaee06c39dcf · prompt `extract-v3` · 200 shipments · 600 PDFs · 0 failed · 581 from cache

**Field accuracy 99.8%** (13172/13205: 17 wrong, 9 missing, 7 spurious) · classification 100.0%

| Document | Accuracy | Correct | Wrong | Missing | Spurious |
| --- | --- | --- | --- | --- | --- |
| COMMERCIAL_INVOICE | 99.9% | 5846 | 1 | 1 | 7 |
| PACKING_LIST | 99.6% | 3337 | 5 | 8 | 0 |
| BILL_OF_LADING | 99.7% | 3989 | 11 | 0 | 0 |

## By template

| Template | Accuracy | Fields |
| --- | --- | --- |
| BILL_OF_LADING · classic | 100.0% | 1520 |
| BILL_OF_LADING · legacy | 100.0% | 1240 |
| BILL_OF_LADING · modern | 99.1% | 1240 |
| COMMERCIAL_INVOICE · classic | 99.9% | 2200 |
| COMMERCIAL_INVOICE · legacy | 99.7% | 1799 |
| COMMERCIAL_INVOICE · modern | 99.9% | 1856 |
| PACKING_LIST · classic | 99.9% | 1269 |
| PACKING_LIST · legacy | 99.2% | 963 |
| PACKING_LIST · modern | 99.6% | 1118 |

## Weakest fields

| Document | Field | Accuracy | Wrong | Missing | Spurious |
| --- | --- | --- | --- | --- | --- |
| COMMERCIAL_INVOICE | `portOfEntry.name` | 96.1% | 0 | 1 | 3 |
| BILL_OF_LADING | `vessel` | 97.0% | 6 | 0 | 0 |
| PACKING_LIST | `packages[*].type` | 98.5% | 5 | 0 | 0 |
| PACKING_LIST | `packages[*].netWeight.kg` | 98.8% | 0 | 4 | 0 |
| PACKING_LIST | `packages[*].grossWeight.kg` | 98.8% | 0 | 4 | 0 |
| COMMERCIAL_INVOICE | `consignee.name` | 99.0% | 0 | 0 | 2 |
| BILL_OF_LADING | `portOfDischarge.name` | 99.0% | 2 | 0 | 0 |
| BILL_OF_LADING | `placeOfDelivery.name` | 99.0% | 2 | 0 | 0 |
| COMMERCIAL_INVOICE | `lines[*].countryOfOrigin` | 99.4% | 0 | 0 | 2 |
| COMMERCIAL_INVOICE | `poNumber` | 99.5% | 1 | 0 | 0 |
| BILL_OF_LADING | `voyage` | 99.5% | 1 | 0 | 0 |

## Rules on extracted documents vs injected errors

200 of 200 shipments had all their PDFs extracted.

| Rule | Recall | Precision | TP | FP | FN |
| --- | --- | --- | --- | --- | --- |
| C1 | 83.3% | 100.0% | 5 | 0 | 1 |
| U1 | 71.4% | 83.3% | 5 | 1 | 2 |
| X1 | 100.0% | 100.0% | 29 | 0 | 0 |
| X10 | 100.0% | 100.0% | 26 | 0 | 0 |
| X2 | 100.0% | 100.0% | 28 | 0 | 0 |
| X3 | 100.0% | 100.0% | 43 | 0 | 0 |
| X4 | 100.0% | 100.0% | 22 | 0 | 0 |
| X5 | 100.0% | 100.0% | 52 | 0 | 0 |
| X6 | 100.0% | 100.0% | 27 | 0 | 0 |
| X7 | 100.0% | 100.0% | 50 | 0 | 0 |

Tokens: 408,511 in / 497,684 out · 2115 s wall clock (cached documents count the tokens of the original call).
