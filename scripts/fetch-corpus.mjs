// Downloads the regulation corpus and converts it to Markdown with front matter:
//   data/corpus/<authority>/<id>.md
// Sources are public government pages. Run again to refresh; the eCFR date is the latest available.
//
//   node scripts/fetch-corpus.mjs
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const OUT = 'data/corpus';
const UA = 'DocCheck-corpus/0.1 (portfolio project; https://github.com/)';

const SOURCES = [
  { id: 'cbsa-d1-4-1-en', authority: 'cbsa', language: 'en', kind: 'cbsa-html', title: 'Memorandum D1-4-1: CBSA Invoice Requirements', url: 'https://www.cbsa-asfc.gc.ca/publications/dm-md/d1/d1-4-1-eng.html' },
  { id: 'cbsa-d1-4-1-fr', authority: 'cbsa', language: 'fr', kind: 'cbsa-html', title: "Mémorandum D1-4-1 : Exigences de l'ASFC relatives aux factures", url: 'https://www.cbsa-asfc.gc.ca/publications/dm-md/d1/d1-4-1-fra.html' },
  { id: 'cfr-19-141-86', authority: 'cbp', language: 'en', kind: 'ecfr', title: '19 CFR 141.86: Contents of invoices and general requirements', query: 'part=141&section=141.86', page: 'https://www.ecfr.gov/current/title-19/chapter-I/part-141/subpart-F/section-141.86' },
  { id: 'cfr-19-149', authority: 'cbp', language: 'en', kind: 'ecfr', title: '19 CFR Part 149: Importer Security Filing', query: 'part=149', page: 'https://www.ecfr.gov/current/title-19/chapter-I/part-149' },
];

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', sect: '§', eacute: 'é', egrave: 'è', agrave: 'à', ccedil: 'ç', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', ndash: '–', mdash: '—' };
const decode = (s) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
const text = (html) => decode(html.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

async function get(url) {
  const res = await fetch(url, { headers: { 'user-agent': UA, 'accept-encoding': 'gzip, deflate' } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

/** CBSA page: the <main> element, headings as ##/###, paragraphs and list items as blocks. */
function cbsaToMarkdown(html) {
  const main = html.slice(html.indexOf('<main'), html.indexOf('</main>'));
  const body = main.replace(/<section[^>]*id="wb-dtmd"[\s\S]*?<\/section>/, '').replace(/<div class="pagedetails[\s\S]*$/, '');
  const blocks = [];
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
function ecfrToMarkdown(xml) {
  const blocks = [];
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

const frontMatter = (o) => `---\n${Object.entries(o).filter(([, v]) => v).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('\n')}\n---\n\n`;

const titles = JSON.parse(await get('https://www.ecfr.gov/api/versioner/v1/titles.json'));
const ecfrDate = titles.titles.find((t) => t.number === 19).up_to_date_as_of;
const retrievedAt = new Date().toISOString().slice(0, 10);

for (const s of SOURCES) {
  let markdown;
  let url;
  let effectiveDate;
  if (s.kind === 'cbsa-html') {
    ({ markdown, effectiveDate } = cbsaToMarkdown(await get(s.url)));
    url = s.url;
  } else {
    markdown = ecfrToMarkdown(await get(`https://www.ecfr.gov/api/versioner/v1/full/${ecfrDate}/title-19.xml?${s.query}`));
    url = s.page;
    effectiveDate = ecfrDate; // eCFR text current as of this date
  }
  const dir = join(OUT, s.authority);
  await mkdir(dir, { recursive: true });
  const file = join(dir, `${s.id}.md`);
  await writeFile(file, frontMatter({ id: s.id, title: s.title, authority: s.authority.toUpperCase(), language: s.language, url, effectiveDate, retrievedAt }) + markdown + '\n');
  console.log(`${file}: ${markdown.length} chars, effective ${effectiveDate}`);
}
