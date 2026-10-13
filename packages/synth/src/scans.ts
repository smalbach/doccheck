import type { Browser } from 'playwright';
import { Rng } from './rng';

/** How a page is degraded to look like a scan or a phone photo of a printout. */
export interface ScanStyle {
  /** Degrees; scanners rarely feed paper perfectly straight. */
  rotation: number;
  /** CSS blur in px at 96 dpi. */
  blur: number;
  contrast: number;
  brightness: number;
  /** Opacity of the speckle noise layer. */
  noise: number;
  /** Rendered resolution in dpi: 150 is a typical office scan, 100 a poor fax-like one. */
  dpi: number;
}

export function scanStyle(seed: number): ScanStyle {
  const rng = new Rng(seed);
  const poor = rng.chance(0.3);
  return {
    rotation: (rng.next() - 0.5) * (poor ? 3 : 1.6),
    blur: poor ? 0.4 + rng.next() * 0.4 : rng.next() * 0.35,
    contrast: 0.85 + rng.next() * 0.3,
    brightness: 0.95 + rng.next() * 0.1,
    noise: poor ? 0.12 : 0.05 + rng.next() * 0.05,
    dpi: poor ? 110 : 150,
  };
}

const A4_PX = { width: 794, height: 1123 }; // A4 at 96 dpi

/**
 * Renders the document HTML as images (one per A4 page) with the scan style applied, then wraps
 * them in a PDF that has no text layer, as a scanner would produce.
 */
export async function renderScannedPdf(browser: Browser, html: string, style: ScanStyle): Promise<Buffer> {
  const page = await browser.newPage({ viewport: A4_PX, deviceScaleFactor: style.dpi / 96 });
  try {
    const degrade = `
      <style>
        html { background: #fff; }
        body { padding: 52px 45px !important; margin: 0 !important; transform: rotate(${style.rotation.toFixed(2)}deg); transform-origin: 50% 0;
               filter: grayscale(1) blur(${style.blur.toFixed(2)}px) contrast(${style.contrast.toFixed(2)}) brightness(${style.brightness.toFixed(2)}); }
        #speckle { position: fixed; inset: 0; pointer-events: none; opacity: ${style.noise.toFixed(2)}; mix-blend-mode: multiply; }
      </style>
      <svg id="speckle" xmlns="http://www.w3.org/2000/svg"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="${Math.round(style.rotation * 1000)}"/></filter><rect width="100%" height="100%" filter="url(#n)"/></svg>`;
    await page.setContent(html.replace('</head>', `${degrade}</head>`), { waitUntil: 'load' });
    const height = (await page.evaluate('document.documentElement.scrollHeight')) as number;
    const pages = Math.max(1, Math.ceil(height / A4_PX.height));
    const images: string[] = [];
    for (let i = 0; i < pages; i++) {
      const png = await page.screenshot({ clip: { x: 0, y: i * A4_PX.height, width: A4_PX.width, height: A4_PX.height }, fullPage: true, type: 'jpeg', quality: 70 });
      images.push(png.toString('base64'));
    }
    await page.setContent(
      `<!doctype html><html><head><style>@page { size: A4; margin: 0 } body { margin: 0 } img { display: block; width: 210mm; height: 297mm; page-break-after: always }</style></head>
       <body>${images.map((b) => `<img src="data:image/jpeg;base64,${b}">`).join('')}</body></html>`,
      { waitUntil: 'load' },
    );
    return await page.pdf({ format: 'A4', printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
  } finally {
    await page.close();
  }
}
