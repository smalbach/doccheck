import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { Queue, QueueEvents, Worker, type ConnectionOptions } from 'bullmq';
import type { ExtractableType } from '@doccheck/extraction';
import { randomUUID } from 'node:crypto';
import { ProgressService } from '../progress/progress.service';
import { DocumentProcessor, type ProcessOptions } from './document.processor';

const QUEUE = 'extraction';

/** Job payload. runId and queuedAt tie the job's progress events together (kept across retries). */
type ExtractionJob = { documentId: string; type?: ExtractableType } & Required<Pick<ProcessOptions, 'runId' | 'queuedAt'>>;

function redisConnection(url: string): ConnectionOptions {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    username: u.username || undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    db: u.pathname.length > 1 ? Number(u.pathname.slice(1)) : 0,
    // Required by BullMQ workers: blocking commands must not be retried by the client.
    maxRetriesPerRequest: null,
  };
}

/**
 * Extraction jobs. With REDIS_URL set, documents go through a BullMQ queue processed by a worker
 * in this process (EXTRACTION_CONCURRENCY, default 1: a local model serves one request at a time).
 * Without Redis, documents are processed in the background of the same process, with no retries.
 * Keys are prefixed "doccheck" so a shared Redis is not polluted.
 */
@Injectable()
export class ExtractionQueue implements OnModuleInit, OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(ExtractionQueue.name);
  private queue?: Queue;
  private events?: QueueEvents;
  private worker?: Worker;

  constructor(
    private readonly processor: DocumentProcessor,
    private readonly progress: ProgressService,
  ) {}

  get mode(): 'bullmq' | 'inline' {
    return this.queue ? 'bullmq' : 'inline';
  }

  async onModuleInit() {
    const url = process.env.REDIS_URL;
    if (!url) {
      this.logger.warn('REDIS_URL is not set: extracting documents in-process, without a queue');
      return;
    }
    const connection = redisConnection(url);
    const prefix = 'doccheck';
    this.queue = new Queue(QUEUE, { connection, prefix });
    this.events = new QueueEvents(QUEUE, { connection, prefix });
    if (process.env.EXTRACTION_WORKER !== 'false') {
      this.worker = new Worker<ExtractionJob>(QUEUE, (job) => this.processor.process(job.data.documentId, job.data.type, { willRetry: job.attemptsMade + 1 < (job.opts.attempts ?? 1), runId: job.data.runId, queuedAt: job.data.queuedAt }), {
        connection,
        prefix,
        concurrency: Number(process.env.EXTRACTION_CONCURRENCY ?? 1),
      });
      this.worker.on('failed', (job, err) => this.logger.warn(`Job ${job?.id} failed (attempt ${job?.attemptsMade}): ${err.message}`));
    }
    await this.queue.waitUntilReady();
    this.logger.log(`Extraction queue ready on ${connection && 'host' in connection ? `${connection.host}:${connection.port}` : url}`);
  }

  /** In-process jobs die with the process, so their documents would stay QUEUED forever (BullMQ keeps its jobs). After migrations. */
  async onApplicationBootstrap() {
    if (!this.queue) await this.processor.failInterrupted();
  }

  /**
   * Queues the documents of a shipment; with `wait` the call resolves once every one is extracted or
   * failed. Each document gets a progress run, starting with a `queued` event and its place in line.
   */
  async enqueue(shipmentId: string, documentIds: string[], wait = false, type?: ExtractableType): Promise<void> {
    const queuedAt = Date.now();
    const ahead = this.queue ? await this.queue.getWaitingCount().catch(() => 0) : 0;
    const jobs: ExtractionJob[] = documentIds.map((documentId) => ({ documentId, type, runId: randomUUID(), queuedAt }));
    await Promise.all(jobs.map((j, i) => this.progress.run('extraction', shipmentId, { documentId: j.documentId, runId: j.runId }).emit({ stage: 'queued', status: 'started', detail: { position: ahead + i + 1 } })));
    if (!this.queue) {
      const run = async () => {
        for (const j of jobs) await this.processor.process(j.documentId, j.type, { runId: j.runId, queuedAt: j.queuedAt }).catch(() => undefined);
      };
      if (wait) await run();
      else void run();
      return;
    }
    const added = await this.queue.addBulk(
      jobs.map((data) => ({
        name: 'extract',
        data,
        // A re-extraction needs its own job id: BullMQ ignores a job id it already has.
        opts: { jobId: type ? `${data.documentId}-${type}-${Date.now()}` : data.documentId, attempts: 2, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: 1000, removeOnFail: 5000 },
      })),
    );
    if (wait) await Promise.all(added.map((j) => j.waitUntilFinished(this.events!).catch(() => undefined)));
  }

  async onApplicationShutdown() {
    await this.worker?.close();
    await this.events?.close();
    await this.queue?.close();
  }
}
