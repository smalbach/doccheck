// The hero's 3D scene: DocCheck's real pipeline drawn as an isometric draw.io-style diagram, with one
// shipment narrated in the caption while others flow around it.
//
// What it shows matches the code (apps/api, packages/extraction, packages/rules):
//  - Every channel (mailbox, web/desktop/camera, watched folder, REST API, supplier portal) calls the same
//    addDocuments, then the extraction queue.
//  - Each document is read (OCR only for pages without a text layer), split if it is a combined file,
//    classified by keywords (no model), extracted by the LLM (spreadsheets are mapped without one),
//    normalized and scored; low-confidence fields go to the review queue.
//  - Once all of a shipment's documents are in, the shipment is validated as a whole: 53 rules, screening,
//    tariff rules, regulation citations, then the LLM agent only for narrow cases.
//  - Results fire webhooks / Slack / Teams. A finding becomes a templated request sent through the SMTP
//    outbox with a signed portal link; the supplier's upload re-enters intake and re-validates the shipment.
// Everything is a function of time, so reduced motion gets one still frame. Without WebGL or the CDN the
// figure is hidden and the page reads as before.
const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js';

const figure = document.getElementById('flow');

// ---------- Text (Spanish / English, follows <html lang>) ----------
const TEXT = {
  en: {
    nodes: {
      mail: ['Mailbox', 'IMAP intake'], upload: ['Web · desktop', 'upload or camera'], folder: ['Watched folder', 'SFTP · S3 · local'],
      api: ['REST API', 'scoped keys'], portal: ['Supplier portal', 'signed link'], intake: ['Intake', 'format · photo → PDF'],
      queue: ['Extraction queue', 'one job per document'], read: ['Read', 'text layer per page'], ocr: ['OCR', 'pages without text'],
      split: ['Split', 'combined files'], classify: ['Classify', 'keywords, no model'], llm: ['LLM extraction', 'local or cloud'],
      sheet: ['Column mapping', 'spreadsheets, no model'], normalize: ['Normalize', 'confidence per field'], review: ['Field review', 'confidence < 0.85'],
      shipment: ['Shipment', 'waits for every document'], rules: ['53 rules', 'across documents'], screening: ['Screening', 'denied parties'],
      tariff: ['Tariff', 'HS codes'], cite: ['Citations', 'hybrid search'], norms: ['Regulations', 'CBSA · CBP · RGCE'],
      agent: ['LLM agent', 'narrow cases only'], result: ['Findings', 'by severity'], hooks: ['Webhooks', 'Slack · Teams'],
      done: ['Ready', 'export CargoWise · X12'], request: ['Correction request', 'from the findings'], smtp: ['SMTP outbox', 'with portal link'],
    },
    kinds: { invoice: 'Commercial invoice', packing: 'Packing list', bl: 'Bill of lading', isf: 'ISF 10+2', scan: 'Photographed B/L', sheet: 'Packing list (.xlsx)', combined: 'Combined PDF', shipment: 'Shipment', email: 'Correction request', event: 'Event', field: 'Field to review' },
    stage: {
      mail: 'arrives in the organization’s mailbox', upload: 'is uploaded from the web, the desktop app or a phone camera',
      folder: 'appears in a watched folder', api: 'comes in through the REST API', portal: 'the supplier uploads it through the portal',
      intake: 'intake detects the format and stores it', queue: 'waits in the extraction queue', read: 'is read page by page',
      ocr: 'pages with no text layer go through OCR', split: 'a combined file is split into its documents', classify: 'its type is recognized by keywords',
      llm: 'the model copies the values as printed', sheet: 'columns are mapped without a model', normalize: 'values are normalized and scored',
      review: 'a doubtful field goes to the review queue', shipment: 'waits until every document of the shipment is in',
      rules: '53 rules cross-check every document', screening: 'every party is screened', tariff: 'HS codes are checked against the tariff',
      cite: 'each finding gets the regulation behind it', agent: 'the agent looks only at what a rule cannot settle',
      result: 'findings are saved by severity', hooks: 'webhooks and Slack or Teams alerts go out', done: 'clean: ready to file',
      request: 'a correction request is drafted from the findings', smtp: 'the outbox emails it with a signed portal link',
    },
    flag: 'invoice total ≠ sum of lines', fixed: 'corrected', idle: 'Shipments flowing through DocCheck',
  },
  es: {
    nodes: {
      mail: ['Buzón', 'entrada IMAP'], upload: ['Web · escritorio', 'carga o cámara'], folder: ['Carpeta vigilada', 'SFTP · S3 · local'],
      api: ['API REST', 'claves con alcance'], portal: ['Portal del proveedor', 'enlace firmado'], intake: ['Recepción', 'formato · foto → PDF'],
      queue: ['Cola de extracción', 'un trabajo por documento'], read: ['Lectura', 'texto por página'], ocr: ['OCR', 'páginas sin texto'],
      split: ['Separación', 'archivos combinados'], classify: ['Clasificación', 'palabras clave, sin modelo'], llm: ['Extracción LLM', 'local o nube'],
      sheet: ['Mapeo de columnas', 'hojas de cálculo, sin modelo'], normalize: ['Normalización', 'confianza por campo'], review: ['Revisión de campos', 'confianza < 0.85'],
      shipment: ['Embarque', 'espera todos los documentos'], rules: ['53 reglas', 'entre documentos'], screening: ['Screening', 'partes restringidas'],
      tariff: ['Arancel', 'códigos HS'], cite: ['Citas', 'búsqueda híbrida'], norms: ['Normas', 'CBSA · CBP · RGCE'],
      agent: ['Agente LLM', 'solo casos puntuales'], result: ['Hallazgos', 'por severidad'], hooks: ['Webhooks', 'Slack · Teams'],
      done: ['Listo', 'exportar CargoWise · X12'], request: ['Solicitud de corrección', 'desde los hallazgos'], smtp: ['Outbox SMTP', 'con enlace al portal'],
    },
    kinds: { invoice: 'Factura comercial', packing: 'Lista de empaque', bl: 'Conocimiento de embarque', isf: 'ISF 10+2', scan: 'B/L fotografiado', sheet: 'Lista de empaque (.xlsx)', combined: 'PDF combinado', shipment: 'Embarque', email: 'Solicitud de corrección', event: 'Evento', field: 'Campo a revisar' },
    stage: {
      mail: 'llega al buzón de la organización', upload: 'se sube desde la web, la app de escritorio o la cámara del celular',
      folder: 'aparece en una carpeta vigilada', api: 'entra por la API REST', portal: 'el proveedor lo sube por el portal',
      intake: 'recepción detecta el formato y lo guarda', queue: 'espera en la cola de extracción', read: 'se lee página por página',
      ocr: 'las páginas sin capa de texto pasan por OCR', split: 'un archivo combinado se separa en sus documentos', classify: 'se reconoce su tipo por palabras clave',
      llm: 'el modelo copia los valores tal como están impresos', sheet: 'las columnas se mapean sin modelo', normalize: 'los valores se normalizan y se califican',
      review: 'un campo dudoso pasa a la cola de revisión', shipment: 'espera a que lleguen todos los documentos del embarque',
      rules: '53 reglas cruzan todos los documentos', screening: 'cada parte se revisa contra listas restringidas', tariff: 'los códigos HS se verifican contra el arancel',
      cite: 'cada hallazgo recibe la norma que lo respalda', agent: 'el agente mira solo lo que una regla no resuelve',
      result: 'los hallazgos se guardan por severidad', hooks: 'salen los webhooks y alertas de Slack o Teams', done: 'limpio: listo para presentar',
      request: 'se redacta la solicitud de corrección desde los hallazgos', smtp: 'el outbox la envía con un enlace firmado al portal',
    },
    flag: 'total de la factura ≠ suma de líneas', fixed: 'corregida', idle: 'Embarques pasando por DocCheck',
  },
};
const lang = () => (document.documentElement.lang === 'es' ? 'es' : 'en');

// ---------- The graph: two halls (per document, per shipment) and the supplier loop ----------
const NODES = {
  mail: [-15, -5.2, 'src'], upload: [-15, -2.6, 'src'], folder: [-15, 0, 'src'], api: [-15, 2.6, 'src'], portal: [-15, 5.6, 'portal'],
  intake: [-10.8, 0, 'hub'], queue: [-7.2, 0, 'queue'], read: [-3.8, 0, 'tool'], ocr: [-3.8, -3.6, 'tool'],
  split: [-0.4, 0, 'tool'], classify: [3, 0, 'tool'], llm: [6.6, -2, 'llm'], sheet: [6.6, 2, 'tool'],
  normalize: [10.2, 0, 'tool'], review: [10.2, -4, 'warn'], shipment: [14, 0, 'ship'],
  rules: [14, 5.6, 'rules'], screening: [10.4, 6.2, 'tool'], tariff: [6.8, 6.2, 'tool'], cite: [3.2, 6.2, 'tool'], norms: [3.2, 9.8, 'db'],
  agent: [-0.4, 6.2, 'llm'], result: [-4, 6.2, 'hub'], hooks: [-4, 9.8, 'out'], done: [-7.8, 6.2, 'ok'],
  request: [-7.8, 9.8, 'warn'], smtp: [-11.4, 9.8, 'warn'],
};
const EDGES = [
  ['mail', 'intake'], ['upload', 'intake'], ['folder', 'intake'], ['api', 'intake'], ['portal', 'intake'],
  ['intake', 'queue'], ['queue', 'read'], ['read', 'ocr'], ['ocr', 'split'], ['read', 'split'], ['split', 'classify'],
  ['classify', 'llm'], ['classify', 'sheet'], ['llm', 'normalize'], ['sheet', 'normalize'], ['normalize', 'review'], ['normalize', 'shipment'],
  ['shipment', 'rules'], ['rules', 'screening'], ['screening', 'tariff'], ['tariff', 'cite'], ['cite', 'agent'], ['agent', 'result'],
  ['result', 'done'], ['result', 'hooks'], ['result', 'request'], ['request', 'smtp'], ['smtp', 'portal'],
];
const WARM = ['request', 'smtp', 'portal', 'review'];
const LINKS = [['norms', 'cite']];
const DWELL = {
  intake: 0.45, queue: 0.7, read: 0.55, ocr: 1.0, split: 0.5, classify: 0.45, llm: 1.2, sheet: 0.45, normalize: 0.55,
  review: 0.9, rules: 1.0, screening: 0.65, tariff: 0.65, cite: 0.85, agent: 0.95, result: 0.75, done: 0.9, hooks: 0.6,
  request: 0.7, smtp: 0.7, portal: 1.3,
};
const SPEED = 3.6;
const KIND_COLOR = { invoice: '#14b8a6', packing: '#f59e0b', bl: '#94a3b8', isf: '#38bdf8', scan: '#cbd5e1', sheet: '#4ade80', combined: '#a78bfa', shipment: '#2dd4bf', email: '#fbbf24', event: '#60a5fa', field: '#fb923c' };
const KIND_SHORT = { invoice: 'INVOICE', packing: 'PACKING', bl: 'B/L', isf: 'ISF', scan: 'PHOTO', sheet: 'XLSX', combined: 'PDF ×2', shipment: 'SHIPMENT', email: 'EMAIL' };

// Shipments, one every SPACING seconds. The first is the one the camera follows: a photographed B/L that
// needs OCR, an invoice by email and a packing list from a folder; the invoice has a finding, the supplier
// sends a corrected one through the portal and the shipment comes out clean.
const SPACING = 5.2;
const SHIPMENTS = [
  { hero: true, finding: true, docs: [{ kind: 'scan', src: 'upload', ocr: true, review: true, lead: true }, { kind: 'invoice', src: 'mail', delay: 0.6 }, { kind: 'packing', src: 'folder', delay: 1.3 }] },
  { docs: [{ kind: 'combined', src: 'api', fork: ['invoice', 'packing'] }, { kind: 'bl', src: 'api', delay: 0.5 }] },
  { docs: [{ kind: 'sheet', src: 'upload', sheet: true }, { kind: 'invoice', src: 'mail', delay: 0.8 }] },
  { docs: [{ kind: 'invoice', src: 'folder' }, { kind: 'packing', src: 'folder', delay: 0.3 }, { kind: 'isf', src: 'api', delay: 1 }] },
  { finding: true, docs: [{ kind: 'scan', src: 'mail', ocr: true, review: true }, { kind: 'invoice', src: 'mail', delay: 0.4 }] },
  { docs: [{ kind: 'bl', src: 'api' }, { kind: 'invoice', src: 'api', delay: 0.4 }] },
  { docs: [{ kind: 'combined', src: 'folder', fork: ['invoice', 'bl'] }, { kind: 'sheet', src: 'upload', sheet: true, delay: 1.1 }] },
  { docs: [{ kind: 'invoice', src: 'mail' }, { kind: 'packing', src: 'upload', delay: 0.9 }] },
  { docs: [{ kind: 'scan', src: 'upload', ocr: true }, { kind: 'invoice', src: 'folder', delay: 0.7 }] },
  { docs: [{ kind: 'isf', src: 'api' }, { kind: 'bl', src: 'api', delay: 0.5 }, { kind: 'invoice', src: 'mail', delay: 1 }] },
];
const CYCLE = SHIPMENTS.length * SPACING;

// Four named areas, drawn as dashed outlines on the floor.
const ZONES = [
  { id: 'in', x0: -16.8, x1: -9.3, z0: -6.6, z1: 3.6, stroke: '#6c8ebf' },
  { id: 'ext', x0: -9.0, x1: 15.6, z0: -5.8, z1: 2.9, stroke: '#82b366' },
  { id: 'val', x0: -9.2, x1: 15.6, z0: 4.2, z1: 11.4, stroke: '#d79b00' },
  { id: 'sup', x0: -16.8, x1: -9.6, z0: 4.2, z1: 11.4, stroke: '#b85450' },
];
const ZONE_TEXT = {
  en: { in: '1 · Intake', ext: '2 · Extraction, per document', val: '3 · Validation, per shipment', sup: '4 · Supplier' },
  es: { in: '1 · Entrada', ext: '2 · Extracción, por documento', val: '3 · Validación, por embarque', sup: '4 · Proveedor' },
};

// draw.io's palette: a pastel fill with a darker stroke of the same hue.
const PAL = {
  blue: ['#dae8fc', '#6c8ebf'], green: ['#d5e8d4', '#82b366'], orange: ['#ffe6cc', '#d79b00'], yellow: ['#fff2cc', '#d6b656'],
  red: ['#f8cecc', '#b85450'], purple: ['#e1d5e7', '#9673a6'], grey: ['#f5f5f5', '#666666'], white: ['#ffffff', '#666666'], dark: ['#4d4d4d', '#2b2b2b'],
};
const KIND_PAL = { invoice: 'blue', packing: 'orange', bl: 'grey', isf: 'purple', scan: 'white', sheet: 'green', combined: 'purple', shipment: 'orange', email: 'red', event: 'blue', field: 'yellow' };

async function start() {
  if (!figure) return;
  const canvas = figure.querySelector('.flow-scene');
  const labelRoot = figure.querySelector('.flow-labels');
  const caption = figure.querySelector('.flow-caption span');
  let THREE, renderer;
  try {
    THREE = await import(THREE_URL);
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  } catch {
    figure.hidden = true;
    return;
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));

  // ---------- Curves and timing (the same simulation the narration reads) ----------
  const P = (id) => new THREE.Vector3(NODES[id][0], 0, NODES[id][1]);
  const curves = new Map();
  for (const [a, b] of EDGES) {
    const A = P(a), B = P(b);
    const horizontal = Math.abs(B.x - A.x) >= Math.abs(B.z - A.z);
    const d = B.clone().sub(A).multiplyScalar(0.5);
    const bend = horizontal ? new THREE.Vector3(d.x, 0, 0) : new THREE.Vector3(0, 0, d.z);
    const curve = new THREE.CubicBezierCurve3(A, A.clone().add(bend), B.clone().sub(bend), B);
    curves.set(`${a}>${b}`, { a, b, curve, length: curve.getLength(), warm: WARM.includes(b) });
  }
  function walk(kind, route, t, opts = {}) {
    const segs = [];
    route.forEach((n, i) => {
      const dwell = i === 0 ? (opts.firstDwell ?? 0.5) : DWELL[n] ?? 0.4;
      segs.push({ type: 'dwell', node: n, t0: t, t1: t + dwell, index: i });
      t += dwell;
      if (i < route.length - 1) {
        const e = curves.get(`${n}>${route[i + 1]}`);
        const dur = e.length / SPEED;
        segs.push({ type: 'edge', edge: e, t0: t, t1: t + dur, from: n, to: route[i + 1] });
        t += dur;
      }
    });
    return { kind, route, segs, start: segs[0].t0, end: t, ...opts };
  }
  const docRoute = (src, d) => [src, 'intake', 'queue', 'read', ...(d.ocr ? ['ocr'] : []), 'split', 'classify', d.sheet ? 'sheet' : 'llm', 'normalize', 'shipment'];
  const dwellEnd = (inst, node) => inst.segs.find((s) => s.type === 'dwell' && s.node === node).t1;
  const waitUntil = (inst, at) => { inst.end = at; inst.segs[inst.segs.length - 1].t1 = at; inst.waits = true; };
  function expand(recipe, sid) {
    const out = [], docs = [];
    for (const d of recipe.docs) {
      const route = docRoute(d.src, d);
      if (d.fork) {
        const cut = route.indexOf('split');
        const parent = walk(d.kind, route.slice(0, cut + 1), d.delay || 0, { forked: true });
        out.push(parent);
        d.fork.forEach((k, f) => docs.push(walk(k, route.slice(cut), parent.end + f * 0.3, { firstDwell: 0.3 })));
      } else docs.push(walk(d.kind, route, d.delay || 0, { focus: recipe.hero && d.lead }));
      if (d.review) out.push(walk('field', ['normalize', 'review'], dwellEnd(docs[docs.length - 1], 'normalize') - 0.2, { firstDwell: 0.2 }));
    }
    // The shipment is validated once every document is in; until then they wait in it.
    let at = Math.max(...docs.map((d) => d.end)) + 0.25;
    docs.forEach((d, slot) => { waitUntil(d, at); d.slot = slot; });
    out.push(...docs);
    const validate = (finding) => {
      const bundle = walk('shipment', ['shipment', 'rules', 'screening', 'tariff', 'cite', 'agent', 'result', ...(finding ? [] : ['done'])], at, { focus: recipe.hero, count: docs.length, badge: finding ? 'flag' : 'fixed' });
      const resultEnd = dwellEnd(bundle, 'result');
      bundle.badgeAt = resultEnd - 0.35;
      if (finding) bundle.end = resultEnd + 0.4;
      out.push(bundle, walk('event', ['result', 'hooks'], resultEnd - 0.25, { firstDwell: 0.25 }));
      return resultEnd;
    };
    const resultEnd = validate(recipe.finding);
    if (recipe.finding) {
      const mail = walk('email', ['result', 'request', 'smtp', 'portal'], resultEnd, { firstDwell: 0.3, focus: recipe.hero, badge: 'flag', badgeAt: resultEnd });
      const fixed = walk('invoice', ['portal', 'intake', 'queue', 'read', 'split', 'classify', 'llm', 'normalize', 'shipment'], mail.end, { firstDwell: 0.4, focus: recipe.hero, badge: 'fixed', badgeAt: mail.end, slot: 0 });
      at = fixed.end + 0.3;
      waitUntil(fixed, at);
      out.push(mail, fixed);
      validate(false);
    }
    out.forEach((o, i) => { o.id = `${sid}.${i}`; });
    return out;
  }
  const templates = SHIPMENTS.map((s, i) => expand(s, `s${i}`));
  const maxLife = Math.max(...templates.flat().map((d) => d.end));
  function activeDocs(t) {
    const list = [];
    for (let k = Math.max(0, Math.floor((t - maxLife) / SPACING)); k <= Math.floor(t / SPACING); k++) {
      const born = k * SPACING;
      for (const d of templates[k % SHIPMENTS.length]) if (t >= born + d.start && t <= born + d.end) list.push({ ...d, key: `${k}:${d.id}`, born });
    }
    return list;
  }
  const pos = new THREE.Vector3(), dir = new THREE.Vector3(1, 0, 0);
  function locate(doc, t) {
    const local = t - doc.born;
    const seg = doc.segs.find((s) => local >= s.t0 && local <= s.t1) || doc.segs[doc.segs.length - 1];
    if (seg.type === 'dwell') { pos.copy(P(seg.node)); return { seg, k: (local - seg.t0) / (seg.t1 - seg.t0 || 1), local }; }
    const u = Math.min(1, Math.max(0, (local - seg.t0) / (seg.t1 - seg.t0)));
    seg.edge.curve.getPointAt(u, pos);
    seg.edge.curve.getTangentAt(Math.min(u, 0.999), dir);
    return { seg, k: u, local };
  }
  function busyMap(docs, t) {
    const busy = {};
    for (const d of docs) {
      const local = t - d.born;
      for (const s of d.segs) {
        if (s.type !== 'dwell' || (d.waits && s === d.segs[d.segs.length - 1])) continue;
        if (local >= s.t0 - 0.15 && local <= s.t1 + 0.4) busy[s.node] = Math.max(busy[s.node] || 0, local < s.t0 ? 1 - (s.t0 - local) / 0.15 : local > s.t1 ? 1 - (local - s.t1) / 0.4 : 1);
      }
    }
    return busy;
  }

  // ---------- Scene: draw.io-style isometric shapes ----------
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-10, 10, 6, -6, 0.1, 300);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xb8c4c2, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(-4, 10, 6);
  scene.add(sun);

  const fillMats = {}, strokeMats = {};
  const fill = (c) => (fillMats[c] ||= new THREE.MeshLambertMaterial({ color: PAL[c][0] }));
  const stroke = (c) => (strokeMats[c] ||= new THREE.LineBasicMaterial({ color: PAL[c][1] }));
  // A shape with draw.io's outline.
  function solid(parent, geo, c, x = 0, y = 0, z = 0) {
    const m = new THREE.Mesh(geo, fill(c));
    m.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 25), stroke(c)));
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  }
  const box = (p, w, h, d, c, x = 0, y = 0, z = 0) => solid(p, new THREE.BoxGeometry(w, h, d), c, x, y + h / 2, z);
  const cyl = (p, r, h, c, x = 0, y = 0, z = 0, seg = 20) => solid(p, new THREE.CylinderGeometry(r, r, h, seg), c, x, y + h / 2, z);
  const line = (p, pts, c) => { const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts.map(([x, y, z]) => new THREE.Vector3(x, y, z))), stroke(c)); p.add(l); return l; };
  const extrude = (p, shape, depth, c, x = 0, y = 0, z = 0) => solid(p, new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false }), c, x, y, z);
  const shapeOf = (pts) => { const s = new THREE.Shape(); pts.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y))); s.closePath(); return s; };
  // A page lying or standing, with printed lines.
  function page(p, c, x, y, z, rx = -Math.PI / 2, w = 0.6, h = 0.78) {
    const g = new THREE.Group();
    solid(g, new THREE.BoxGeometry(w, h, 0.03), c);
    for (let i = 0; i < 4; i++) line(g, [[-w / 2 + 0.1, h / 2 - 0.18 - i * 0.14, 0.02], [w / 2 - 0.1 - (i % 2) * 0.15, h / 2 - 0.18 - i * 0.14, 0.02]], c);
    g.position.set(x, y, z);
    g.rotation.x = rx;
    p.add(g);
    return g;
  }
  function envelope(p, c, x, y, z, s = 1) {
    const g = new THREE.Group();
    solid(g, new THREE.BoxGeometry(0.7 * s, 0.05, 0.48 * s), c);
    line(g, [[-0.35 * s, 0.03, -0.24 * s], [0, 0.03, 0.04 * s], [0.35 * s, 0.03, -0.24 * s]], c);
    g.position.set(x, y, z);
    p.add(g);
    return g;
  }
  const arrow = (p, c, x, y, z, rotZ = 0) => { const g = new THREE.Group(); cyl(g, 0.05, 0.4, c, 0, -0.2, 0, 8); solid(g, new THREE.ConeGeometry(0.14, 0.25, 12), c, 0, 0.32, 0); g.position.set(x, y, z); g.rotation.z = rotZ; p.add(g); return g; };

  const anim = {};
  const node = (id) => { const g = new THREE.Group(); g.position.copy(P(id)); g.scale.setScalar(1.25); scene.add(g); return g; };
  // Intake channels.
  { const g = node('mail'); box(g, 0.8, 0.9, 0.7, 'blue'); envelope(g, 'white', 0, 0.95, 0); }
  { const g = node('upload'); box(g, 1.0, 0.06, 0.66, 'grey'); const s = box(g, 1.0, 0.64, 0.05, 'blue', 0, 0.06, -0.31); s.rotation.x = -0.2; anim.upload = arrow(g, 'green', 0.0, 0.95, 0.05); }
  { const g = node('folder'); box(g, 0.95, 0.55, 0.7, 'yellow'); box(g, 0.38, 0.1, 0.7, 'yellow', -0.28, 0.55, 0); page(g, 'white', 0.1, 0.62, 0.05, -Math.PI / 2 + 0.25, 0.5, 0.6); }
  { const g = node('api'); box(g, 0.8, 0.8, 0.7, 'blue'); for (const x of [-0.13, 0.13]) box(g, 0.07, 0.22, 0.07, 'grey', x, 0.8, 0); solid(g, new THREE.TorusGeometry(0.2, 0.04, 8, 24, Math.PI), 'grey', 0, 1.0, 0); }
  { const g = node('portal'); cyl(g, 0.08, 0.5, 'grey'); cyl(g, 0.35, 0.06, 'grey'); const globe = solid(g, new THREE.SphereGeometry(0.42, 18, 12), 'blue', 0, 0.95, 0); solid(globe, new THREE.TorusGeometry(0.43, 0.02, 6, 32), 'blue').rotation.x = Math.PI / 2; anim.portal = globe; }
  // Intake: a router that turns its arrow toward the next stage.
  { const g = node('intake'); cyl(g, 0.8, 0.4, 'blue', 0, 0, 0, 32); for (let i = 0; i < 6; i++) box(g, 0.1, 0.08, 0.04, 'dark', -0.3 + i * 0.12, 0.15, 0.79); const pointer = new THREE.Group(); box(pointer, 0.6, 0.08, 0.14, 'green', 0.3, 0, 0); solid(pointer, new THREE.ConeGeometry(0.16, 0.3, 3), 'green', 0.72, 0.04, 0).rotation.z = -Math.PI / 2; pointer.position.y = 0.42; g.add(pointer); anim.intake = pointer; }
  // Queue: stacked trays with papers.
  { const g = node('queue'); const trays = []; for (let i = 0; i < 4; i++) { trays.push(box(g, 0.95, 0.08, 0.7, 'grey', 0, i * 0.24, 0)); page(g, 'white', 0.05, i * 0.24 + 0.1, 0, -Math.PI / 2, 0.5, 0.55); } anim.queue = trays; }
  // Read: a page standing on a reader.
  { const g = node('read'); box(g, 0.95, 0.3, 0.7, 'green'); anim.read = page(g, 'white', 0, 0.75, 0, -0.35); }
  // OCR: a flatbed scanner with a moving light.
  { const g = node('ocr'); box(g, 1.05, 0.3, 0.75, 'green'); const lid = box(g, 1.05, 0.05, 0.75, 'grey', 0, 0, 0); lid.position.set(0, 0.62, -0.38); lid.rotation.x = -1.1; const beam = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, 0.7), new THREE.MeshBasicMaterial({ color: 0xe74c3c })); beam.position.y = 0.31; g.add(beam); anim.ocr = beam; }
  // Split: one file fanning into two.
  { const g = node('split'); box(g, 0.95, 0.25, 0.7, 'green'); const a = page(g, 'white', -0.12, 0.62, 0, -0.3); const b = page(g, 'purple', 0.12, 0.62, 0.02, -0.3); anim.split = [a, b]; }
  // Classify: tags.
  { const g = node('classify'); box(g, 0.95, 0.25, 0.7, 'green'); const tag = shapeOf([[-0.3, -0.16], [0.15, -0.16], [0.3, 0], [0.15, 0.16], [-0.3, 0.16]]); const tags = ['blue', 'orange', 'grey'].map((c, i) => { const m = extrude(g, tag, 0.05, c, 0, 0.3 + i * 0.07, 0.15 - i * 0.12); m.rotation.x = -Math.PI / 2; return m; }); anim.classify = tags; }
  // LLM: a GPU server with a chip and a glowing core.
  { const g = node('llm'); box(g, 1.3, 1.2, 0.85, 'purple'); for (let i = 0; i < 5; i++) box(g, 1.1, 0.05, 0.02, 'dark', 0, 0.2 + i * 0.2, 0.43); box(g, 0.6, 0.1, 0.6, 'dark', 0, 1.2, 0); const core = solid(g, new THREE.IcosahedronGeometry(0.28, 0), 'purple', 0, 1.75, 0); anim.llm = core; }
  // Sheet: a spreadsheet grid.
  { const g = node('sheet'); box(g, 0.95, 0.25, 0.7, 'green'); const grid = box(g, 0.8, 0.05, 0.6, 'white', 0, 0.25, 0); for (let i = 1; i < 4; i++) line(g, [[-0.4, 0.31, -0.3 + i * 0.15], [0.4, 0.31, -0.3 + i * 0.15]], 'green'); for (let i = 1; i < 4; i++) line(g, [[-0.4 + i * 0.2, 0.31, -0.3], [-0.4 + i * 0.2, 0.31, 0.3]], 'green'); anim.sheet = grid; }
  // Normalize: sliders.
  { const g = node('normalize'); box(g, 0.95, 0.25, 0.7, 'green'); anim.normalize = [-0.25, 0, 0.25].map((x) => { cyl(g, 0.025, 0.6, 'grey', x, 0.25, 0, 6); return cyl(g, 0.09, 0.08, 'blue', x, 0.5, 0, 12); }); }
  // Review: a monitor and a magnifier.
  { const g = node('review'); box(g, 0.8, 0.55, 0.06, 'dark', 0, 0.35, 0); box(g, 0.7, 0.45, 0.02, 'yellow', 0, 0.4, 0.04); cyl(g, 0.05, 0.35, 'grey'); const lens = new THREE.Group(); solid(lens, new THREE.TorusGeometry(0.17, 0.04, 8, 24), 'dark'); cyl(lens, 0.03, 0.25, 'dark', 0.15, -0.35, 0, 6).rotation.z = 0.6; lens.position.set(0.35, 0.75, 0.25); g.add(lens); anim.review = lens; }
  // Shipment: a container.
  { const g = node('shipment'); box(g, 1.6, 0.85, 0.85, 'orange'); for (let i = 1; i < 6; i++) line(g, [[-0.8 + i * 0.27, 0.05, 0.43], [-0.8 + i * 0.27, 0.8, 0.43]], 'orange'); }
  // Rules: a clipboard with check marks.
  { const g = node('rules'); box(g, 1.0, 0.2, 0.7, 'orange'); const board = box(g, 0.75, 1.0, 0.05, 'white', 0, 0.2, 0); box(g, 0.3, 0.1, 0.06, 'grey', 0, 1.15, 0); anim.rules = [0, 1, 2].map((i) => { line(g, [[-0.08, 1.0 - i * 0.25, 0.04], [0.28, 1.0 - i * 0.25, 0.04]], 'grey'); return line(g, [[-0.28, 1.0 - i * 0.25, 0.04], [-0.22, 0.95 - i * 0.25, 0.04], [-0.12, 1.06 - i * 0.25, 0.04]], 'green'); }); anim.rulesBoard = board; }
  // Screening: a shield.
  { const g = node('screening'); box(g, 0.9, 0.2, 0.6, 'orange'); const s = shapeOf([[0, 0.55], [0.38, 0.42], [0.34, 0.05], [0, -0.3], [-0.34, 0.05], [-0.38, 0.42]]); const shield = extrude(g, s, 0.12, 'yellow', 0, 0.55, -0.06); anim.screening = shield; }
  // Tariff: a balance scale.
  { const g = node('tariff'); box(g, 0.8, 0.1, 0.5, 'orange'); cyl(g, 0.05, 0.9, 'grey', 0, 0.1, 0, 8); const beam = new THREE.Group(); beam.position.y = 1.0; g.add(beam); box(beam, 1.0, 0.05, 0.06, 'grey', 0, -0.025, 0); for (const x of [-0.45, 0.45]) { line(beam, [[x, 0, 0], [x, -0.3, 0]], 'grey'); cyl(beam, 0.17, 0.04, 'yellow', x, -0.34, 0); } anim.tariff = beam; }
  // Citations: an open book. Regulations: a stack of books.
  { const g = node('cite'); box(g, 0.9, 0.15, 0.65, 'blue'); for (const s of [-1, 1]) { const leaf = box(g, 0.42, 0.04, 0.6, 'white', s * 0.21, 0.15, 0); leaf.rotation.z = -s * 0.18; } }
  { const g = node('norms'); ['blue', 'red', 'green', 'yellow'].forEach((c, i) => { const b = box(g, 0.9 - i * 0.06, 0.18, 0.62, c, 0, i * 0.18, 0); b.rotation.y = (i % 2 ? 0.12 : -0.08); }); }
  // Agent: a small robot.
  { const g = node('agent'); box(g, 0.8, 0.45, 0.6, 'purple'); const head = new THREE.Group(); head.position.y = 0.45; g.add(head); box(head, 0.6, 0.45, 0.5, 'purple'); for (const x of [-0.13, 0.13]) solid(head, new THREE.SphereGeometry(0.06, 10, 8), 'white', x, 0.25, 0.26); cyl(head, 0.02, 0.25, 'grey', 0, 0.45, 0, 6); solid(head, new THREE.SphereGeometry(0.06, 10, 8), 'red', 0, 0.75, 0); anim.agent = head; }
  // Findings: a board with severity bars.
  { const g = node('result'); box(g, 1.0, 0.2, 0.6, 'yellow'); box(g, 0.85, 0.8, 0.05, 'white', 0, 0.2, 0); anim.result = ['red', 'orange', 'green', 'green'].map((c, i) => box(g, 0.55 - i * 0.08, 0.1, 0.03, c, -0.08 + i * 0.04, 0.82 - i * 0.17, 0.04)); }
  // Webhooks: a lightning bolt.
  { const g = node('hooks'); box(g, 0.8, 0.2, 0.6, 'blue'); const bolt = extrude(g, shapeOf([[0.05, 0.6], [-0.25, 0.05], [-0.02, 0.05], [-0.1, -0.4], [0.25, 0.18], [0.02, 0.18]]), 0.1, 'yellow', 0, 0.65, -0.05); anim.hooks = bolt; }
  // Ready: a truck.
  { const g = node('done'); box(g, 1.1, 0.7, 0.7, 'green', 0.2, 0.12, 0); box(g, 0.4, 0.5, 0.66, 'grey', -0.6, 0.12, 0); for (const x of [-0.55, 0.0, 0.5]) for (const z of [-0.35, 0.35]) cyl(g, 0.13, 0.08, 'dark', x, 0.13, z, 14).rotation.x = Math.PI / 2; }
  // Correction request: a page and a pencil. SMTP outbox: a server sending a paper plane.
  { const g = node('request'); box(g, 0.9, 0.15, 0.65, 'red'); page(g, 'white', 0, 0.18, 0, -Math.PI / 2, 0.55, 0.62); const pencil = new THREE.Group(); cyl(pencil, 0.04, 0.5, 'yellow', 0, 0, 0, 8); solid(pencil, new THREE.ConeGeometry(0.04, 0.1, 8), 'dark', 0, 0.55, 0); pencil.position.set(0.1, 0.3, 0.05); pencil.rotation.z = -1.0; g.add(pencil); anim.request = pencil; }
  { const g = node('smtp'); box(g, 0.8, 0.8, 0.7, 'red'); for (let i = 0; i < 3; i++) box(g, 0.6, 0.04, 0.02, 'dark', 0, 0.2 + i * 0.18, 0.36); const plane = extrude(g, shapeOf([[0, 0], [0.55, 0.18], [0.12, 0.3]]), 0.04, 'white', -0.2, 1.0, 0); plane.rotation.x = -Math.PI / 2; anim.smtp = plane; }

  // Zones: dashed outlines on the floor.
  const zoneLines = [];
  for (const z of ZONES) {
    const pts = [[z.x0, z.z0], [z.x1, z.z0], [z.x1, z.z1], [z.x0, z.z1], [z.x0, z.z0]].map(([x, zz]) => new THREE.Vector3(x, 0, zz));
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ color: z.stroke, dashSize: 0.35, gapSize: 0.25 }));
    l.computeLineDistances();
    scene.add(l);
    zoneLines.push(l);
  }

  // Connectors with draw.io's "flow animation": dashes that move toward the arrowhead.
  const dashes = document.createElement('canvas');
  dashes.width = 32; dashes.height = 4;
  { const g = dashes.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 18, 4); }
  const connectors = [];
  for (const e of curves.values()) {
    const c = e.curve;
    const lift = (v) => v.clone().setY(0.08);
    const path = new THREE.CubicBezierCurve3(lift(c.v0), lift(c.v1), lift(c.v2), lift(c.v3));
    const t = new THREE.CanvasTexture(dashes);
    t.wrapS = THREE.RepeatWrapping;
    t.repeat.set(Math.round(e.length * 3), 1);
    const mat = new THREE.MeshBasicMaterial({ map: t, color: e.warm ? PAL.red[1] : PAL.blue[1], transparent: true, depthWrite: false });
    scene.add(new THREE.Mesh(new THREE.TubeGeometry(path, Math.ceil(e.length * 8), 0.035, 6, false), mat));
    // Arrowhead just before the target shape.
    const u = Math.max(0, 1 - 0.85 / e.length);
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.26, 10), new THREE.MeshBasicMaterial({ color: mat.color }));
    head.position.copy(path.getPointAt(u));
    head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), path.getTangentAt(u));
    scene.add(head);
    connectors.push({ e, t, mat });
  }
  for (const [a, b] of LINKS) {
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([P(a).setY(0.3), P(b).setY(0.3)]), new THREE.LineDashedMaterial({ color: PAL.blue[1], dashSize: 0.15, gapSize: 0.12 }));
    l.computeLineDistances();
    scene.add(l);
  }

  // ---------- Travelling things: documents, shipments, emails, events ----------
  const texOf = (c) => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; };
  function badge(type) {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = type === 'flag' ? '#d79b00' : '#82b366'; g.beginPath(); g.arc(64, 64, 56, 0, 7); g.fill();
    g.strokeStyle = g.fillStyle = '#fff'; g.lineWidth = 15; g.lineCap = g.lineJoin = 'round';
    if (type === 'flag') { g.beginPath(); g.moveTo(64, 30); g.lineTo(64, 72); g.stroke(); g.beginPath(); g.arc(64, 96, 9, 0, 7); g.fill(); }
    else { g.beginPath(); g.moveTo(36, 66); g.lineTo(56, 86); g.lineTo(94, 44); g.stroke(); }
    return texOf(c);
  }
  const BADGE = { flag: badge('flag'), fixed: badge('fixed') };
  function makeThing(kind) {
    const g = new THREE.Group();
    const c = KIND_PAL[kind];
    if (kind === 'event' || kind === 'field') solid(g, new THREE.SphereGeometry(0.13, 12, 8), c);
    else if (kind === 'email') envelope(g, 'red', 0, 0, 0, 0.9);
    else {
      const sheets = kind === 'shipment' ? 3 : kind === 'combined' ? 2 : 1;
      for (let i = 0; i < sheets; i++) page(g, c, i * 0.06, i * 0.06, -i * 0.04, -Math.PI / 2, 0.5, 0.64);
    }
    const b = new THREE.Sprite(new THREE.SpriteMaterial({ map: BADGE.flag, depthTest: false }));
    b.scale.setScalar(0.4); b.position.set(0.3, 0.45, -0.2); b.renderOrder = 3; b.visible = false;
    g.add(b);
    g.userData = { kind, badge: b };
    scene.add(g);
    return g;
  }
  // The shipment the caption follows wears a ring.
  const ringCanvas = document.createElement('canvas'); ringCanvas.width = ringCanvas.height = 128;
  { const g = ringCanvas.getContext('2d'); g.strokeStyle = '#fff'; g.lineWidth = 9; g.beginPath(); g.arc(64, 64, 52, 0, 7); g.stroke(); }
  const marker = new THREE.Sprite(new THREE.SpriteMaterial({ map: texOf(ringCanvas), depthTest: false, transparent: true }));
  marker.renderOrder = 10;
  scene.add(marker);

  const focus = { alive: false, inst: null, seg: null, pos: new THREE.Vector3() };
  const pool = new Map(), free = {};
  function sync(docs, t) {
    const seen = new Set();
    let best = null;
    for (const d of docs) {
      seen.add(d.key);
      let o = pool.get(d.key);
      if (!o) { o = free[d.kind]?.pop() || makeThing(d.kind); o.visible = true; pool.set(d.key, o); }
      const { seg, k, local } = locate(d, t);
      o.position.set(pos.x, 0.4, pos.z);
      o.rotation.set(0, seg.type === 'edge' ? Math.atan2(dir.x, dir.z) : 0, 0);
      let s = 1;
      if (seg.type === 'dwell') {
        const first = seg.index === 0, last = seg === d.segs[d.segs.length - 1];
        if (d.waits && last) { o.position.y = 1.0 + (d.slot || 0) * 0.1; o.position.x += 0.2 - (d.slot || 0) * 0.12; s = 0.85 * Math.min(1, (seg.t1 - local) / 0.3, k * 4 + 0.2); }
        else if (first) { o.position.y = 0.4 + (1 - Math.min(1, k * 2)) * 1.2; s = Math.min(1, k * 2); }
        else if (last) s = 1 - k;
        else if (!['intake', 'queue', 'result'].includes(seg.node)) { s = 0.25 + Math.abs(k - 0.5) * 1.5; o.position.y = 0.9; }
        else o.position.y = 0.9;
      }
      o.scale.setScalar(Math.max(s, 0.001));
      const b = o.userData.badge;
      b.visible = !!d.badge && local >= (d.badgeAt ?? 0);
      if (b.visible) b.material.map = BADGE[d.badge];
      if (d.focus && (!best || d.born < best.d.born || (d.born === best.d.born && d.start > best.d.start))) best = { d, o, seg };
    }
    for (const [key, o] of pool) {
      if (seen.has(key)) continue;
      o.visible = false;
      (free[o.userData.kind] ||= []).push(o);
      pool.delete(key);
    }
    focus.alive = !!best;
    if (best) { focus.inst = best.d; focus.seg = best.seg; focus.pos.copy(best.o.position); }
  }

  // ---------- Fixed labels, zone titles, caption ----------
  const labels = {}, zoneEls = {};
  function buildLabels() {
    labelRoot.textContent = '';
    for (const z of ZONES) {
      const el = document.createElement('div');
      el.className = `flow-zone flow-zone-${z.id}`;
      el.textContent = ZONE_TEXT[lang()][z.id];
      labelRoot.appendChild(el);
      zoneEls[z.id] = el;
    }
    for (const id of Object.keys(NODES)) {
      const [name, sub] = TEXT[lang()].nodes[id];
      const el = document.createElement('div');
      el.className = 'flow-label';
      el.append(Object.assign(document.createElement('b'), { textContent: name }), Object.assign(document.createElement('span'), { textContent: sub }));
      labelRoot.appendChild(el);
      labels[id] = el;
    }
  }
  let lastCaption = '';
  buildLabels();
  new MutationObserver(() => { buildLabels(); lastCaption = ''; layout(); run(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
  const v = new THREE.Vector3();
  const toScreen = (x, y, z) => { v.set(x, y, z).project(camera); return [((v.x + 1) / 2) * size.w, ((1 - v.y) / 2) * size.h]; };
  // Labels sit just in front of each shape and only move when the frame is resized.
  function layout() {
    for (const [id, el] of Object.entries(labels)) {
      const [x, z] = NODES[id];
      const [sx, sy] = toScreen(x, 0, z + 0.95);
      el.style.transform = `translate(${sx}px, ${sy}px) translate(-50%, 0)`;
    }
    for (const z of ZONES) {
      // The supplier's title goes under its outline, clear of the intake labels above it.
      const below = z.id === 'sup';
      const [sx, sy] = toScreen(z.x0 + 0.2, 0, below ? z.z1 : z.z0);
      zoneEls[z.id].style.transform = `translate(${sx}px, ${sy}px) translate(0, ${below ? '10%' : '-110%'})`;
    }
  }
  function setCaption() {
    const T = TEXT[lang()];
    let parts = [T.idle];
    if (focus.alive) {
      const d = focus.inst, seg = focus.seg;
      const at = seg.type === 'dwell' ? seg.node : seg.to;
      const name = d.kind === 'shipment' ? `${T.kinds.shipment} · ${d.count} docs` : T.kinds[d.kind];
      const note = d.badge === 'flag' && (d.kind === 'email' || at === 'result') ? T.flag : d.badge === 'fixed' && d.kind !== 'shipment' ? T.fixed : '';
      parts = [name, `${seg.type === 'edge' ? '→ ' : ''}${T.stage[at]}`, note];
    }
    const key = parts.join('|');
    if (key === lastCaption) return;
    lastCaption = key;
    caption.textContent = '';
    if (parts.length === 1) { caption.textContent = parts[0]; return; }
    caption.append(Object.assign(document.createElement('b'), { textContent: parts[0] }), ` — ${parts[1]}`);
    if (parts[2]) caption.append(' ', Object.assign(document.createElement('small'), { textContent: `(${parts[2]})` }));
  }

  // ---------- Theme, camera, loop ----------
  function applyTheme() {
    const css = getComputedStyle(document.documentElement);
    marker.material.color.set(css.getPropertyValue('--brand').trim() || '#0f766e');
  }
  applyTheme();
  new MutationObserver(applyTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

  const target = new THREE.Vector3(-0.6, 0, 2.4);
  const view = new THREE.Vector3(0, 0.9, 0.68).normalize();
  const bounds = new THREE.Box3(new THREE.Vector3(-17, 0, -7.6), new THREE.Vector3(16, 2.2, 12.6));
  let size = { w: 1, h: 1 };
  function frameAll() {
    camera.position.copy(target).addScaledVector(view, 80);
    camera.lookAt(target);
    camera.updateMatrixWorld();
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    const p = new THREE.Vector3();
    for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
      p.set(x, y, z).applyMatrix4(camera.matrixWorldInverse);
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
    }
    const aspect = size.w / size.h;
    let hw = (x1 - x0) / 2 * 1.02, hh = (y1 - y0) / 2 * 1.02;
    if (hw / hh > aspect) hh = hw / aspect; else hw = hh * aspect;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    Object.assign(camera, { left: cx - hw, right: cx + hw, top: cy + hh, bottom: cy - hh });
    camera.updateProjectionMatrix();
  }
  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    size = { w, h };
    renderer.setSize(w, h, false);
    frameAll();
    layout();
    run();
  }

  function frame(t, clock) {
    const docs = activeDocs(t);
    sync(docs, t);
    const busy = busyMap(docs, t);
    const b = (id) => busy[id] || 0;
    for (const c of connectors) c.t.offset.x = -clock * 1.6;
    for (const l of Object.values(labels)) l.classList.remove('on');
    for (const [id, val] of Object.entries(busy)) if (val > 0.5 && labels[id]) labels[id].classList.add('on');

    // Each shape moves a little while its stage works.
    anim.upload.position.y = 0.95 + Math.sin(clock * 3) * 0.06 + b('upload') * 0.2;
    anim.portal.rotation.y = clock * (0.3 + b('portal') * 2);
    if (focus.alive && focus.seg.type === 'edge' && focus.seg.from === 'intake') {
      const n = NODES[focus.seg.to], o = NODES.intake;
      anim.intake.rotation.y += (Math.atan2(-(n[1] - o[1]), n[0] - o[0]) - anim.intake.rotation.y) * 0.15;
    } else anim.intake.rotation.y += (0 - anim.intake.rotation.y) * 0.05;
    anim.queue.forEach((tr, i) => { tr.position.x = Math.sin(clock * 3 + i) * 0.05 * b('queue'); });
    anim.read.rotation.x = -0.35 - Math.sin(clock * 4) * 0.1 * b('read');
    anim.ocr.visible = b('ocr') > 0.05; anim.ocr.position.x = Math.sin(clock * 5) * 0.45;
    anim.split[0].rotation.z = 0.35 * b('split'); anim.split[1].rotation.z = -0.35 * b('split');
    anim.classify.forEach((tg, i) => { tg.position.x = (Math.floor(clock * 4) % 3 === i ? 0.12 : 0) * b('classify'); });
    anim.llm.rotation.y = clock * (0.5 + b('llm') * 4); anim.llm.position.y = 1.75 + Math.sin(clock * 2) * 0.06; anim.llm.scale.setScalar(1 + b('llm') * 0.3);
    anim.sheet.position.y = 0.25 + b('sheet') * 0.08;
    anim.normalize.forEach((k, i) => { k.position.y = 0.5 + Math.sin(clock * (2 + i) + i) * 0.2 * (0.3 + b('normalize')); });
    anim.review.position.x = 0.35 + Math.sin(clock * 2) * 0.12 * (0.3 + b('review'));
    anim.rules.forEach((chk, i) => { chk.visible = b('rules') < 0.2 || Math.floor(clock * 5) % 4 > i; });
    anim.screening.rotation.y = Math.sin(clock * 6) * 0.3 * b('screening');
    anim.tariff.rotation.z = Math.sin(clock * 3) * 0.2 * (0.2 + b('tariff'));
    anim.agent.rotation.y = Math.sin(clock * 2) * (0.2 + b('agent') * 0.6);
    anim.result.forEach((bar, i) => { bar.scale.x = 1 - b('result') * 0.4 * ((Math.floor(clock * 6) + i) % 2); });
    anim.hooks.scale.setScalar(1 + b('hooks') * 0.35);
    anim.request.rotation.z = -1.0 + Math.sin(clock * 8) * 0.2 * b('request');
    anim.smtp.position.x = -0.2 + b('smtp') * 0.5; anim.smtp.position.y = 1.0 + b('smtp') * 0.4;

    marker.visible = focus.alive;
    if (focus.alive) { marker.position.copy(focus.pos); marker.position.y += 0.2; marker.scale.setScalar(1.25 + Math.sin(clock * 5) * 0.08); }
    setCaption();
    renderer.render(scene, camera);
  }

  const still = matchMedia('(prefers-reduced-motion: reduce)');
  const START = CYCLE * 2 + 0.1; // earlier shipments are already in flight when the page opens
  let visible = true, raf = 0, last = performance.now(), clock = 0;
  function tick(now) {
    raf = 0;
    clock += Math.min((now - last) / 1000, 0.1);
    last = now;
    frame(START + clock, clock);
    if (visible && !still.matches) raf = requestAnimationFrame(tick);
  }
  function run() {
    if (still.matches) { frame(START + 9.5, 0); return; }
    if (visible && !raf) { last = performance.now(); raf = requestAnimationFrame(tick); }
  }
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; run(); }).observe(figure);
  new ResizeObserver(resize).observe(canvas);
  still.addEventListener('change', run);
  resize();
  figure.classList.add('ready');
  run();
}

start();
