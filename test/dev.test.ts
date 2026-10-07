import { describe, expect, test } from 'bun:test';
import { isLocalHost } from '../src/dev.ts';

describe('dev switches', () => {
  test('only local hosts qualify', () => {
    expect(isLocalHost('localhost')).toBe(true);
    expect(isLocalHost('127.0.0.1')).toBe(true);
    expect(isLocalHost('[::1]')).toBe(true);
    expect(isLocalHost('bikeboi.hlekkir.is')).toBe(false);
    expect(isLocalHost('localhost.evil.example')).toBe(false);
    expect(isLocalHost('192.168.8.113')).toBe(false);
  });
});
