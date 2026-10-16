# Supplier learning: supplier-quirk (ollama:qwen3.8)

12 shipments, 36 documents in order; 33 were extracted with examples (up to 5 per document) from earlier corrections of the same supplier. Baseline: the same documents with no examples.

| Fields | Scored | Baseline | With learning | Correct |
| --- | --- | --- | --- | --- |
| All documents | 777 | 88.7% | 93.2% | 689 → 724 |
| Documents given examples | 719 | 88.7% | 93.6% | 638 → 673 |
| Net and gross weights | 110 | 21.8% | 52.7% | 24 → 58 |

Suppliers with examples at the end: Norland Precision Scales Co., Ltd. (7).
