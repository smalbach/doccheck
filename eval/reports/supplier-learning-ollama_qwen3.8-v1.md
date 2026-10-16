# Supplier learning: v1 (ollama:qwen3.8)

200 shipments, 600 documents in order; 82 were extracted with examples (up to 5 per document) from earlier corrections of the same supplier. Baseline: the same documents with no examples.

| Fields | Scored | Baseline | With learning | Correct |
| --- | --- | --- | --- | --- |
| All documents | 13198 | 99.8% | 99.8% | 13172 → 13173 |
| Documents given examples | 1630 | 99.8% | 99.9% | 1627 → 1628 |
| Net and gross weights | 1850 | 99.6% | 99.6% | 1842 → 1842 |

Suppliers with examples at the end: Pune Precision Engineering Pvt. Ltd. (1), Nordhafen Armaturen GmbH (1), Brightstar Toys Manufacturing Co., Ltd. (4), Cafe Alto Huila Exportadores S.A.S. (3), Ningbo Everbright Appliance Co., Ltd. (4), Ceramiche Valle Secchia S.p.A. (1).
