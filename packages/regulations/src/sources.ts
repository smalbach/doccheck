/**
 * Where the regulation corpus comes from and how each page becomes Markdown with front matter
 * (data/corpus/<authority>/<id>.md). Used by scripts/fetch-corpus.mjs and by the API's scheduled
 * check for changed passages. Sources are public government pages; nothing is sent to them but the request.
 */

export interface CorpusSource {
  id: string;
  authority: 'cbsa' | 'cbp';
  language: string;
  kind: 'cbsa-html' | 'ecfr';
  title: string;
  /** CBSA page. */
  url?: string;
  /** eCFR versioner query ("part=141&section=141.86") and the page people read. */
  query?: string;
  page?: string;
}

export const CORPUS_SOURCES: readonly CorpusSource[] = [
  { id: 'cbsa-d1-4-1-en', authority: 'cbsa', language: 'en', kind: 'cbsa-html', title: 'Memorandum D1-4-1: CBSA Invoice Requirements', url: 'https://www.cbsa-asfc.gc.ca/publications/dm-md/d1/d1-4-1-eng.html' },
  { id: 'cbsa-d1-4-1-fr', authority: 'cbsa', language: 'fr', kind: 'cbsa-html', title: "Mémorandum D1-4-1 : Exigences de l'ASFC relatives aux factures", url: 'https://www.cbsa-asfc.gc.ca/publications/dm-md/d1/d1-4-1-fra.html' },
  { id: 'cfr-19-141-86', authority: 'cbp', language: 'en', kind: 'ecfr', title: '19 CFR 141.86: Contents of invoices and general requirements', query: 'part=141&section=141.86', page: 'https://www.ecfr.gov/current/title-19/chapter-I/part-141/subpart-F/section-141.86' },
  { id: 'cfr-19-149', authority: 'cbp', language: 'en', kind: 'ecfr', title: '19 CFR Part 149: Importer Security Filing', query: 'part=149', page: 'https://www.ecfr.gov/current/title-19/chapter-I/part-149' },
  { id: 'cbsa-d11-3-1-en', authority: 'cbsa', language: 'en', kind: 'cbsa-html', title: 'Memorandum D11-3-1: Marking of Imported Goods', url: 'https://www.cbsa-asfc.gc.ca/publications/dm-md/d11/d11-3-1-eng.html' },
  { id: 'cbsa-d11-3-1-fr', authority: 'cbsa', language: 'fr', kind: 'cbsa-html', title: 'Mémorandum D11-3-1 : Marquage des marchandises importées', url: 'https://www.cbsa-asfc.gc.ca/publications/dm-md/d11/d11-3-1-fra.html' },
  // English only: the French URL (d11-4-2-fra) serves a different memorandum.
  { id: 'cbsa-d11-4-2-en', authority: 'cbsa', language: 'en', kind: 'cbsa-html', title: 'Memorandum D11-4-2: Proof of Origin of Imported Goods', url: 'https://www.cbsa-asfc.gc.ca/publications/dm-md/d11/d11-4-2-eng.html' },
  { id: 'cbsa-d13-4-3-en', authority: 'cbsa', language: 'en', kind: 'cbsa-html', title: 'Memorandum D13-4-3: Customs Valuation: Price Paid or Payable', url: 'https://www.cbsa-asfc.gc.ca/publications/dm-md/d13/d13-4-3-eng.html' },
  { id: 'cbsa-d13-4-7-en', authority: 'cbsa', language: 'en', kind: 'cbsa-html', title: 'Memorandum D13-4-7: Adjustments to the Price Paid or Payable (Customs Act, Section 48)', url: 'https://www.cbsa-asfc.gc.ca/publications/dm-md/d13/d13-4-7-eng.html' },
  { id: 'cbsa-d13-4-7-fr', authority: 'cbsa', language: 'fr', kind: 'cbsa-html', title: 'Mémorandum D13-4-7 : Ajustements au prix payé ou à payer (Loi sur les douanes, article 48)', url: 'https://www.cbsa-asfc.gc.ca/publications/dm-md/d13/d13-4-7-fra.html' },
  { id: 'cfr-19-134', authority: 'cbp', language: 'en', kind: 'ecfr', title: '19 CFR Part 134: Country of Origin Marking', query: 'part=134', page: 'https://www.ecfr.gov/current/title-19/chapter-I/part-134' },
  { id: 'cfr-19-152-e', authority: 'cbp', language: 'en', kind: 'ecfr', title: '19 CFR Part 152 Subpart E: Valuation of Merchandise', query: 'part=152&subpart=E', page: 'https://www.ecfr.gov/current/title-19/chapter-I/part-152/subpart-E' },
  { id: 'cfr-19-141-83', authority: 'cbp', language: 'en', kind: 'ecfr', title: '19 CFR 141.83: Type of invoice required', query: 'part=141&section=141.83', page: 'https://www.ecfr.gov/current/title-19/chapter-I/part-141/subpart-F/section-141.83' },
  { id: 'cfr-19-141-89', authority: 'cbp', language: 'en', kind: 'ecfr', title: '19 CFR 141.89: Additional information for certain classes of merchandise', query: 'part=141&section=141.89', page: 'https://www.ecfr.gov/current/title-19/chapter-I/part-141/subpart-F/section-141.89' },
];

const UA = 'DocCheck-corpus/0.1 (portfolio project; https://github.com/)';

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', sect: '§', eacute: 'é', egrave: 'è', agrave: 'à', ccedil: 'ç', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', ndash: '–', mdash: '—' };
const decode = (s: string) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n: string) => ENTITIES[n.toLowerCase()] ?? m);
const text = (html: string) => decode(html.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

/** CBSA page: the <main> element, headings as ##/###, paragraphs and list items as blocks. */
export function cbsaToMarkdown(html: string): { markdown: string; effectiveDate?: string } {
  const main = html.slice(html.indexOf('<main'), html.indexOf('</main>'));
  const body = main.replace(/<section[^>]*id="wb-dtmd"[\s\S]*?<\/section>/, '').replace(/<div class="pagedetails[\s\S]*$/, '');
  const blocks: string[] = [];
  // Table rows become one line, so "Field 7" stays with its instructions ("7 | Country of origin - ...").
  const re = /<(h[1-4]|p|li|dt|dd|tr)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  for (let m = re.exec(body); m; m = re.exec(body)) {
    const tag = m[1].toLowerCase();
    if (tag === 'tr') {
      const cells = [...m[2].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => text(c[1])).filter(Boolean);
      if (cells.length === 0) continue;
      blocks.push(/^\d+$/.test(cells[0]) ? `Field ${cells[0]}: ${cells.slice(1).join(' — ')}` : cells.join(' — '));
      continue;
    }
    const t = text(m[2]);
    if (!t) continue;
    if (tag === 'h1' || tag === 'h2') blocks.push(`## ${t}`);
    else if (tag === 'h3' || tag === 'h4') blocks.push(`### ${t}`);
    else if (tag === 'li') blocks.push(`- ${t}`);
    else blocks.push(t);
  }
  const modified = html.match(/<meta name="dcterms\.modified"[^>]*content="([^"]+)"/)?.[1];
  return { markdown: blocks.join('\n\n'), effectiveDate: modified };
}

/** eCFR XML: one ## heading per section, paragraphs kept with their (a)(1) labels. */
export function ecfrToMarkdown(xml: string): string {
  const blocks: string[] = [];
  const re = /<HEAD>([\s\S]*?)<\/HEAD>|<P>([\s\S]*?)<\/P>|<CITA[^>]*>([\s\S]*?)<\/CITA>/g;
  for (let m = re.exec(xml); m; m = re.exec(xml)) {
    if (m[1]) {
      const t = text(m[1]);
      blocks.push(t.startsWith('§') ? `## ${t}` : `# ${t}`);
    } else if (m[2]) blocks.push(text(m[2]));
    else if (m[3]) blocks.push(`_Source: ${text(m[3])}_`);
  }
  return blocks.join('\n\n');
}

export const frontMatter = (o: Record<string, string | undefined>) =>
  `---\n${Object.entries(o).filter(([, v]) => v).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('\n')}\n---\n\n`;

async function get(url: string, fetchImpl: typeof fetch): Promise<string> {
  const res = await fetchImpl(url, { headers: { 'user-agent': UA, 'accept-encoding': 'gzip, deflate' } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

export interface FetchedSource {
  source: CorpusSource;
  /** The file data/corpus/<authority>/<id>.md would hold: front matter and Markdown. */
  file: string;
  url: string;
  effectiveDate?: string;
}

/** Downloads every source and converts it, in order; one failing source fails the whole fetch. */
export async function fetchCorpus(sources: readonly CorpusSource[] = CORPUS_SOURCES, fetchImpl: typeof fetch = fetch, today = new Date()): Promise<FetchedSource[]> {
  const titles = JSON.parse(await get('https://www.ecfr.gov/api/versioner/v1/titles.json', fetchImpl)) as { titles: { number: number; up_to_date_as_of: string }[] };
  const ecfrDate = titles.titles.find((t) => t.number === 19)?.up_to_date_as_of;
  if (!ecfrDate) throw new Error('eCFR: no date for title 19');
  const retrievedAt = today.toISOString().slice(0, 10);
  const out: FetchedSource[] = [];
  for (const s of sources) {
    let markdown: string;
    let url: string;
    let effectiveDate: string | undefined;
    if (s.kind === 'cbsa-html') {
      ({ markdown, effectiveDate } = cbsaToMarkdown(await get(s.url!, fetchImpl)));
      url = s.url!;
    } else {
      markdown = ecfrToMarkdown(await get(`https://www.ecfr.gov/api/versioner/v1/full/${ecfrDate}/title-19.xml?${s.query}`, fetchImpl));
      url = s.page!;
      effectiveDate = ecfrDate; // eCFR text current as of this date
    }
    const file = frontMatter({ id: s.id, title: s.title, authority: s.authority.toUpperCase(), language: s.language, url, effectiveDate, retrievedAt }) + markdown + '\n';
    out.push({ source: s, file, url, effectiveDate });
  }
  return out;
}
