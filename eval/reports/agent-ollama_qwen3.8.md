# Agent report — ollama:qwen3.8

Model build aaee06c39dcf · prompt `agent-v2` · 80 cases · 0 s

| Decision | Cases | Verdict accuracy | When answered | Wrong | Unsure | Right action on the finding |
| --- | --- | --- | --- | --- | --- | --- |
| Same consignee? (X1) | 40 | 87.5% | 100.0% | 0 | 5 | 100.0% |
| BL description consistent? (A1) | 40 | 100.0% | 100.0% | 0 | 0 | 100.0% |

Right action: X1 findings dismissed only for the same company, A1 findings added only for different goods. "Unsure" keeps the rule finding, so it is the right action whenever the companies differ.

## Wrong or unsure

- `CA-054:party:different` expected no, got unsure: ["Prairie Roasters Co-operative","Northern Lantern DC Brampton"] — The documents list two distinct names ('Prairie Roasters Co-operative' vs. 'Northern Lantern DC Brampton') and different cities (Winnipeg vs. Brampton) with no shared identifiers or evidence of a trade name relationship.
- `CA-071:party:different` expected no, got unsure: ["Northern Lantern DC Brampton","Bluebonnet Home Goods DC"] — The documents list two distinct company names ('Northern Lantern DC Brampton' vs. 'Bluebonnet Home Goods DC') and two different physical locations (Brampton, CA vs. Houston, US). Without additional corporate registry data or a link establishing that these are trade names for the same legal entity, the documents do not provide sufficient evidence to confirm they are the same party.
- `US-021:party:different` expected no, got unsure: ["Lakeshore Coffee Importers LLC","Pacific Trail Fulfillment Center"] — The documents list two distinct legal names ('Lakeshore Coffee Importers LLC' vs. 'Pacific Trail Fulfillment Center') and different addresses (Chicago, IL vs. Fontana, CA). Without additional documents (such as a corporate registry or a letter of authorization) linking these entities, it is impossible to determine if they are the same legal entity or different parties.
- `US-038:party:different` expected no, got unsure: ["Harborline Industrial Supply Inc.","Northern Lantern DC Brampton"] — The documents list two completely different names ('Harborline Industrial Supply Inc.' vs. 'Northern Lantern DC Brampton') and different locations (Elizabeth, NJ, US vs. Brampton, ON, CA). There is no evidence in the provided text to suggest these are trade names, abbreviations, or related entities of the same legal person.
- `US-064:party:different` expected no, got unsure: ["Lakeshore Coffee Importers LLC","Pacific Trail Fulfillment Center"] — The documents list two distinct legal names ('Lakeshore Coffee Importers LLC' vs. 'Pacific Trail Fulfillment Center') and different addresses (Chicago, IL vs. Fontana, CA). Without additional documents (such as a corporate registry or a letter of authorization) linking these entities, it is impossible to determine if they are the same legal entity or different parties.
