# Supplier learning: v2 (ollama:qwen3.8)

60 shipments, 180 documents in order; 11 were extracted with examples (up to 5 per document) from earlier corrections of the same supplier. Baseline: the same documents with no examples.

| Fields | Scored | Baseline | With learning | Correct |
| --- | --- | --- | --- | --- |
| All documents | 16889 | 98.8% | 99.4% | 16679 → 16784 |
| Documents given examples | 564 | 81.0% | 99.7% | 457 → 562 |
| Net and gross weights | 2282 | 94.0% | 97.1% | 2146 → 2216 |

Suppliers with examples at the end: Saigon Apparel Joint Stock Company (6), Nordhafen Armaturen GmbH (3), Azeites do Alentejo, Lda. (1), Cooperativa Agraria Cafetalera Pangoa Ltda. (6), Công ty Cổ phần May Đông Á (1).
