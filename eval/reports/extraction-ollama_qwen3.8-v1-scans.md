# Extraction report — ollama:qwen3.8

Data `v1-scans` · model build aaee06c39dcf · prompt `extract-v3` · 40 shipments · 120 PDFs · 0 failed · 0 from cache

**Field accuracy 57.6%** (1453/2523: 84 wrong, 984 missing, 2 spurious) · classification 100.0%

| Document | Accuracy | Correct | Wrong | Missing | Spurious |
| --- | --- | --- | --- | --- | --- |
| COMMERCIAL_INVOICE | 44.8% | 493 | 16 | 590 | 2 |
| PACKING_LIST | 69.1% | 430 | 33 | 159 | 0 |
| BILL_OF_LADING | 66.3% | 530 | 35 | 235 | 0 |

## By template

| Template | Accuracy | Fields |
| --- | --- | --- |
| BILL_OF_LADING · classic | 66.7% | 300 |
| BILL_OF_LADING · legacy | 52.2% | 180 |
| BILL_OF_LADING · modern | 73.8% | 320 |
| COMMERCIAL_INVOICE · classic | 37.8% | 400 |
| COMMERCIAL_INVOICE · legacy | 67.6% | 435 |
| COMMERCIAL_INVOICE · modern | 18.1% | 266 |
| PACKING_LIST · classic | 50.6% | 257 |
| PACKING_LIST · legacy | 77.5% | 129 |
| PACKING_LIST · modern | 84.8% | 236 |

## Weakest fields

| Document | Field | Accuracy | Wrong | Missing | Spurious |
| --- | --- | --- | --- | --- | --- |
| BILL_OF_LADING | `containers[*].grossWeight.kg` | 37.5% | 0 | 25 | 0 |
| COMMERCIAL_INVOICE | `lines[*].countryOfOrigin` | 38.6% | 0 | 33 | 2 |
| BILL_OF_LADING | `containers[*].packages` | 40.0% | 2 | 22 | 0 |
| COMMERCIAL_INVOICE | `lines[*].description` | 42.1% | 2 | 31 | 0 |
| COMMERCIAL_INVOICE | `lines[*].unitPrice.amount` | 42.1% | 2 | 31 | 0 |
| COMMERCIAL_INVOICE | `lines[*].hsCode` | 42.1% | 1 | 32 | 0 |
| COMMERCIAL_INVOICE | `invoiceNumber` | 42.5% | 2 | 21 | 0 |
| COMMERCIAL_INVOICE | `buyer.name` | 42.5% | 2 | 21 | 0 |
| COMMERCIAL_INVOICE | `lines[*].quantity.value` | 43.9% | 1 | 31 | 0 |
| COMMERCIAL_INVOICE | `lines[*].quantity.unit` | 43.9% | 1 | 31 | 0 |
| COMMERCIAL_INVOICE | `lines[*].lineTotal.amount` | 43.9% | 1 | 31 | 0 |
| COMMERCIAL_INVOICE | `invoiceDate` | 45.0% | 0 | 22 | 0 |
| COMMERCIAL_INVOICE | `poNumber` | 45.0% | 1 | 21 | 0 |
| COMMERCIAL_INVOICE | `packageCount` | 45.0% | 0 | 22 | 0 |
| COMMERCIAL_INVOICE | `netWeight.kg` | 45.0% | 1 | 21 | 0 |

## Rules on extracted documents vs injected errors

18 of 40 shipments had all their PDFs extracted.

| Rule | Recall | Precision | TP | FP | FN |
| --- | --- | --- | --- | --- | --- |
| C1 | 100.0% | 50.0% | 1 | 1 | 0 |
| U1 | 0.0% | 0.0% | 0 | 1 | 2 |
| X1 | — | 0.0% | 0 | 4 | 0 |
| X10 | 60.0% | 100.0% | 3 | 0 | 2 |
| X2 | — | 0.0% | 0 | 1 | 0 |
| X3 | 50.0% | 100.0% | 1 | 0 | 1 |
| X4 | — | — | 0 | 0 | 0 |
| X5 | 100.0% | 90.0% | 9 | 1 | 0 |
| X6 | 75.0% | 100.0% | 3 | 0 | 1 |
| X7 | 100.0% | 88.9% | 8 | 1 | 0 |
| X8 | — | 0.0% | 0 | 2 | 0 |

Tokens: 79,639 in / 91,839 out · 4117 s wall clock (cached documents count the tokens of the original call).
