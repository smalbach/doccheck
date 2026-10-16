# Tariff classification report — ollama:qwen3.8

Model build aaee06c39dcf · prompt `tariff-v1` · 41 goods, 82 fit cases · search hybrid (2026 HTS Revision 21) · 6 s

| Measure | Cases | Result |
| --- | --- | --- |
| Search: right heading in the top 5 | 41 | 80.5% (subheading 70.7%) |
| Does the description fit the heading? (A2): verdict | 82 | 98.8% (1 wrong, 0 unsure) |
| A2: right action (finding only for a wrong heading) | 82 | 98.8% |
| A2 verdict, right heading | 41 | 97.6% |
| A2 verdict, wrong heading from another chapter | 33 | 100.0% |
| A2 verdict, wrong heading a note excludes | 8 | 100.0% |
| Suggestion without a code: right heading in the top 3 | 41 | 95.1% (exact subheading first: 78.0%; right heading among the candidates: 95.1%) |

Right action: an A2 finding is added only on a confident "no" (confidence ≥ 0.7); "unsure" adds nothing, which is the right action when the heading is right.

## Wrong or unsure fit answers

- `32:right` "Polyethylene shopping bags" vs 39.23 (right): expected yes, got no 0.95 — Heading 42.02 explicitly lists "shopping bags" made of sheeting of plastics, and Chapter 42 Additional U.S. Note 1 confirms that "shopping bags" of this heading are included, whereas Chapter 39 Note 2 does not exclude them but the specific heading 42.02 takes precedence for this specific type of container.

## Search misses (right heading not in the top 5)

- "Centrifugal water pump 0.75 kW, cast iron body" (8413.70): 8418.69, 8421.99, 8421.21, 7303.00, 8421.22
- "Electric kettle 1.7 L, stainless steel, 1500 W, 120 V" (8516.71): 7323.93, 7324.10, 7222.19, 7222.30, 7221.00
- "Hex bolts M12 x 60, carbon steel, zinc plated" (7318.15): 7210.30, 7210.70, 7226.99, 7212.20, 7217.20
- "Wool blend socks, knitted, 3-pair pack" (6115.94): 6117.10, 6111.90, 6111.30, 6111.20, 6109.90
- "Jigsaw puzzle 1000 pieces, cardboard, boxed" (9503.00): 4819.10, 9705.10, 4812.00, 7607.11, 4819.20
- "Laptop computer, 14 inch screen, 1.4 kg" (8471.30): 9010.60, 9010.90, 8528.59, 9002.90, 8524.91
- "Women's handbag with outer surface of leather" (4202.21): 6403.19, 6403.51, 6404.20, 6403.59, 6405.10
- "Baby bodysuits, knitted cotton" (6111.20): 6114.20, 6106.10, 6105.10, 6107.91, 6114.30

## Suggestions without the right heading

- "Centrifugal water pump 0.75 kW, cast iron body" (8413.70), searched as "centrifugal pump for water, with cast iron body, driven by electric motor": 8421.99, 8421.21
- "Jigsaw puzzle 1000 pieces, cardboard, boxed" (9503.00), searched as "puzzle of cardboard, for amusement": 9504.90
