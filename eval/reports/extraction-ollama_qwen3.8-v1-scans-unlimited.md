# Extraction report — ollama:qwen3.8

Data `v1-scans` · model build aaee06c39dcf · prompt `extract-v3` · OCR unlimited · 40 shipments · 120 PDFs · 0 failed · 0 from cache

**Field accuracy 94.0%** (2371/2523: 76 wrong, 74 missing, 2 spurious) · classification 100.0% · 108/120 documents valid (rules can run on them)

| Document | Accuracy | Correct | Wrong | Missing | Spurious | Valid documents |
| --- | --- | --- | --- | --- | --- | --- |
| COMMERCIAL_INVOICE | 94.7% | 1043 | 30 | 26 | 2 | 37/40 |
| PACKING_LIST | 95.3% | 593 | 8 | 21 | 0 | 37/40 |
| BILL_OF_LADING | 91.9% | 735 | 38 | 27 | 0 | 34/40 |

## By template

| Template | Accuracy | Fields |
| --- | --- | --- |
| BILL_OF_LADING · classic | 98.7% | 300 |
| BILL_OF_LADING · legacy | 79.4% | 180 |
| BILL_OF_LADING · modern | 92.5% | 320 |
| COMMERCIAL_INVOICE · classic | 96.5% | 399 |
| COMMERCIAL_INVOICE · legacy | 92.7% | 436 |
| COMMERCIAL_INVOICE · modern | 95.5% | 266 |
| PACKING_LIST · classic | 96.5% | 257 |
| PACKING_LIST · legacy | 96.1% | 129 |
| PACKING_LIST · modern | 93.6% | 236 |

## Weakest fields

| Document | Field | Accuracy | Wrong | Missing | Spurious |
| --- | --- | --- | --- | --- | --- |
| COMMERCIAL_INVOICE | `poNumber` | 77.5% | 9 | 0 | 0 |
| COMMERCIAL_INVOICE | `consignee.name` | 79.0% | 2 | 6 | 0 |
| COMMERCIAL_INVOICE | `invoiceNumber` | 82.5% | 7 | 0 | 0 |
| PACKING_LIST | `totals.netWeight.kg` | 82.5% | 0 | 7 | 0 |
| PACKING_LIST | `totals.grossWeight.kg` | 82.5% | 0 | 7 | 0 |
| BILL_OF_LADING | `shipper.name` | 82.5% | 7 | 0 | 0 |
| BILL_OF_LADING | `consignee.name` | 87.5% | 5 | 0 | 0 |
| BILL_OF_LADING | `notifyParty.name` | 87.5% | 3 | 2 | 0 |
| BILL_OF_LADING | `vessel` | 87.5% | 5 | 0 | 0 |
| BILL_OF_LADING | `placeOfDelivery.name` | 87.5% | 0 | 5 | 0 |
| BILL_OF_LADING | `blNumber` | 90.0% | 4 | 0 | 0 |
| BILL_OF_LADING | `totalGrossWeight.kg` | 90.0% | 0 | 4 | 0 |
| BILL_OF_LADING | `totalGrossWeight.raw.unit` | 90.0% | 0 | 4 | 0 |
| BILL_OF_LADING | `containers[*].seal` | 90.0% | 2 | 2 | 0 |
| BILL_OF_LADING | `containers[*].packages` | 90.0% | 1 | 3 | 0 |

## Rules on extracted documents vs injected errors

29 of 40 shipments had all their PDFs extracted.

| Rule | Recall | Precision | TP | FP | FN |
| --- | --- | --- | --- | --- | --- |
| C1 | 100.0% | 66.7% | 2 | 1 | 0 |
| U1 | 100.0% | 100.0% | 2 | 0 | 0 |
| X1 | 100.0% | 33.3% | 1 | 2 | 0 |
| X10 | 100.0% | 100.0% | 4 | 0 | 0 |
| X2 | 100.0% | 100.0% | 1 | 0 | 0 |
| X3 | 100.0% | 100.0% | 2 | 0 | 0 |
| X4 | 100.0% | 100.0% | 3 | 0 | 0 |
| X5 | 100.0% | 100.0% | 9 | 0 | 0 |
| X6 | 100.0% | 100.0% | 5 | 0 | 0 |
| X7 | 100.0% | 83.3% | 10 | 2 | 0 |
| X8 | — | 0.0% | 0 | 5 | 0 |

Tokens: 76,510 in / 93,589 out · 4446 s wall clock (cached documents count the tokens of the original call).
