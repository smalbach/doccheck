import { createCanvas } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';
import { detectAttestation } from './attestation';
import { jpegToPdf } from './image';
import type { PdfText } from './pdf-text';

/** An A4 page drawn at 144 dpi (2 px per point) with a signature block at (320, 700) points. */
async function page({ signature = false, stamp = false, logo = false }) {
  const c = createCanvas(1190, 1684);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, 1190, 1684);
  ctx.fillStyle = '#111';
  ctx.font = '20px sans-serif';
  ctx.fillText('Signature of carrier or agent', 640, 1440);
  ctx.fillRect(640, 1450, 400, 2); // the line to sign on
  ctx.fillRect(80, 200, 1030, 2); // a table border
  if (logo) {
    ctx.fillStyle = '#c0262d';
    ctx.beginPath();
    ctx.arc(150, 110, 50, 0, Math.PI * 2);
    ctx.fill();
  }
  if (signature) {
    ctx.strokeStyle = '#1b2a6b';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(660, 1420);
    ctx.bezierCurveTo(700, 1340, 740, 1460, 790, 1390);
    ctx.bezierCurveTo(830, 1340, 860, 1450, 920, 1380);
    ctx.bezierCurveTo(950, 1350, 990, 1420, 1010, 1400);
    ctx.stroke();
  }
  if (stamp) {
    ctx.strokeStyle = 'rgba(176, 30, 60, 0.85)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(960, 1500, 70, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(960, 1500, 52, 0, Math.PI * 2);
    ctx.stroke();
  }
  const pdf = jpegToPdf(await c.encode('jpeg', 95), 1190, 1684, 595);
  const text: PdfText = { pageCount: 1, lines: [{ page: 1, text: 'Signature of carrier or agent', bbox: [320, 708, 560, 722] }], text: '' };
  return { pdf, text };
}

describe('signature and stamp', () => {
  it('finds a signature and a stamp in the signature block', async () => {
    const { pdf, text } = await page({ signature: true, stamp: true });
    expect(await detectAttestation(pdf, text)).toMatchObject({ signature: true, stamp: true, page: 1, signatureBlock: true });
  });

  it('finds a signature alone, in blue ink, without calling it a stamp', async () => {
    const { pdf, text } = await page({ signature: true });
    expect(await detectAttestation(pdf, text)).toMatchObject({ signature: true, stamp: false });
  });

  it('finds neither on a blank signature line, and ignores a coloured logo away from it', async () => {
    const { pdf, text } = await page({ logo: true });
    expect(await detectAttestation(pdf, text)).toMatchObject({ signature: false, stamp: false, signatureBlock: true });
  });
});
