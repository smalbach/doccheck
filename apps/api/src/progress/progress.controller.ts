import { Controller, Get, Param, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { ProgressEvent } from '@doccheck/schemas';
import type { Request, Response } from 'express';
import { CurrentOrg } from '../orgs/current-org.decorator';
import type { OrgContext } from '../orgs/org.types';
import { Permission } from '../orgs/permissions';
import { ShipmentOwnerGuard } from '../shipments/shipment-owner.guard';
import { ProgressEstimatesService } from './progress-estimates.service';
import { ProgressRepository, type OrgProgressEvent } from './progress.repository';
import { ProgressService } from './progress.service';
import { resumeAfter, SSE_HEARTBEAT, sseEvent, sseNamed } from './sse';

const HEARTBEAT_MS = 20_000;
/** What EventSource waits before reconnecting after the connection drops. */
const RETRY_MS = 3000;
/** Ended runs sent to a user-wide stream opened without a position (with every run still going). */
const USER_FINISHED_RUNS = 10;
/** Ids accepted per list by GET /events/labels. */
const MAX_LABEL_IDS = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A comma-separated list of uuids from the query string; anything else is dropped. */
function uuidList(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  return [...new Set(value.split(',').map((v) => v.trim()).filter((v) => UUID.test(v)))].slice(0, MAX_LABEL_IDS);
}

/**
 * Server-sent events (docs/PROGRESS-EVENTS.md). Each stream first sends what the client missed (from
 * progress_events), then a `ready` message, then live events as they are stored. Both routes need a
 * session (global AuthGuard); GET passes the same-origin and read-only demo guards.
 */
@Controller()
export class ProgressController {
  constructor(
    private readonly progress: ProgressService,
    private readonly repo: ProgressRepository,
    private readonly estimates: ProgressEstimatesService,
  ) {}

  /**
   * One shipment's events (404 unless it is the user's). Without Last-Event-ID or ?after=, the backlog
   * is the latest run of each document and the latest validation, enough to draw their timelines.
   */
  @Get('shipments/:id/events')
  @Permission('shipment.read')
  @UseGuards(ShipmentOwnerGuard)
  shipment(@Param('id') id: string, @Query('after') after: unknown, @Req() req: Request, @Res() res: Response) {
    const from = resumeAfter(req.headers['last-event-id'], after);
    this.stream(req, res, (e) => e.shipmentId === id, () => (from === undefined ? this.repo.shipmentLatestRuns(id) : this.repo.shipmentAfter(id, from)));
  }

  /**
   * Every event of the organization's shipments (activity panel, notifications). Without a position, the
   * backlog is every event of its runs still going and of its 10 latest ended runs. Not the ephemeral ones
   * (the model's answer as it is written, never stored): those are for the shipment page.
   */
  @Get('events')
  user(@CurrentOrg() org: OrgContext, @Query('after') after: unknown, @Req() req: Request, @Res() res: Response) {
    const from = resumeAfter(req.headers['last-event-id'], after);
    this.stream(req, res, (e) => (e as OrgProgressEvent).orgId === org.id && !e.ephemeral, () => (from === undefined ? this.repo.orgActivity(org.id, USER_FINISHED_RUNS) : this.repo.orgAfter(org.id, from)));
  }

  /** Typical stage durations on this server, for remaining-time estimates (no user data; cached a minute). */
  @Get('events/estimates')
  @Permission('shipment.read')
  estimatesOf() {
    return this.estimates.get();
  }

  /**
   * Names for the activity panel: ?shipments=<ids>&documents=<ids> (comma-separated, 100 each at most).
   * Only the organization's shipments and documents are returned; other ids are left out.
   */
  @Get('events/labels')
  labels(@CurrentOrg() org: OrgContext, @Query('shipments') shipments: unknown, @Query('documents') documents: unknown) {
    return this.repo.labels(org.id, uuidList(shipments), uuidList(documents));
  }

  private stream(req: Request, res: Response, accept: (e: ProgressEvent) => boolean, backlog: () => Promise<ProgressEvent[]>) {
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    // no-transform: a compressing proxy must not buffer the stream; X-Accel-Buffering: nginx and others.
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    req.socket.setNoDelay(true);
    res.write(`retry: ${RETRY_MS}\n\n`);

    let closed = false;
    // Live events that arrive while the backlog is read are held, then sent unless already in it. An
    // event stored just before the backlog was read can still be announced after it: skip those too.
    let held: ProgressEvent[] | undefined = [];
    let inBacklog = new Set<number>();
    const send = (e: ProgressEvent) => {
      if (!closed && !inBacklog.has(e.id)) res.write(sseEvent(e));
    };
    const subscription = this.progress.events.subscribe({
      next: (e) => {
        if (!accept(e)) return;
        if (held) held.push(e);
        else send(e);
      },
      complete: () => res.end(),
    });
    const heartbeat = setInterval(() => !closed && res.write(SSE_HEARTBEAT), HEARTBEAT_MS);
    const cleanup = () => {
      closed = true;
      clearInterval(heartbeat);
      subscription.unsubscribe();
    };
    req.on('close', cleanup);
    res.on('close', cleanup);

    backlog().then(
      (events) => {
        for (const e of events) send(e);
        inBacklog = new Set(events.map((e) => e.id));
        const live = held ?? [];
        held = undefined;
        for (const e of live) send(e);
        if (!closed) res.write(sseNamed('ready', { lastId: Math.max(0, ...events.map((e) => e.id), ...live.map((e) => e.id)) }));
      },
      () => {
        // Without the backlog the client would miss events silently: end, and let it reconnect.
        cleanup();
        res.end();
      },
    );
  }
}
