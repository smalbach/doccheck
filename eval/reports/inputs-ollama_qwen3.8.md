# Input formats report — ollama:qwen3.8

Data `v1-inputs` · 20 clean shipments · prompt `extract-v3` · OCR tesseract

| Input | Documents | Field accuracy | Valid documents | Findings on clean shipments |
| --- | --- | --- | --- | --- |
| Invoice spreadsheet (.xlsx) | 20 | 100.0% | 20/20 | 0 (with the CSV packing list) |
| Packing list spreadsheet (.csv) | 20 | 100.0% | 20/20 | |
| Invoice photo (JPEG, OCR) | 20 | 91.2% | 18/20 | 29 |

Spreadsheet headers mapped by the model: 14. Photo deskew: mean error 0.03° against the rotation drawn; 20/20 classified as invoices.

Combined PDFs: 20 files, 60/60 documents split with the right type and pages (100.0%), 60/60 pages in the right document.
