import { describe, expect, it } from 'vitest';
import { ProgressEventSchema, report, startStage, withStage, type ExtractionDetail, type ExtractionUpdate } from './progress';

/** A clock that moves only when told to. */
const clock = (start = 1000) => {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
};

describe('progress events', () => {
  it('times a stage and ends it only once', async () => {
    const seen: ExtractionUpdate[] = [];
    const c = clock();
    const ocr = await startStage<ExtractionDetail, 'ocr'>((u) => void seen.push(u), 'ocr', { pages: 2 }, c.now);
    await ocr.progress({ page: 1, pages: 2 });
    c.advance(4200);
    await ocr.done({ confidence: 87 });
    await ocr.fail(new Error('late'));
    await ocr.progress({ page: 2, pages: 2 });
    expect(seen).toEqual([
      { stage: 'ocr', status: 'started', detail: { pages: 2 } },
      { stage: 'ocr', status: 'progress', detail: { page: 1, pages: 2 } },
      { stage: 'ocr', status: 'done', durationMs: 4200, detail: { confidence: 87 } },
    ]);
  });

  it('reports a failure with its message and rethrows it', async () => {
    const seen: ExtractionUpdate[] = [];
    const work = withStage<ExtractionDetail, 'extracting', never>((u) => void seen.push(u), 'extracting', async () => {
      throw new Error('Ollama is not reachable');
    });
    await expect(work).rejects.toThrow('Ollama is not reachable');
    expect(seen.map((u) => [u.status, u.detail?.error])).toEqual([
      ['started', undefined],
      ['failed', 'Ollama is not reachable'],
    ]);
  });

  it('never lets a broken hook break the work', async () => {
    await expect(report<ExtractionDetail>(() => Promise.reject(new Error('db down')), { stage: 'reading', status: 'started' })).resolves.toBeUndefined();
    const result = await withStage<ExtractionDetail, 'reading', number>(
      () => {
        throw new Error('sync throw');
      },
      'reading',
      async () => 3,
      (pages) => ({ pages }),
    );
    expect(result).toBe(3);
    await expect(report<ExtractionDetail>(undefined, { stage: 'reading', status: 'started' })).resolves.toBeUndefined();
  });

  it('awaits the hook, so a caller can pace stages', async () => {
    const order: string[] = [];
    await withStage<ExtractionDetail, 'normalizing', void>(
      async (u) => {
        await new Promise((r) => setTimeout(r, 5));
        order.push(u.status);
      },
      'normalizing',
      async () => void order.push('work'),
    );
    expect(order).toEqual(['started', 'work', 'done']);
  });

  it('checks that the stage belongs to the kind', () => {
    const event = {
      id: 7,
      shipmentId: '6f1c1c49-6e8f-4d2e-9f0e-2f4b8a1c0d11',
      userId: null,
      runId: '0b8f5f8e-3c55-4c3a-9a43-1d6f7a2c9e10',
      kind: 'validation',
      stage: 'agent',
      status: 'progress',
      at: '2026-10-13T10:00:00.000Z',
      detail: { index: 1, total: 2, question: 'Same consignee written differently?' },
    };
    expect(ProgressEventSchema.safeParse(event).success).toBe(true);
    expect(ProgressEventSchema.safeParse({ ...event, stage: 'ocr' }).success).toBe(false);
    expect(ProgressEventSchema.safeParse({ ...event, kind: 'extraction', stage: 'ocr' }).success).toBe(true);
    expect(ProgressEventSchema.safeParse({ ...event, status: 'paused' }).success).toBe(false);
  });
});
