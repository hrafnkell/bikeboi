import { describe, expect, test } from 'bun:test';
import { applySettings, defaultSettings, normalizeSettings, saveSettings, settings } from '../src/state.ts';
import { changes } from '../src/changes.ts';

describe('settings', () => {
  test('normalize fills, clamps and drops junk', () => {
    const s = normalizeSettings({ ftp: 9999, riderMass: '80', gearMode: 'weird', scene: 'tron', extra: 1, pacer: { enabled: true, power: 10 }, updatedAt: -5 });
    expect(s.ftp).toBe(600);
    expect(s.riderMass).toBe(80);
    expect(s.gearMode).toBe('model');
    expect(s.scene).toBe('tron');
    expect((s as unknown as Record<string, unknown>).extra).toBeUndefined();
    expect(s.pacer).toEqual({ mode: 'steady', power: 50, workoutId: defaultSettings.pacer.workoutId, hard: false });
    expect(s.updatedAt).toBe(0);
    expect(normalizeSettings(null)).toEqual({ ...defaultSettings, rider: normalizeSettings(null).rider });
  });

  test('a save that changes nothing is not a change', () => {
    let fired = 0;
    const off = changes.on('settings', () => fired++);
    const before = settings.updatedAt;
    saveSettings();
    expect(fired).toBe(0);
    expect(settings.updatedAt).toBe(before);
    settings.ftp += 5;
    saveSettings();
    expect(fired).toBe(1);
    expect(settings.updatedAt).toBeGreaterThan(before);
    saveSettings();
    expect(fired).toBe(1);
    off();
  });

  test('applying a document from the account keeps its timestamp and is silent', () => {
    let fired = 0;
    const off = changes.on('settings', () => fired++);
    applySettings({ ...settings, ftp: 333, updatedAt: 12345 });
    expect(settings.ftp).toBe(333);
    expect(settings.updatedAt).toBe(12345);
    expect(fired).toBe(0);
    saveSettings(); // nothing changed since the apply
    expect(fired).toBe(0);
    off();
  });
});
