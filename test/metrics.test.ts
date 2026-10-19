import { describe, expect, test } from 'bun:test';
import { heartRateDrift, normalizedPower, rideMetrics } from '../src/ride/metrics.ts';

describe('ride metrics', () => {
  test('normalized power is the mean for steady riding and above it for lumpy riding', () => {
    expect(normalizedPower(Array(600).fill(200))).toBe(200);
    expect(normalizedPower([100, 200, 300])).toBe(200);
    expect(normalizedPower([])).toBe(0);
    const lumpy = Array.from({ length: 600 }, (_, i) => (Math.floor(i / 60) % 2 ? 300 : 100));
    const np = normalizedPower(lumpy);
    expect(np).toBeGreaterThan(200);
    expect(np).toBeLessThan(300);
  });

  test('intensity, stress and work follow the FTP', () => {
    const samples = Array.from({ length: 3600 }, () => ({ power: 200, heartRate: 0 }));
    const m = rideMetrics(samples, 200, { '1200': 210 });
    expect(m.np).toBe(200);
    expect(m.intensity).toBe(1);
    expect(m.tss).toBe(100);
    expect(m.workKj).toBe(720);
    expect(m.ftpEstimate).toBe(200); // 95 % of 210, rounded
    expect(m.hrDrift).toBeNull();
    expect(m.ftp).toBe(200);
    const noFtp = rideMetrics(samples, 0);
    expect(noFtp.intensity).toBeNull();
    expect(noFtp.tss).toBeNull();
    expect(noFtp.ftpEstimate).toBeNull();
  });

  test('heart-rate drift compares power per beat across the halves', () => {
    const steady = Array.from({ length: 1800 }, () => ({ power: 200, heartRate: 150 }));
    expect(heartRateDrift(steady)).toBe(0);
    const drifting = Array.from({ length: 1800 }, (_, i) => ({ power: 200, heartRate: i < 900 ? 140 : 154 }));
    expect(heartRateDrift(drifting)).toBeCloseTo(9.1, 0);
    expect(heartRateDrift(steady.slice(0, 600))).toBeNull();
    expect(heartRateDrift(steady.map((s, i) => (i % 2 ? { ...s, heartRate: 0 } : s)))).toBeNull();
  });
});
