-- The ISF can now come from an uploaded PDF (its filing confirmation). source = 'pdf' and
-- document_id point at that document, so X11 findings cite the page and a re-extraction as
-- another type removes it. JSON filings (PUT /shipments/:id/isf) keep document_id null.
alter table isf_filings add column document_id uuid references documents (id) on delete set null;
