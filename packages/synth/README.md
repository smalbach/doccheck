# @doccheck/synth

Builds the evaluation set (phase 1). Everything is derived from one seed, so the set is reproducible.

1. `generate.ts` builds a clean, consistent shipment: fictional seller and buyer (`catalog.ts`), 1–4 invoice lines, packages, weights, containers with valid ISO 6346 numbers, and an ISF for US shipments. All money and weights use fixed-point decimals.
2. `errors.ts` injects errors of distinct kinds and returns a label for each one: document, field path, before/after and expected rule ids.
3. `render.ts` prints invoice, packing list and BL as HTML with three templates each (classic, modern, legacy); `pdf.ts` turns them into PDFs with headless Chromium.
4. `dataset.ts` assembles v1: 200 shipments, 100 per country, 25 clean per country, the rest with 1–3 errors.

```bash
npm run synth                         # writes data/eval/v1
npm run synth -- --no-pdf --html      # JSON + HTML only, no browser needed
npm run synth -- --seed 7 --out /tmp/eval
npm run synth -- --labels-only        # rewrite labels.json after rule coverage changes; PDFs untouched
```

| Error kind | Document | Expected rule |
| --- | --- | --- |
| `package_count_mismatch` | BL or invoice | X2 |
| `gross_weight_mismatch` | BL | X3 |
| `net_exceeds_gross` | invoice | X4 |
| `line_quantity_changed` | invoice | X5, X7 |
| `line_total_typo` | invoice | X5 |
| `second_currency` | invoice | X6 |
| `container_check_digit` | BL | X10 |
| `consignee_address_mismatch` | BL | X1 |
| `packing_list_quantity_mismatch` | packing list | X7 |
| `missing_required_field` | invoice | C1 or U1 when the destination requires the field; none otherwise |

Not done yet from the original plan: 4–6 templates per document (3 so far), tables split across pages on purpose, and degraded "scanned" variants. Add them when phase 2 extraction shows which variations matter.
