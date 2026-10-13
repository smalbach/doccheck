# Extraction report — ollama:qwen3.8

Prompt `extract-v3` · 6 shipments · 18 PDFs · 0 failed · 18 from cache

**Field accuracy 99.4%** (355/357: 1 wrong, 0 missing, 1 spurious) · classification 100.0%

| Document | Accuracy | Correct | Wrong | Missing | Spurious |
| --- | --- | --- | --- | --- | --- |
| COMMERCIAL_INVOICE | 99.4% | 152 | 0 | 0 | 1 |
| PACKING_LIST | 100.0% | 84 | 0 | 0 | 0 |
| BILL_OF_LADING | 99.2% | 119 | 1 | 0 | 0 |

## By template

| Template | Accuracy | Fields |
| --- | --- | --- |
| BILL_OF_LADING · classic | 100.0% | 20 |
| BILL_OF_LADING · legacy | 100.0% | 40 |
| BILL_OF_LADING · modern | 98.3% | 60 |
| COMMERCIAL_INVOICE · legacy | 99.0% | 97 |
| COMMERCIAL_INVOICE · modern | 100.0% | 56 |
| PACKING_LIST · classic | 100.0% | 19 |
| PACKING_LIST · legacy | 100.0% | 26 |
| PACKING_LIST · modern | 100.0% | 39 |

## Weakest fields

| Document | Field | Accuracy | Wrong | Missing | Spurious |
| --- | --- | --- | --- | --- | --- |
| COMMERCIAL_INVOICE | `portOfEntry.name` | 75.0% | 0 | 0 | 1 |
| BILL_OF_LADING | `vessel` | 83.3% | 1 | 0 | 0 |

## Rules on extracted documents vs injected errors

6 of 6 shipments had all three documents extracted.

| Rule | Recall | Precision | TP | FP | FN |
| --- | --- | --- | --- | --- | --- |
| X10 | 100.0% | 100.0% | 1 | 0 | 0 |
| X2 | 100.0% | 100.0% | 2 | 0 | 0 |
| X3 | 100.0% | 100.0% | 2 | 0 | 0 |
| X6 | 100.0% | 100.0% | 1 | 0 | 0 |

Tokens: 12,146 in / 14,308 out · 0 s wall clock (cached documents count the tokens of the original call).
