# Extraction report — ollama:qwen3.8

Data `v1-scans` · model build aaee06c39dcf · prompt `extract-v3` · 40 shipments · 120 PDFs · 0 failed · 120 from cache

**Field accuracy 81.5%** (2059/2526: 201 wrong, 261 missing, 5 spurious) · classification 100.0% · 93/120 documents valid (rules can run on them)

| Document | Accuracy | Correct | Wrong | Missing | Spurious | Valid documents |
| --- | --- | --- | --- | --- | --- | --- |
| COMMERCIAL_INVOICE | 84.6% | 934 | 81 | 84 | 5 | 26/40 |
| PACKING_LIST | 78.3% | 487 | 50 | 85 | 0 | 32/40 |
| BILL_OF_LADING | 79.8% | 638 | 70 | 92 | 0 | 35/40 |

## By template

| Template | Accuracy | Fields |
| --- | --- | --- |
| BILL_OF_LADING · classic | 78.7% | 300 |
| BILL_OF_LADING · legacy | 67.2% | 180 |
| BILL_OF_LADING · modern | 87.8% | 320 |
| COMMERCIAL_INVOICE · classic | 82.3% | 401 |
| COMMERCIAL_INVOICE · legacy | 89.2% | 437 |
| COMMERCIAL_INVOICE · modern | 80.5% | 266 |
| PACKING_LIST · classic | 65.8% | 257 |
| PACKING_LIST · legacy | 84.5% | 129 |
| PACKING_LIST · modern | 88.6% | 236 |

## Weakest fields

| Document | Field | Accuracy | Wrong | Missing | Spurious |
| --- | --- | --- | --- | --- | --- |
| BILL_OF_LADING | `containers[*].grossWeight.kg` | 45.0% | 0 | 22 | 0 |
| BILL_OF_LADING | `containers[*].packages` | 47.5% | 2 | 19 | 0 |
| BILL_OF_LADING | `containers[*].seal` | 52.5% | 2 | 17 | 0 |
| BILL_OF_LADING | `containers[*].number` | 57.5% | 1 | 16 | 0 |
| PACKING_LIST | `packages[*].grossWeight.kg` | 64.9% | 2 | 18 | 0 |
| PACKING_LIST | `totals.grossWeight.kg` | 65.0% | 1 | 13 | 0 |
| COMMERCIAL_INVOICE | `lines[*].unitPrice.amount` | 66.7% | 9 | 10 | 0 |
| PACKING_LIST | `packages[*].netWeight.kg` | 66.7% | 3 | 16 | 0 |
| COMMERCIAL_INVOICE | `invoiceNumber` | 70.0% | 12 | 0 | 0 |
| PACKING_LIST | `invoiceRef` | 72.5% | 9 | 2 | 0 |
| PACKING_LIST | `totals.netWeight.kg` | 72.5% | 0 | 11 | 0 |
| BILL_OF_LADING | `voyage` | 72.5% | 10 | 1 | 0 |
| PACKING_LIST | `packages[*].contents[0].quantity.value` | 75.4% | 5 | 9 | 0 |
| COMMERCIAL_INVOICE | `lines[*].hsCode` | 77.2% | 4 | 9 | 0 |
| BILL_OF_LADING | `bookingNumber` | 77.5% | 9 | 0 | 0 |

## Rules on extracted documents vs injected errors

21 of 40 shipments had all their PDFs extracted.

| Rule | Recall | Precision | TP | FP | FN |
| --- | --- | --- | --- | --- | --- |
| C1 | 100.0% | 50.0% | 1 | 1 | 0 |
| U1 | 0.0% | 0.0% | 0 | 1 | 2 |
| X1 | — | 0.0% | 0 | 4 | 0 |
| X10 | 66.7% | 100.0% | 4 | 0 | 2 |
| X2 | — | 0.0% | 0 | 1 | 0 |
| X3 | 50.0% | 100.0% | 1 | 0 | 1 |
| X4 | — | — | 0 | 0 | 0 |
| X5 | 100.0% | 83.3% | 10 | 2 | 0 |
| X6 | 75.0% | 100.0% | 3 | 0 | 1 |
| X7 | 100.0% | 80.0% | 8 | 2 | 0 |
| X8 | — | 0.0% | 0 | 2 | 0 |

Tokens: 79,639 in / 91,839 out · 158 s wall clock (cached documents count the tokens of the original call).
