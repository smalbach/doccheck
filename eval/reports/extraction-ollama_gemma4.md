# Extraction report — ollama:gemma4

Prompt `extract-v2` · 6 shipments · 18 PDFs · 0 failed · 0 from cache

**Field accuracy 56.7%** (202/356: 5 wrong, 149 missing, 0 spurious) · classification 100.0%

| Document | Accuracy | Correct | Wrong | Missing | Spurious |
| --- | --- | --- | --- | --- | --- |
| COMMERCIAL_INVOICE | 80.9% | 123 | 1 | 28 | 0 |
| PACKING_LIST | 72.6% | 61 | 4 | 19 | 0 |
| BILL_OF_LADING | 15.0% | 18 | 0 | 102 | 0 |

## By template

| Template | Accuracy | Fields |
| --- | --- | --- |
| BILL_OF_LADING · classic | 90.0% | 20 |
| BILL_OF_LADING · legacy | 0.0% | 40 |
| BILL_OF_LADING · modern | 0.0% | 60 |
| COMMERCIAL_INVOICE · legacy | 70.8% | 96 |
| COMMERCIAL_INVOICE · modern | 98.2% | 56 |
| PACKING_LIST · classic | 52.6% | 19 |
| PACKING_LIST · legacy | 80.8% | 26 |
| PACKING_LIST · modern | 76.9% | 39 |

## Weakest fields

| Document | Field | Accuracy | Wrong | Missing | Spurious |
| --- | --- | --- | --- | --- | --- |
| COMMERCIAL_INVOICE | `charges.freight.amount` | 0.0% | 0 | 1 | 0 |
| COMMERCIAL_INVOICE | `charges.freight.currency` | 0.0% | 0 | 1 | 0 |
| BILL_OF_LADING | `carrier.scac` | 0.0% | 0 | 6 | 0 |
| BILL_OF_LADING | `containers[*].grossWeight.kg` | 0.0% | 0 | 6 | 0 |
| PACKING_LIST | `packages[*].netWeight.kg` | 14.3% | 0 | 6 | 0 |
| PACKING_LIST | `packages[*].grossWeight.kg` | 14.3% | 0 | 6 | 0 |
| BILL_OF_LADING | `blNumber` | 16.7% | 0 | 5 | 0 |
| BILL_OF_LADING | `bookingNumber` | 16.7% | 0 | 5 | 0 |
| BILL_OF_LADING | `shipper.name` | 16.7% | 0 | 5 | 0 |
| BILL_OF_LADING | `consignee.name` | 16.7% | 0 | 5 | 0 |
| BILL_OF_LADING | `consignee.address.lines[0]` | 16.7% | 0 | 5 | 0 |
| BILL_OF_LADING | `notifyParty.name` | 16.7% | 0 | 5 | 0 |
| BILL_OF_LADING | `vessel` | 16.7% | 0 | 5 | 0 |
| BILL_OF_LADING | `voyage` | 16.7% | 0 | 5 | 0 |
| BILL_OF_LADING | `portOfLoading.name` | 16.7% | 0 | 5 | 0 |

## Rules on extracted documents vs injected errors

1 of 6 shipments had all three documents extracted.

| Rule | Recall | Precision | TP | FP | FN |
| --- | --- | --- | --- | --- | --- |
| X10 | — | — | 0 | 0 | 0 |
| X2 | — | — | 0 | 0 | 0 |
| X3 | — | — | 0 | 0 | 0 |
| X6 | — | — | 0 | 0 | 0 |

Tokens: 12,155 in / 12,323 out · 223 s wall clock (cached documents count the tokens of the original call).
