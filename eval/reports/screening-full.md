# Party screening evaluation (full lists)

260 synthetic shipments, 38383 list entries, thresholds: match 0.92, review 0.82.
Each shipment is screened as generated (its parties are invented: any finding is a false positive), with one party replaced by a list entity written one of six ways, and with a buyer renamed to a decoy that shares one word with a list entity.

| Metric | Result |
| --- | --- |
| Recall, injected entry flagged (S1 or S2) | 99.2% (258/260) |
| Recall, exact / legal form / alias / word order caught as S1 | 100.0% (174/174) |
| Precision, S1 and S2 findings on the injected party (any other party is a false positive) | 100.0% (443/443) |
| Precision, S1 findings only | 100.0% (366/366) |

| Written as | Cases | Flagged | As S1 |
| --- | --- | --- | --- |
| exact | 44 | 100.0% | 100.0% |
| case-and-legal-form | 44 | 100.0% | 100.0% |
| alias | 43 | 100.0% | 100.0% |
| typo | 43 | 97.7% | 93.0% |
| extra-word | 43 | 97.7% | 46.5% |
| word-order | 43 | 100.0% | 100.0% |

False positives: 0.

Misses: 2
- v1/US-006 typo "Huawei Technolgoies Co., Ltd." for "Huawei Technologies Co., Ltd.": S1 "Huawei Technologies Co., Ltd. (Huawei)" 0.992; S1 "HUAWEI TECHNOLOGIES CO., LTD." 0.991
- v2/CA-021 extra-word "ADF Group" for "ADF": nothing
