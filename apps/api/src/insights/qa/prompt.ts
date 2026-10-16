import { ALL_RULES } from '@doccheck/rules';
import { z } from 'zod';

/** Part of every cache key: change it whenever the prompt changes. */
export const QA_PROMPT_VERSION = 'qa-sql-v2';

export const QaOutput = z.object({
  sql: z.string().min(1).max(4000),
  explanation: z.string().max(500).optional(),
});
export type QaOutput = z.infer<typeof QaOutput>;

/** The views the model may query, as it reads them. Each one holds only the active organization's rows. */
export const VIEW_DOCS = `
shipments(id uuid, reference text, destination text 'CA'|'US', transport_mode text 'SEA'|'AIR'|'ROAD', status text, created_at timestamptz, validated_at timestamptz -- latest validation)
invoices(shipment_id uuid, invoice_number text, invoice_date date, po_number text, currency text, incoterm text, incoterm_place text, payment_terms text, seller_id uuid, seller_name text, buyer_id uuid, buyer_name text, port_of_entry_name text, port_of_entry_locode text, invoice_total numeric, invoice_total_currency text, lines_total numeric, line_count int, package_count int, gross_kg numeric, net_kg numeric, language text)
invoice_lines(shipment_id uuid, invoice_number text, invoice_date date, seller_id uuid, seller_name text, line_no int, sku text, description text, quantity numeric, quantity_unit text, unit_price numeric, currency text, line_total numeric, computed_total numeric -- quantity × unit_price, country_of_origin text -- ISO 3166 alpha-2 like 'CN', hs_code text, hs_digits text -- digits only, hs2 text, hs4 text, hs6 text, product_id uuid)
packing_lists(shipment_id uuid, packing_list_number text, invoice_ref text, package_count int, gross_kg numeric, net_kg numeric, volume_m3 numeric)
bills_of_lading(shipment_id uuid, bl_number text, carrier_name text, carrier_scac text, vessel text, voyage text, port_of_loading text -- UN/LOCODE like 'CNSHA', port_of_loading_country text, port_of_discharge text, port_of_discharge_country text, place_of_delivery text, total_packages int, gross_kg numeric, container_count int, freight_terms text 'PREPAID'|'COLLECT', date_of_issue date, shipped_on_board_date date)
containers(shipment_id uuid, container_number text, owner_code text, seal text, size_type text, packages int, gross_kg numeric, volume_m3 numeric)
isf(shipment_id uuid, source text, importer_of_record_number text, country_of_origin text, hts_code text, hs6 text, stuffing_country text)
parties(id uuid, name text, country text, tax_id text, first_seen_at timestamptz, last_seen_at timestamptz) -- companies
products(id uuid, sku text, description text, hs_code text, hs6 text, country_of_origin text, unit text, seller_id uuid)
findings(shipment_id uuid, validated_at timestamptz, destination text, rule_id text, severity text 'CRITICAL'|'HIGH'|'MEDIUM'|'LOW', decided_by text, message text, document_type text 'COMMERCIAL_INVOICE'|'PACKING_LIST'|'BILL_OF_LADING'|'ISF', field text, status text 'open'|'waiting_supplier'|'accepted'|'false_positive', first_found_at timestamptz) -- findings of each shipment's latest validation
mail_requests(id uuid, shipment_id uuid, party_id uuid, party_name text, kind text 'correction_request'|'conversation', status text 'awaiting'|'replied'|'closed', created_at timestamptz, closed_at timestamptz, sent_at timestamptz, first_reply_at timestamptz) -- conversations with suppliers
`.trim();

const rules = () => ALL_RULES.map((r) => `${r.definition.id}: ${r.definition.title}`).join('\n');

export function qaSystemPrompt(): string {
  return `You translate a question about a customs-documents account into ONE PostgreSQL SELECT query.

Views you can read (nothing else exists for you):
${VIEW_DOCS}

Rules that produce findings (rule_id: what it checks):
${rules()}
Weight errors are rules X3 and X4; package counts X2; invoice arithmetic X5; currency X6; quantities X7; ISF X11.

Write only a single SELECT (WITH is fine). Use the bare view names above, no schema. Join on shipment_id.
Do not use comments, parameters ($1), semicolons between statements, or functions other than common
aggregates, date and text functions (count, sum, avg, min, max, round, coalesce, lower, upper, date_trunc,
extract, to_char, now, current_date). For dates relative to today use current_date. An HS chapter "HS 61" means hs2 = '61'; a country is its ISO
alpha-2 code ('China' is 'CN'). "This month" means date_trunc('month', <timestamp>) = date_trunc('month', current_date).
Return few, readable columns (reference rather than ids where you can), and ORDER BY something meaningful.
Answer as JSON: {"sql": "...", "explanation": "one sentence on what the query returns"}.`;
}

/**
 * The question alone: dates in the query are relative to current_date, so the prompt (and its cache
 * key) does not change from day to day and the evaluation replays without a model.
 */
export function qaUserPrompt(question: string): string {
  return `Question: ${question}`;
}
