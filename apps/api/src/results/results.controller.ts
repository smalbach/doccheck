import { Controller, Get, Logger } from '@nestjs/common';
import type { LlmClient } from '@doccheck/extraction';
import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { InjectLlm } from '../llm/llm.module';
import { NoOrg } from '../orgs/permissions';

interface Tally {
  total: number;
  correct: number;
  accuracy: number;
}

/**
 * Evaluation results for the web app's results page, read from eval/reports (written by
 * npm run eval:extraction and npm run eval:agent). Only summaries are returned, never the
 * per-document detail.
 */
@NoOrg()
@Controller('results')
export class ResultsController {
  private readonly logger = new Logger(ResultsController.name);
  private readonly dir = [process.env.REPORTS_DIR, resolve(process.cwd(), 'eval/reports'), resolve(__dirname, '../../../../eval/reports')].find(
    (d): d is string => !!d && existsSync(d),
  );

  constructor(@InjectLlm() private readonly llm: LlmClient) {}

  @Get()
  async summary() {
    if (!this.dir) return { extraction: [], agent: null };
    const files = (await readdir(this.dir)).filter((f) => f.endsWith('.json')).sort();
    // A report being written or of an older shape is skipped, not a failure of the whole page.
    const read = async (f: string, fields: string[]) => {
      try {
        const r = JSON.parse(await readFile(join(this.dir!, f), 'utf8'));
        const missing = fields.filter((k) => r?.[k] === undefined);
        if (!missing.length) return r;
        this.logger.warn(`Skipping ${f}: missing ${missing.join(', ')}`);
      } catch (err) {
        this.logger.warn(`Skipping ${f}: ${err instanceof Error ? err.message : err}`);
      }
      return null;
    };

    const extraction = [];
    for (const f of files.filter((f) => f.startsWith('extraction-'))) {
      const r = await read(f, ['provider', 'overall', 'byType', 'byTemplate', 'byField', 'rules']);
      if (!r || !Array.isArray(r.byType) || !Array.isArray(r.byTemplate) || !Array.isArray(r.byField) || !Array.isArray(r.rules.table)) continue;
      // extraction-<model>.json is the v1 set; extraction-<model>-<set>.json any other set (v1-scans, v1-isf, v2).
      const set = f.match(/^extraction-.+?-(v\d[\w-]*)\.json$/)?.[1] ?? 'v1';
      extraction.push({
        set,
        file: f,
        provider: r.provider,
        modelVersion: r.modelVersion,
        promptVersion: r.promptVersion,
        shipments: r.shipments,
        documents: r.documents,
        failedDocuments: r.failedDocuments,
        classificationAccuracy: r.classificationAccuracy,
        overall: r.overall as Tally,
        byType: (r.byType as (Tally & { type: string })[]).map(({ type, accuracy, total }) => ({ type, accuracy, total })),
        byTemplate: (r.byTemplate as (Tally & { template: string })[]).map(({ template, accuracy, total }) => ({ template, accuracy, total })),
        weakestFields: (r.byField as (Tally & { type: string; field: string })[]).filter((x) => x.accuracy < 1).slice(0, 8).map(({ type, field, accuracy, total }) => ({ type, field, accuracy, total })),
        rules: r.rules,
      });
    }
    // The agent report of the model the app runs; otherwise the newest one.
    const agents = [];
    for (const f of files.filter((f) => f.startsWith('agent-'))) {
      const r = await read(f, ['provider', 'summary']);
      if (r && Array.isArray(r.summary)) agents.push({ r, mtime: (await stat(join(this.dir!, f))).mtimeMs });
    }
    const a = (agents.find((x) => x.r.provider === this.llm.provider.id) ?? agents.sort((x, y) => y.mtime - x.mtime)[0])?.r ?? null;
    return {
      extraction,
      agent: a && { provider: a.provider, modelVersion: a.modelVersion, promptVersion: a.promptVersion, summary: a.summary },
    };
  }
}
