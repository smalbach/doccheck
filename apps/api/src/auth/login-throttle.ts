import { Injectable } from '@nestjs/common';

const WINDOW_MS = 15 * 60 * 1000;
const MAX_PER_EMAIL = 10;
// Higher: many people can share one address (an office, a carrier-grade NAT).
const MAX_PER_ADDRESS = 50;

/**
 * Failed sign-ins per email and per client address, in memory (one API process). After 10 failures
 * for an email, or 50 from an address, in 15 minutes, attempts are refused until the window passes;
 * a success clears the email.
 */
@Injectable()
export class LoginThrottle {
  private readonly failures = new Map<string, number[]>();

  private recent(key: string, now: number): number[] {
    const list = (this.failures.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
    if (list.length) this.failures.set(key, list);
    else this.failures.delete(key);
    return list;
  }

  /** Seconds to wait, or 0 when an attempt is allowed. */
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

  fail(email: string, ip: string, now = Date.now()): void {
    for (const key of [`email:${email}`, `ip:${ip}`]) this.failures.set(key, [...this.recent(key, now), now]);
  }

  succeed(email: string): void {
    this.failures.delete(`email:${email}`);
  }
}
