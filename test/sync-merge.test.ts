import { describe, expect, test } from 'bun:test';
import { mergeBests, mergeSettings, mergeWorkouts } from '../src/sync/merge.ts';
import type { Best, WorkoutRecord } from '../src/sync/merge.ts';
import { normalizeSettings } from '../src/state.ts';

const trace = (lapTime: number) => ({ lapTime, t: [0, lapTime], d: [0, 1000] });
const best = (circuitId: string, segmentId: string, lapTime: number): Best => ({ circuitId, segmentId, trace: trace(lapTime) });
const workout = (id: string, name: string, updatedAt: number, text = '- 10m 75%'): WorkoutRecord => ({ id, name, text, updatedAt });

describe('mergeSettings', () => {
  const local = normalizeSettings({ ftp: 250, updatedAt: 1000 });

  test('the newer change wins', () => {
    expect(mergeSettings(local, { doc: { ftp: 300 }, updatedAt: 2000 })).toEqual({ use: 'server', doc: { ftp: 300 } });
    expect(mergeSettings(local, { doc: { ftp: 300 }, updatedAt: 500 }).use).toBe('local');
    expect(mergeSettings(local, { doc: { ftp: 300 }, updatedAt: 1000 }).use).toBe('local');
  });

  test('a never-saved device yields to the account; an empty account takes the device', () => {
    expect(mergeSettings(normalizeSettings({}), { doc: { ftp: 300 }, updatedAt: 1 }).use).toBe('server');
    expect(mergeSettings(local, { doc: null, updatedAt: 0 })).toEqual({ use: 'local', doc: local });
  });
});

describe('mergeBests', () => {
  test('faster wins in each direction, equal is left alone', () => {
    const local = [best('rollers', '', 100), best('rollers', 'climb-1', 50), best('wall', '', 400)];
    const server = [best('rollers', '', 90), best('rollers', 'climb-1', 60), best('wall', '', 400), best('coast', '', 700)];
    const { toLocal, toServer } = mergeBests(local, server);
    expect(toLocal.map((b) => `${b.circuitId}:${b.segmentId}=${b.trace.lapTime}`).sort()).toEqual(['coast:=700', 'rollers:=90']);
    expect(toServer.map((b) => `${b.circuitId}:${b.segmentId}=${b.trace.lapTime}`)).toEqual(['rollers:climb-1=50']);
  });

  test('empty sides', () => {
    expect(mergeBests([], [])).toEqual({ toLocal: [], toServer: [] });
    expect(mergeBests([best('a', '', 1)], []).toServer.length).toBe(1);
    expect(mergeBests([], [best('a', '', 1)]).toLocal.length).toBe(1);
  });
});

describe('mergeWorkouts', () => {
  test('union by id, newer copy of a shared id wins', () => {
    const local = [workout('custom:a', 'Hills', 100), workout('custom:b', 'Sprints', 300, '- 1m 150%')];
    const server = [workout('custom:a', 'Hills', 200, '- 20m 80%'), workout('custom:c', 'Easy', 50)];
    const m = mergeWorkouts(local, server, []);
    expect(m.toLocal.map((w) => w.id).sort()).toEqual(['custom:a', 'custom:b', 'custom:c']);
    expect(m.toLocal.find((w) => w.id === 'custom:a')!.text).toBe('- 20m 80%');
    expect(m.toServer.map((w) => w.id)).toEqual(['custom:b']);
    expect(m.toDelete).toEqual([]);
    expect(m.renamedIds.size).toBe(0);
  });

  test('same name on two devices collapses to the newer and renames the loser', () => {
    const local = [workout('custom:old', 'Tempo', 100)];
    const server = [workout('custom:new', 'tempo', 500)];
    const m = mergeWorkouts(local, server, []);
    expect(m.toLocal.map((w) => w.id)).toEqual(['custom:new']);
    expect(m.renamedIds.get('custom:old')).toBe('custom:new');
    expect(m.toServer).toEqual([]);
    expect(m.toDelete).toEqual([]);
    // the other way round: the local one is newer, the server's id goes
    const m2 = mergeWorkouts([workout('custom:old', 'Tempo', 900)], [workout('custom:new', 'tempo', 500)], []);
    expect(m2.toLocal.map((w) => w.id)).toEqual(['custom:old']);
    expect(m2.toServer.map((w) => w.id)).toEqual(['custom:old']);
    expect(m2.toDelete).toEqual(['custom:new']);
    expect(m2.renamedIds.get('custom:new')).toBe('custom:old');
  });

  test('a tombstone deletes the server copy and keeps it out of the merge', () => {
    const m = mergeWorkouts([], [workout('custom:x', 'Gone', 10), workout('custom:y', 'Kept', 10)], ['custom:x']);
    expect(m.toLocal.map((w) => w.id)).toEqual(['custom:y']);
    expect(m.toDelete).toEqual(['custom:x']);
  });
});
