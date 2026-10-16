# Party screening evaluation (fixture lists)

260 synthetic shipments, 47 list entries, thresholds: match 0.92, review 0.82.
Each shipment is screened as generated (its parties are invented: any finding is a false positive), with one party replaced by a list entity written one of six ways, and with a buyer renamed to a decoy that shares one word with a list entity.

| Metric | Result |
| --- | --- |
| Recall, injected entry flagged (S1 or S2) | 98.1% (255/260) |
| Recall, exact / legal form / alias / word order caught as S1 | 100.0% (174/174) |
| Precision, S1 and S2 findings on the injected party (any other party is a false positive) | 100.0% (265/265) |
| Precision, S1 findings only | 100.0% (232/232) |

| Written as | Cases | Flagged | As S1 |
| --- | --- | --- | --- |
| exact | 44 | 100.0% | 100.0% |
| case-and-legal-form | 44 | 100.0% | 100.0% |
| alias | 43 | 100.0% | 100.0% |
| typo | 43 | 100.0% | 95.3% |
| extra-word | 43 | 88.4% | 18.6% |
| word-order | 43 | 100.0% | 100.0% |

False positives: 0.

Misses: 5
- v1/CA-059 extra-word "Huawei Technologies Co., Ltd. Industrial" for "Huawei Technologies Co., Ltd.": nothing
- v1/US-031 extra-word "STAN LLC Trading" for "STAN LLC": nothing
- v1/US-049 extra-word "ROSOBORONEKSPORT OAO Trading" for "ROSOBORONEKSPORT OAO": nothing
- v1/US-091 extra-word "CIMEX Trading" for "CIMEX": nothing
- v2/CA-021 extra-word "ADF Group" for "ADF": nothing
