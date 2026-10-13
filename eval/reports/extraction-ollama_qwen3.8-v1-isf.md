# Extraction report — ollama:qwen3.8

Data `v1-isf` · model build aaee06c39dcf · prompt `extract-v3` · 100 shipments · 100 PDFs · 0 failed · 100 from cache

**Field accuracy 99.9%** (1398/1400: 0 wrong, 2 missing, 0 spurious) · classification 100.0% · 100/100 documents valid (rules can run on them)

| Document | Accuracy | Correct | Wrong | Missing | Spurious | Valid documents |
| --- | --- | --- | --- | --- | --- | --- |
| ISF | 99.9% | 1398 | 0 | 2 | 0 | 100/100 |

## By template

| Template | Accuracy | Fields |
| --- | --- | --- |
| ISF · confirmation | 99.9% | 1400 |

## Weakest fields

| Document | Field | Accuracy | Wrong | Missing | Spurious |
| --- | --- | --- | --- | --- | --- |
| ISF | `manufacturer.address.city` | 99.0% | 0 | 1 | 0 |
| ISF | `containerStuffingLocation.city` | 99.0% | 0 | 1 | 0 |

## Rules on extracted documents vs injected errors

100 of 100 shipments had all their PDFs extracted.

| Rule | Recall | Precision | TP | FP | FN |
| --- | --- | --- | --- | --- | --- |
| U1 | 100.0% | 100.0% | 7 | 0 | 0 |
| X1 | 100.0% | 100.0% | 13 | 0 | 0 |
| X10 | 100.0% | 100.0% | 11 | 0 | 0 |
| X11 | 100.0% | 100.0% | 20 | 0 | 0 |
| X2 | 100.0% | 100.0% | 9 | 0 | 0 |
| X3 | 100.0% | 100.0% | 21 | 0 | 0 |
| X4 | 100.0% | 100.0% | 14 | 0 | 0 |
| X5 | 100.0% | 100.0% | 25 | 0 | 0 |
| X6 | 100.0% | 100.0% | 12 | 0 | 0 |
| X7 | 100.0% | 100.0% | 24 | 0 | 0 |

Tokens: 83,440 in / 74,431 out · 1 s wall clock (cached documents count the tokens of the original call).
