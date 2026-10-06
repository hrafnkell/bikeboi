import { describe, expect, test } from 'bun:test';
import {
  hash, makeCamera, noise, slopeAngle, toScreenX, toScreenY, viewMeters, visibleRange,
} from '../src/game/world.ts';

describe('world', () => {
  const vp = { width: 800, height: 400 };

  test('rider sits at the anchor', () => {
    const cam = makeCamera(vp, 1234, 56);
    expect(toScreenX(cam, 1234)).toBeCloseTo(cam.anchorX, 6);
    expect(toScreenY(cam, 56)).toBeCloseTo(cam.anchorY, 6);
  });

  test('ahead is right, higher is up, altitude is exaggerated', () => {
    const cam = makeCamera(vp, 0, 0);
    expect(toScreenX(cam, 10)).toBeGreaterThan(toScreenX(cam, 0));
    expect(toScreenY(cam, 5)).toBeLessThan(toScreenY(cam, 0));
    const dx = toScreenX(cam, 1) - toScreenX(cam, 0);
    const dy = toScreenY(cam, 0) - toScreenY(cam, 1);
    expect(dy / dx).toBeCloseTo(cam.exaggeration, 6);
  });

  test('visible range spans the view width', () => {
    const cam = makeCamera(vp, 500, 0);
    const [d0, d1] = visibleRange(cam, vp);
    expect(d1 - d0).toBeCloseTo(viewMeters(vp), 6);
    expect(toScreenX(cam, d0)).toBeCloseTo(0, 6);
    expect(toScreenX(cam, d1)).toBeCloseTo(vp.width, 6);
  });

  test('view is narrower in portrait and bounded', () => {
    expect(viewMeters({ width: 400, height: 800 })).toBe(22);
    expect(viewMeters({ width: 3000, height: 800 })).toBe(60);
    expect(viewMeters(vp)).toBeGreaterThan(viewMeters({ width: 400, height: 400 }));
  });

  test('slope angle and noise are well-behaved', () => {
    expect(slopeAngle(0)).toBe(0);
    expect(slopeAngle(0.1)).toBeGreaterThan(0);
    expect(hash(5, 1)).toBe(hash(5, 1));
    expect(hash(5, 1)).not.toBe(hash(6, 1));
    for (let x = 0; x < 20; x += 0.37) {
      const n = noise(x, 3);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(1);
    }
    expect(noise(4, 3)).toBeCloseTo(hash(4, 3), 10);
  });
});
