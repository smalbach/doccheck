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
npm run synth -- --scans 40           # 40 shipments as image-only "scanned" PDFs in data/eval/v1-scans
```

Scans (`scans.ts`) render each page as a grayscale image with a slight rotation, blur, contrast change and speckle noise, at 150 dpi (office scanner) or, for 30% of shipments, 110 dpi with more blur (a poor scan), and wrap the images in a PDF with no text layer. Truth and labels are the same as the v1 shipments, so OCR can be scored with the same evaluation.

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

Set v1-docs (`--docs`, `documents.ts`, `render-documents.ts`) adds the other documents to 40 clean v1 shipments and injects these errors:

| Error kind | Document | Expected rule |
| --- | --- | --- |
| `awb_check_digit` | air waybill | T1 (and T12 with an arrival notice) |
| `awb_pieces_mismatch` | air waybill | T2 (and T12) |
| `awb_weight_mismatch` | air waybill | T3 (and T12) |
| `coo_exporter_mismatch` | certificate of origin | T7 |
| `coo_hs_mismatch` | certificate of origin | T8 |
| `cusma_missing_element` | CUSMA certification | T9 |
| `dg_declaration_missing` | dangerous goods declaration (dropped) | T10 |
| `ispm15_missing` | heat-treatment certificate (dropped) | T11 |
| `arrival_notice_mismatch` | arrival notice | T12 |
| `coo_unsigned` | certificate of origin printed without signature and stamp | T13 |

Set v1-inputs (`--inputs`, `inputs.ts`) writes, for 20 clean v1 shipments, the invoice as .xlsx and the packing list as .csv, the invoice as a phone photo (`photoOf`: turned on a desk, uneven light, JPEG) and the three documents in one PDF (`combineHtml`, with each document's CSS scoped to it).

Not done yet from the original plan: 4–6 templates per document (3 so far) and tables split across pages on purpose.
