import { Controller, Get, NotFoundException, Param, Post, type OnApplicationBootstrap } from '@nestjs/common';
import { extractionRequest, PROMPT_VERSION, readPdfText, type ExtractableType, type LlmClient } from '@doccheck/extraction';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { PublicUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/current-user.decorator';
import { InjectLlm } from '../llm/llm.module';
import { ShipmentsService } from '../shipments/shipments.service';
import { isDemo } from './demo-mode';

const FILES = ['invoice.pdf', 'packing-list.pdf', 'bill-of-lading.pdf'];
const TYPES: Record<string, ExtractableType> = { 'invoice.pdf': 'COMMERCIAL_INVOICE', 'packing-list.pdf': 'PACKING_LIST', 'bill-of-lading.pdf': 'BILL_OF_LADING' };

/**
 * Demo helpers over the synthetic evaluation set: list sample shipments with their injected errors,
 * and create a real shipment from one of them (PDFs uploaded and queued like any other upload).
 * The read-only demo reads the curated samples in data/demo (scripts/demo-build.mjs), lists only
 * those whose extraction is cached, and reuses the user's shipment for a sample instead of creating a new one.
 */
@Controller('demo')
export class DemoController implements OnApplicationBootstrap {
  private readonly dir = [process.env.EVAL_DIR, ...(isDemo() ? ['data/demo'] : ['data/eval/v1']).flatMap((d) => [resolve(process.cwd(), d), resolve(__dirname, '../../../..', d)])].find(
    (d): d is string => !!d && existsSync(join(d, 'manifest.json')),
  );
  private readonly cached = new Map<string, Promise<boolean>>();
  private readonly loading = new Map<string, Promise<{ id: string }>>();

  constructor(
    private readonly shipments: ShipmentsService,
    @InjectLlm() private readonly llm: LlmClient,
  ) {}

  /** The demo checks the cache for every sample once; do it at start rather than on the first visit. */
  onApplicationBootstrap() {
    if (isDemo()) void this.samples().catch(() => undefined);
  }

  /** Whether the model's answers for all three PDFs of a sample are in the cache (demo only). */
  private extractionCached(sampleId: string): Promise<boolean> {
    if (!isDemo()) return Promise.resolve(true);
    let hit = this.cached.get(sampleId);
    if (!hit) {
      hit = Promise.all(
        FILES.map(async (f) => this.llm.isCached(PROMPT_VERSION, extractionRequest(await readPdfText(await readFile(join(this.dir!, sampleId, f)), { ocr: 'off' }), TYPES[f]))),
      ).then((all) => all.every(Boolean), () => false);
      this.cached.set(sampleId, hit);
    }
    return hit;
  }

  @Get('samples')
  async samples() {
    if (!this.dir) return [];
    const manifest = JSON.parse(await readFile(join(this.dir, 'manifest.json'), 'utf8')) as { shipments: { id: string; destination: string; templates: string[] }[] };
    const out = [];
    for (const s of manifest.shipments) {
      if (!FILES.every((f) => existsSync(join(this.dir!, s.id, f))) || !(await this.extractionCached(s.id))) continue;
      const labels = JSON.parse(await readFile(join(this.dir, s.id, 'labels.json'), 'utf8')) as { errors: { kind: string; description: string; expectedRuleIds: string[] }[] };
      out.push({ id: s.id, destination: s.destination, templates: s.templates, errors: labels.errors.map((e) => ({ kind: e.kind, description: e.description, expectedRuleIds: e.expectedRuleIds })) });
    }
    return out;
  }

  @Post('samples/:sampleId')
  async load(@CurrentUser() user: PublicUser, @Param('sampleId') sampleId: string) {
    if (!this.dir || !/^(CA|US)-\d{3}$/.test(sampleId) || !existsSync(join(this.dir, sampleId)) || !(await this.extractionCached(sampleId))) throw new NotFoundException(`Sample ${sampleId} not found`);
    if (!isDemo()) return this.create(sampleId, user.id);
    // Each user gets one shipment per sample (shipments are private), so the demo database grows by
    // at most users x samples.
    const key = `${user.id}:${sampleId}`;
    let pending = this.loading.get(key);
    if (!pending) {
      pending = this.shipments
        .list(user.id)
        .then(async (all): Promise<{ id: string }> => all.find((s) => s.reference === `Sample ${sampleId}`) ?? this.create(sampleId, user.id))
        .finally(() => this.loading.delete(key));
      this.loading.set(key, pending);
    }
    return pending;
  }

  private async create(sampleId: string, userId: string) {
    const shipment = await this.shipments.create({ reference: `Sample ${sampleId}`, destination: sampleId.slice(0, 2) as 'CA' | 'US', transportMode: 'SEA' }, userId);
    const files = await Promise.all(FILES.map(async (f) => ({ name: `${sampleId}-${f}`, bytes: await readFile(join(this.dir!, sampleId, f)) })));
    // US samples come with their ISF, which is filed electronically rather than as a PDF.
    const truth = JSON.parse(await readFile(join(this.dir!, sampleId, 'truth.json'), 'utf8'));
    if (truth.documents.isf) await this.shipments.saveIsf(shipment.id, truth.documents.isf, 'sample');
    await this.shipments.addDocuments(shipment.id, files);
    return shipment;
  }
}
