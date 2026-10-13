import { Injectable } from '@nestjs/common';

const WINDOW_MS = 60 * 60 * 1000;
const LOOPBACK = /^(::1|127\.\d+\.\d+\.\d+|::ffff:127\.\d+\.\d+\.\d+)$/;

/**
 * Sign-ups per client address and hour, in memory (one API process). SIGNUP_LIMIT_PER_HOUR,
 * default 5. Requests from this machine are not counted: local scripts sign up often, and a proxy
 * here (ngrok, Caddy) passes the visitor's address in X-Forwarded-For, which is what counts.
 */
@Injectable()
export class SignupThrottle {
  private readonly signups = new Map<string, number[]>();

  private limit(): number {
    const n = Number(process.env.SIGNUP_LIMIT_PER_HOUR ?? 5);
    return Number.isFinite(n) && n > 0 ? n : 5;
  }

  /** Seconds to wait before this address may sign up again, or 0. */
  retryAfter(ip: string, now = Date.now()): number {
    if (LOOPBACK.test(ip)) return 0;
    const recent = (this.signups.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
    this.signups.set(ip, recent);
    const max = this.limit();
    return recent.length >= max ? Math.ceil((recent[recent.length - max]! + WINDOW_MS - now) / 1000) : 0;
  }

  record(ip: string, now = Date.now()): void {
    if (LOOPBACK.test(ip)) return;
    this.signups.set(ip, [...(this.signups.get(ip) ?? []).filter((t) => now - t < WINDOW_MS), now]);
  }
}
