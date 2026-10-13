import { Controller, Get } from '@nestjs/common';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

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
@Controller('results')
export class ResultsController {
  private readonly dir = [process.env.REPORTS_DIR, resolve(process.cwd(), 'eval/reports'), resolve(__dirname, '../../../../eval/reports')].find(
    (d): d is string => !!d && existsSync(d),
  );

  @Get()
  async summary() {
    if (!this.dir) return { extraction: [], agent: null };
    const files = (await readdir(this.dir)).filter((f) => f.endsWith('.json')).sort();
    const read = async (f: string) => JSON.parse(await readFile(join(this.dir!, f), 'utf8'));

    const extraction = [];
    for (const f of files.filter((f) => f.startsWith('extraction-'))) {
      const r = await read(f);
      // extraction-<model>.json is the v1 set; extraction-<model>-<set>.json any other set (v1-scans, v1-isf).
      const set = f.match(/^extraction-.+?-(v1[\w-]*)\.json$/)?.[1] ?? 'v1';
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
    const agentFile = files.find((f) => f.startsWith('agent-'));
    const a = agentFile ? await read(agentFile) : null;
    return {
      extraction,
      agent: a && { provider: a.provider, modelVersion: a.modelVersion, promptVersion: a.promptVersion, summary: a.summary },
    };
  }
}
