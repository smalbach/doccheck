// Sources and converters for the Mexico (ANAM), EU (UCC) and UK (HMRC) parts of the regulation corpus.
// Used by scripts/fetch-corpus.mjs; each converter returns { markdown, url, effectiveDate }.
//
// Mexico: the Reglas Generales de Comercio Exterior as published in the Diario Oficial (dof.gob.mx, the
//   host without "www": the www certificate does not match). Only the rules DocCheck cites are kept. The
//   Ley Aduanera is read from the Cámara de Diputados PDF when that host answers; it is often unreachable,
//   and then the step is skipped and the previous file (if any) is kept.
// EU: EUR-Lex answers scripts with a bot challenge, so the official XHTML comes from the Publications
//   Office (Cellar), which serves the same documents. Reuse: Commission Decision 2011/833/EU, source
//   acknowledged; only the Official Journal text is authentic, consolidated versions are documentation.
// UK: the GOV.UK content API (JSON with the page body as HTML). Open Government Licence v3.0.

const MX_RGCE_2026 = 'https://dof.gob.mx/nota_detalle.php?codigo=5777199&fecha=27/12/2025';
const CELLAR = 'http://publications.europa.eu/resource/celex/';
const EURLEX = 'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:';
const GOVUK = 'https://www.gov.uk';
const CDS = '/government/publications/cds-uk-trade-tariff-volume-3-import-declaration-completion-guide';

export const INTL_SOURCES = [
  {
    id: 'mx-rgce-2026',
    authority: 'anam',
    language: 'es',
    kind: 'dof-rules',
    title: 'Reglas Generales de Comercio Exterior para 2026 (reglas 1.9.19 y 3.1.8)',
    url: MX_RGCE_2026,
    rules: ['1.9.19', '3.1.8'],
    effectiveDate: '2026-01-01',
  },
  {
    id: 'mx-ley-aduanera',
    authority: 'anam',
    language: 'es',
    kind: 'diputados-pdf',
    title: 'Ley Aduanera (artículos 36, 36-A, 54 y 59)',
    url: 'https://www.diputados.gob.mx/LeyesBiblio/pdf/LAdua.pdf',
    articles: ['36', '36-A', '54', '59'],
    optional: true,
  },
  {
    id: 'eu-ucc',
    authority: 'ucc',
    language: 'en',
    kind: 'cellar-articles',
    title: 'Regulation (EU) No 952/2013 laying down the Union Customs Code',
    celex: '02013R0952-20221212',
    articles: ['9', '70', '71', '127'],
  },
  {
    id: 'eu-2015-2446',
    authority: 'ucc',
    language: 'en',
    kind: 'cellar-annex-b',
    title: 'Delegated Regulation (EU) 2015/2446: EORI definition and Annex B common data requirements',
    celex: '02015R2446-20260701',
    definitions: ['18'],
    // Data elements of Annex B, Title II that DocCheck checks on the invoice and for the ICS2 entry summary declaration.
    elements: [
      '13 03 000 000', '13 03 017 000', '13 04 000 000', '13 04 017 000', '13 08 000 000', '13 08 017 000', '13 09 000 000',
      '14 01 000 000', '14 01 035 000', '14 01 036 000', '14 01 037 000', '14 05 000 000', '14 06 000 000', '14 08 000 000',
      '16 08 000 000', '18 05 000 000', '18 09 000 000', '18 09 056 000',
    ],
  },
  {
    id: 'hmrc-cds-group-3',
    authority: 'hmrc',
    language: 'en',
    kind: 'govuk',
    title: 'CDS import declaration completion guide (UK Tariff volume 3): Group 3, Parties',
    path: `${CDS}/group-3-parties`,
    sections: ['DE 3/16', 'DE 3/24', 'DE 3/26'],
  },
  {
    id: 'hmrc-cds-group-4',
    authority: 'hmrc',
    language: 'en',
    kind: 'govuk',
    title: 'CDS import declaration completion guide (UK Tariff volume 3): Group 4, Valuation information and taxes',
    path: `${CDS}/group-4-valuation-information-and-taxes`,
    sections: ['DE 4/1', 'DE 4/10', 'DE 4/11', 'DE 4/14'],
  },
  {
    id: 'hmrc-cds-group-5',
    authority: 'hmrc',
    language: 'en',
    kind: 'govuk',
    title: 'CDS import declaration completion guide (UK Tariff volume 3): Group 5, Dates, places, countries and regions',
    path: `${CDS}/group-5-dates-times-periods-places-countries-and-regions`,
    sections: ['DE 5/15', 'DE 5/16'],
  },
  {
    id: 'hmrc-cds-group-6',
    authority: 'hmrc',
    language: 'en',
    kind: 'govuk',
    title: 'CDS import declaration completion guide (UK Tariff volume 3): Group 6, Goods identification',
    path: `${CDS}/group-6-goods-identification`,
    sections: ['DE 6/8', 'DE 6/14'],
  },
  {
    id: 'hmrc-valuation-method-1',
    authority: 'hmrc',
    language: 'en',
    kind: 'govuk',
    title: 'Valuing imported goods using Method 1 (transaction value)',
    path: '/guidance/valuing-imported-goods-using-method-1-transaction-value',
  },
  {
    id: 'hmrc-eori-introduction',
    authority: 'hmrc',
    language: 'en',
    kind: 'govuk',
    title: 'HMRC EORI manual: introduction',
    path: '/guidance/economic-operators-registration-and-identification-eori/introduction',
  },
  {
    id: 'hmrc-eori-registration',
    authority: 'hmrc',
    language: 'en',
    kind: 'govuk',
    title: 'HMRC EORI manual: registration process',
    path: '/guidance/economic-operators-registration-and-identification-eori/registration-process',
  },
  {
    id: 'hmrc-tca-origin',
    authority: 'hmrc',
    language: 'en',
    kind: 'govuk',
    title: 'Proving originating status and claiming a reduced rate of customs duty for trade between the UK and EU',
    path: '/guidance/proving-originating-status-and-claiming-a-reduced-rate-of-customs-duty-for-trade-between-the-uk-and-eu',
  },
  {
    id: 'tca-annex-7',
    authority: 'hmrc',
    language: 'en',
    kind: 'cellar-text',
    title: 'EU-UK Trade and Cooperation Agreement, Annex 7: Text of the statement on origin',
    celex: '22021A0430(01)',
    start: 'TEXT OF THE STATEMENT ON ORIGIN',
    end: /^ANNEX 8\b/,
  },
];

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', sect: '§', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', ndash: '–', mdash: '—', hellip: '…',
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ', uuml: 'ü', Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Ntilde: 'Ñ',
  egrave: 'è', agrave: 'à', ccedil: 'ç', ordm: 'º', ordf: 'ª', deg: '°', laquo: '«', raquo: '»', iquest: '¿', iexcl: '¡', euro: '€', pound: '£',
};
const decode = (s) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n] ?? ENTITIES[n.toLowerCase()] ?? m);
const text = (html) => decode(html.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

/** Block-level HTML to one line per block: breaks at closing tags, then strips the rest. */
function lines(html) {
  return decode(
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
      .replace(/<\/(p|div|li|tr|h[1-6]|dt|dd|td|th)>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  )
    .split('\n')
    .map((l) => l.replace(/[▼►◄][A-Z]?\d*\s*/g, '').replace(/\s+/g, ' ').trim())
    .filter((l) => l && !/^—+$/.test(l));
}

/** Joins a list label alone on its line ("(a)", "1.", "(ii)") with the line after it. */
function joinLabels(ls) {
  const out = [];
  for (let i = 0; i < ls.length; i++) {
    if (/^(\(\w{1,4}\)|\d{1,2}\.|[a-z]\))$/.test(ls[i]) && i + 1 < ls.length) out.push(`${ls[i]} ${ls[++i]}`);
    else out.push(ls[i]);
  }
  return out;
}

async function get(url, headers = {}) {
  const res = await fetch(url, { headers: { 'user-agent': 'DocCheck-corpus/0.1 (portfolio project; https://github.com/)', ...headers }, signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res;
}

/** DOF note: the rules listed, each as "## Regla N. Title" with its paragraphs and legal basis line. */
async function dofRules(s) {
  const html = await (await get(s.url)).text();
  const start = html.indexOf("id='DivDetalleNota'");
  const body = html.slice(start);
  const blocks = [];
  for (const m of body.matchAll(/<div[^>]*class='(Texto|ROMANOS|INCISO|Normal|ANOTACION)'[^>]*>([\s\S]*?)<\/div>/g)) {
    const t = text(m[2]);
    if (!t) continue;
    const spans = [...m[2].matchAll(/<span style='([^']*)'>([\s\S]*?)<\/span>/g)].filter((x) => text(x[2]));
    blocks.push({ text: t, bold: spans.length > 0 && spans.every((x) => /font-weight:bold/.test(x[1])) });
  }
  const ruleAt = (i) => blocks[i].text.match(/^(\d+\.\d+\.\d+)\.\s/)?.[1];
  const out = [];
  for (const rule of s.rules) {
    const i = blocks.findIndex((_, k) => ruleAt(k) === rule);
    if (i < 0) throw new Error(`Regla ${rule} not found in ${s.url}`);
    let end = blocks.findIndex((_, k) => k > i && ruleAt(k));
    if (end < 0) end = blocks.length;
    if (blocks[end - 1]?.bold) end--; // the next rule's title
    const title = blocks[i - 1]?.bold ? ` ${blocks[i - 1].text}` : '';
    out.push(`## Regla ${rule}.${title}`, ...blocks.slice(i, end).map((b) => b.text));
  }
  return { markdown: out.join('\n\n'), url: s.url, effectiveDate: s.effectiveDate };
}

/** Ley Aduanera PDF from the Cámara de Diputados: the listed articles, read with pdf.js. */
async function diputadosPdf(s) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(await (await get(s.url)).arrayBuffer());
  const pdf = await getDocument({ data, useSystemFonts: true }).promise;
  let all = '';
  for (let p = 1; p <= pdf.numPages; p++) {
    const content = await (await pdf.getPage(p)).getTextContent();
    all += content.items.map((it) => it.str + (it.hasEOL ? '\n' : '')).join('') + '\n';
  }
  const updated = all.match(/Última reforma publicada DOF (\d{2})-(\d{2})-(\d{4})/);
  const out = [];
  for (const art of s.articles) {
    const re = new RegExp(`\\n\\s*ARTICULO ${art.replace('-', '-?')}\\.[\\s\\S]*?(?=\\n\\s*ARTICULO \\d)`, 'i');
    const m = all.match(re);
    if (!m) throw new Error(`Artículo ${art} not found in ${s.url}`);
    const [first, ...rest] = m[0].trim().split(/\n(?=[IVX]+\.|[a-z]\)|\S)/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
    out.push(`## Artículo ${art}`, first, ...rest);
  }
  return { markdown: out.join('\n\n'), url: s.url, effectiveDate: updated ? `${updated[3]}-${updated[2]}-${updated[1]}` : undefined };
}

async function cellar(celex) {
  const res = await get(`${CELLAR}${encodeURIComponent(celex).replace(/\(/g, "%28").replace(/\)/g, "%29")}`, { accept: 'application/xhtml+xml', 'accept-language': 'en' });
  return res.text();
}

/** Consolidated date of a CELEX like 02013R0952-20221212, as YYYY-MM-DD. */
const consolidatedOn = (celex) => celex.match(/-(\d{4})(\d{2})(\d{2})$/)?.slice(1).join('-');
const eurlexUrl = (celex) => `${EURLEX}${celex}`;

/** One article of a consolidated act, from its eli-subdivision to the one of the next article. */
function article(xhtml, n) {
  const id = xhtml.indexOf(`id="art_${n}"`);
  if (id < 0) throw new Error(`Article ${n} not found`);
  const start = xhtml.lastIndexOf('<div', id);
  const next = xhtml.slice(id + 10).search(/id="art_\d+[a-z]?"/);
  return xhtml.slice(start, next < 0 ? undefined : xhtml.lastIndexOf('<div', id + 10 + next));
}

async function cellarArticles(s) {
  const xhtml = await cellar(s.celex);
  const out = [];
  for (const n of s.articles) {
    const [heading, subtitle, ...rest] = joinLabels(lines(article(xhtml, n)));
    out.push(`## ${heading} ${subtitle}`, ...rest);
  }
  return { markdown: out.join('\n\n'), url: eurlexUrl(s.celex), effectiveDate: consolidatedOn(s.celex) };
}

async function cellarAnnexB(s) {
  const xhtml = await cellar(s.celex);
  const out = [];
  const definitions = joinLabels(lines(article(xhtml, '1')));
  out.push('## Article 1 Definitions');
  for (const d of s.definitions) {
    const line = definitions.find((l) => l.startsWith(`(${d})`));
    if (!line) throw new Error(`Definition (${d}) not found in Article 1`);
    out.push(line);
  }
  const annex = xhtml.slice(xhtml.indexOf('id="anx_B"'));
  const heads = [...annex.matchAll(/<p class="title-gr-seq-level-([45])"[^>]*>([\s\S]*?)<\/p>/g)];
  for (const de of s.elements) {
    const k = heads.findIndex((h) => h[1] === '5' && text(h[2]).startsWith(de));
    if (k < 0) throw new Error(`Annex B data element ${de} not found`);
    const from = heads[k].index;
    const to = heads[k + 1]?.index ?? annex.length;
    const [number, name, ...body] = lines(annex.slice(from, to)).map((l) => l.replace(/\*+/g, '').trim()).filter(Boolean);
    // A sub-element is named with its parent, as the Annex does: "Identification number (Importer)".
    const parentNo = `${number.slice(0, 5)} 000 000`;
    const parent = parentNo !== number ? heads.find((h) => text(h[2]).startsWith(parentNo)) : undefined;
    const full = parent ? `${name} (${text(parent[2]).slice(parentNo.length).trim()})` : name;
    // The data element is repeated as the first sentence, so the quoted passage names it.
    out.push(`## Annex B, D.E. ${number} ${full}`, `D.E. ${number} ${full}.`, ...new Set(body));
  }
  return { markdown: out.join('\n\n'), url: eurlexUrl(s.celex), effectiveDate: consolidatedOn(s.celex) };
}

async function cellarText(s) {
  const all = lines(await cellar(s.celex));
  const i = all.findIndex((l) => l.toUpperCase() === s.start);
  if (i < 0) throw new Error(`"${s.start}" not found in ${s.celex}`);
  const j = all.findIndex((l, k) => k > i && s.end.test(l));
  // The language versions are listed by name only in this rendering; the English text follows the list.
  const body = joinLabels(all.slice(i + 1, j < 0 ? i + 60 : j).filter((l) => !/^\w+ version$/.test(l)));
  return { markdown: [`## ${all[i]}`, ...body].join('\n\n'), url: eurlexUrl(s.celex), effectiveDate: '2021-05-01' };
}

/** GOV.UK page body as Markdown: h2 as ##, h3 as ###, paragraphs, list items, table rows; optionally only some h2 sections. */
async function govuk(s) {
  const page = await (await get(`${GOVUK}/api/content${s.path}`)).json();
  const html = page.details.body ?? (page.details.parts ?? []).map((p) => `<h2>${p.title}</h2>${p.body}`).join('');
  const blocks = [];
  for (const m of html.matchAll(/<(h2|h3|h4|p|li|tr)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const tag = m[1].toLowerCase();
    if (tag === 'tr') {
      const cells = [...m[2].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => text(c[1])).filter(Boolean);
      if (cells.length) blocks.push(cells.join(' — '));
      continue;
    }
    // A paragraph inside a list item is its text already.
    if (tag === 'p' && /<\/li>/.test(html.slice(m.index + m[0].length, m.index + m[0].length + 12))) continue;
    const t = text(m[2]);
    if (!t) continue;
    blocks.push(tag === 'h2' ? `## ${t}` : tag === 'h3' || tag === 'h4' ? `### ${t}` : tag === 'li' ? `- ${t}` : t);
  }
  let kept = blocks;
  if (s.sections) {
    // Data element pages: one section per DE, its sub-headings ("All Declaration Categories:", "Notes:")
    // kept as text so every passage stays under the DE it belongs to, which is also repeated as its first line.
    kept = [];
    let keep = false;
    for (const b of blocks) {
      if (b.startsWith('## ')) keep = s.sections.some((sec) => b === `## ${sec}` || b.startsWith(`## ${sec} `));
      if (!keep) continue;
      if (b.startsWith('## ')) kept.push(b, `${b.slice(3)}.`);
      else kept.push(b.replace(/^### /, ''));
    }
    const missing = s.sections.filter((sec) => !kept.some((b) => b === `## ${sec}` || b.startsWith(`## ${sec} `)));
    if (missing.length) throw new Error(`${s.path}: sections not found: ${missing.join(', ')}`);
  }
  return { markdown: kept.join('\n\n'), url: `${GOVUK}${s.path}`, effectiveDate: page.public_updated_at?.slice(0, 10) };
}

const CONVERTERS = { 'dof-rules': dofRules, 'diputados-pdf': diputadosPdf, 'cellar-articles': cellarArticles, 'cellar-annex-b': cellarAnnexB, 'cellar-text': cellarText, govuk };

export const isIntl = (s) => s.kind in CONVERTERS;
export const convertIntl = (s) => CONVERTERS[s.kind](s);
