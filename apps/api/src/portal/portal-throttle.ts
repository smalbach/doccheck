import { Injectable } from '@nestjs/common';

const WINDOW_MS = 15 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/** Limits per window, from the environment (PORTAL_*), with defaults. */
const limit = (name: string, fallback: number) => {
  const n = Number(process.env[name] ?? fallback);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/**
 * Portal requests in memory (one API process), like the sign-in throttles:
 * - per client address, 300 requests in 15 minutes (PORTAL_IP_REQUESTS), the page polls while checking;
 * - per client address, 20 refused links in 15 minutes (PORTAL_IP_DENIED): then even good links wait;
 * - per request, 20 uploads an hour (PORTAL_REQUEST_UPLOADS), and per address 30 (PORTAL_IP_UPLOADS).
 */
@Injectable()
export class PortalThrottle {
  private readonly hits = new Map<string, number[]>();

  private recent(key: string, window: number, now: number): number[] {
    const list = (this.hits.get(key) ?? []).filter((t) => now - t < window);
    if (list.length) this.hits.set(key, list);
    else this.hits.delete(key);
    return list;
  }

  private wait(checks: [string, number, number][], now: number): number {
    let wait = 0;
    for (const [key, max, window] of checks) {
      const list = this.recent(key, window, now);
      if (list.length >= max) wait = Math.max(wait, list[list.length - max]! + window - now);
    }
    return Math.ceil(wait / 1000);
  }

  private record(keys: [string, number][], now: number) {
    for (const [key, window] of keys) this.hits.set(key, [...this.recent(key, window, now), now]);
  }

  /** Seconds to wait before this address may use the portal again (0: go ahead); counts the request. */
  request(ip: string, now = Date.now()): number {
    const wait = this.wait(
      [
        [`ip:${ip}`, limit('PORTAL_IP_REQUESTS', 300), WINDOW_MS],
        [`denied:${ip}`, limit('PORTAL_IP_DENIED', 20), WINDOW_MS],
      ],
      now,
    );
    if (!wait) this.record([[`ip:${ip}`, WINDOW_MS]], now);
    return wait;
  }

  denied(ip: string, now = Date.now()) {
    this.record([[`denied:${ip}`, WINDOW_MS]], now);
  }

  /** Seconds to wait before another upload to this request from this address (0: go ahead); counts it. */
  upload(requestId: string, ip: string, now = Date.now()): number {
    const wait = this.wait(
      [
        [`upload:${requestId}`, limit('PORTAL_REQUEST_UPLOADS', 20), HOUR_MS],
        [`upload-ip:${ip}`, limit('PORTAL_IP_UPLOADS', 30), HOUR_MS],
      ],
      now,
    );
    if (!wait) this.record([[`upload:${requestId}`, HOUR_MS], [`upload-ip:${ip}`, HOUR_MS]], now);
    return wait;
  }
}
