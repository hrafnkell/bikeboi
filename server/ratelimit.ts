// Fixed-window counters in memory. Enough to blunt password guessing on one server.

export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private windowMs: number,
    private max: number,
    private now: () => number = Date.now,
  ) {}

  /** Count one attempt; false when the key is over its limit. */
  hit(key: string): boolean {
    const t = this.now();
    if (this.hits.size > 10_000) this.prune(t);
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= t) {
      this.hits.set(key, { count: 1, resetAt: t + this.windowMs });
      return true;
    }
    entry.count += 1;
    return entry.count <= this.max;
  }

  /** Seconds until the key may try again. */
  retryAfter(key: string): number {
    const entry = this.hits.get(key);
    return entry ? Math.max(1, Math.ceil((entry.resetAt - this.now()) / 1000)) : 0;
  }

  reset(key: string): void {
    this.hits.delete(key);
  }

  private prune(t: number): void {
    for (const [k, v] of this.hits) if (v.resetAt <= t) this.hits.delete(k);
  }
}
