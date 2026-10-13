import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { Queue, QueueEvents, Worker, type ConnectionOptions } from 'bullmq';
import type { ExtractableType } from '@doccheck/extraction';
import { DocumentProcessor } from './document.processor';

const QUEUE = 'extraction';

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

  constructor(private readonly processor: DocumentProcessor) {}

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
      this.worker = new Worker(QUEUE, (job) => this.processor.process(job.data.documentId, job.data.type), {
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

  /** Queues the documents; with `wait` the call resolves once every one is extracted or failed. */
  async enqueue(documentIds: string[], wait = false, type?: ExtractableType): Promise<void> {
    if (!this.queue) {
      const run = async () => {
        for (const id of documentIds) await this.processor.process(id, type).catch(() => undefined);
      };
      if (wait) await run();
      else void run();
      return;
    }
    const jobs = await this.queue.addBulk(
      documentIds.map((documentId) => ({
        name: 'extract',
        data: { documentId, type },
        // A re-extraction needs its own job id: BullMQ ignores a job id it already has.
        opts: { jobId: type ? `${documentId}-${type}-${Date.now()}` : documentId, attempts: 2, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: 1000, removeOnFail: 5000 },
      })),
    );
    if (wait) await Promise.all(jobs.map((j) => j.waitUntilFinished(this.events!).catch(() => undefined)));
  }

  async onApplicationShutdown() {
    await this.worker?.close();
    await this.events?.close();
    await this.queue?.close();
  }
}
