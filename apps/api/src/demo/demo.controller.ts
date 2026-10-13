import { Controller, Get, NotFoundException, Param, Post } from '@nestjs/common';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { ShipmentsService } from '../shipments/shipments.service';

const FILES = ['invoice.pdf', 'packing-list.pdf', 'bill-of-lading.pdf'];

/**
 * Demo helpers over the synthetic evaluation set: list sample shipments with their injected errors,
 * and create a real shipment from one of them (PDFs uploaded and queued like any other upload).
 */
@Controller('demo')
export class DemoController {
  private readonly dir = [process.env.EVAL_DIR, resolve(process.cwd(), 'data/eval/v1'), resolve(__dirname, '../../../../data/eval/v1')].find(
    (d): d is string => !!d && existsSync(join(d, 'manifest.json')),
  );

  constructor(private readonly shipments: ShipmentsService) {}

  @Get('samples')
  async samples() {
    if (!this.dir) return [];
    const manifest = JSON.parse(await readFile(join(this.dir, 'manifest.json'), 'utf8')) as { shipments: { id: string; destination: string; templates: string[] }[] };
    const out = [];
    for (const s of manifest.shipments) {
      if (!FILES.every((f) => existsSync(join(this.dir!, s.id, f)))) continue;
      const labels = JSON.parse(await readFile(join(this.dir, s.id, 'labels.json'), 'utf8')) as { errors: { kind: string; description: string; expectedRuleIds: string[] }[] };
      out.push({ id: s.id, destination: s.destination, templates: s.templates, errors: labels.errors.map((e) => ({ kind: e.kind, description: e.description, expectedRuleIds: e.expectedRuleIds })) });
    }
    return out;
  }

  @Post('samples/:sampleId')
  async load(@Param('sampleId') sampleId: string) {
    if (!this.dir || !/^(CA|US)-\d{3}$/.test(sampleId) || !existsSync(join(this.dir, sampleId))) throw new NotFoundException(`Sample ${sampleId} not found`);
    const shipment = await this.shipments.create({ reference: `Sample ${sampleId}`, destination: sampleId.slice(0, 2) as 'CA' | 'US', transportMode: 'SEA' });
    const files = await Promise.all(FILES.map(async (f) => ({ name: `${sampleId}-${f}`, bytes: await readFile(join(this.dir!, sampleId, f)) })));
    // US samples come with their ISF, which is filed electronically rather than as a PDF.
    const truth = JSON.parse(await readFile(join(this.dir, sampleId, 'truth.json'), 'utf8'));
    if (truth.documents.isf) await this.shipments.saveIsf(shipment.id, truth.documents.isf, 'sample');
    await this.shipments.addDocuments(shipment.id, files);
    return shipment;
  }
}
