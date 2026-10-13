import type { Browser } from 'playwright';
import type { SyntheticShipment } from './generate';
import { renderBillOfLading, renderInvoice, renderPackingList } from './render';
import { isV2Template, renderBillOfLadingV2, renderInvoiceV2, renderPackingListV2 } from './render-v2';

export type PaperDocument = 'invoice' | 'packing-list' | 'bill-of-lading';

export function renderHtml(s: SyntheticShipment): Record<PaperDocument, string> {
  return {
    invoice: (isV2Template(s.render.invoiceTemplate) ? renderInvoiceV2 : renderInvoice)(s.documents.invoice, s.render),
    'packing-list': (isV2Template(s.render.packingListTemplate) ? renderPackingListV2 : renderPackingList)(s.documents.packingList, s.render),
    'bill-of-lading': (isV2Template(s.render.blTemplate) ? renderBillOfLadingV2 : renderBillOfLading)(s.documents.billOfLading, s.render),
  };
}

/**
 * Starts headless Chromium. Falls back to the locally installed Chrome when the Playwright
 * browser build is not downloaded (`npx playwright install chromium` fixes that in CI).
 */
export async function launchBrowser(): Promise<Browser> {
  const { chromium } = await import('playwright');
  try {
    return await chromium.launch();
  } catch {
    return chromium.launch({ channel: 'chrome' });
  }
}

export async function htmlToPdf(browser: Browser, html: string): Promise<Buffer> {
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'load' });
    return await page.pdf({
      format: 'A4',
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: '<div style="font-size:8px;width:100%;text-align:center;color:#555">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>',
    });
  } finally {
    await page.close();
  }
}
