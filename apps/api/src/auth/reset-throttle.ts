import { Injectable } from '@nestjs/common';

const WINDOW_MS = 15 * 60 * 1000;
const MAX_PER_EMAIL = 3;
// Higher: many people can share one address (an office, a carrier-grade NAT).
const MAX_PER_ADDRESS = 20;

/**
 * "Forgot password?" requests per email and per client address, in memory (one API process): 3 per
 * email and 20 per address in 15 minutes. Every request counts, whether the account exists or not,
 * so a refusal says nothing about the email.
 */
@Injectable()
export class ResetThrottle {
  private readonly requests = new Map<string, number[]>();

  private recent(key: string, now: number): number[] {
    const list = (this.requests.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
    if (list.length) this.requests.set(key, list);
    else this.requests.delete(key);
    return list;
  }

  /** Seconds to wait, or 0 when a request is allowed. */
  retryAfter(email: string, ip: string, now = Date.now()): number {
    const limits: [string, number][] = [
      [`email:${email}`, MAX_PER_EMAIL],
      [`ip:${ip}`, MAX_PER_ADDRESS],
    ];
    let wait = 0;
    for (const [key, max] of limits) {
      const list = this.recent(key, now);
      if (list.length >= max) wait = Math.max(wait, list[list.length - max]! + WINDOW_MS - now);
    }
    return Math.ceil(wait / 1000);
  }

  record(email: string, ip: string, now = Date.now()): void {
    for (const key of [`email:${email}`, `ip:${ip}`]) this.requests.set(key, [...this.recent(key, now), now]);
  }
}
