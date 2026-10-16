-- Uploads that are not one PDF per document. A PDF (or workbook) holding several documents is split
-- into documents that share its file: `pages` are the pages (or sheets) each covers, numbered as in the
-- file, and `source_document_id` is the upload it was split from. `format` says what was uploaded: a
-- PDF, a spreadsheet (stored as uploaded), or a photo (stored as an image-only PDF).
-- extractions.attestation: signature and stamp seen on the paper (BL, certificates of origin).
alter table documents
  add column format text not null default 'PDF' check (format in ('PDF', 'SPREADSHEET', 'IMAGE')),
  add column pages int[],
  add column source_document_id uuid references documents (id) on delete set null;

alter table extractions add column attestation jsonb;
