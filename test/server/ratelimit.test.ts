import { describe, expect, test } from 'bun:test';
import { RateLimiter } from '../../server/ratelimit.ts';

describe('rate limiter', () => {
  test('allows the limit, blocks after it, and resets with the window', () => {
    let now = 0;
    const limiter = new RateLimiter(1000, 3, () => now);
    expect([limiter.hit('k'), limiter.hit('k'), limiter.hit('k')]).toEqual([true, true, true]);
    expect(limiter.hit('k')).toBe(false);
    expect(limiter.retryAfter('k')).toBe(1);
    expect(limiter.hit('other')).toBe(true);
    now = 1001;
    expect(limiter.hit('k')).toBe(true);
    limiter.reset('k');
    expect(limiter.retryAfter('k')).toBe(0);
  });
});
