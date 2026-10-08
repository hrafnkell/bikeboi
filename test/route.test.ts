import { describe, expect, test } from 'bun:test';
import { circuits, findCircuit, lookupCircuit } from '../src/ride/circuits/index.ts';
import { buildRoute, parseRouteId, routeId, routeName } from '../src/ride/route.ts';

const by = (id: string) => circuits.find((c) => c.id === id)!;

describe('routes', () => {
  test('ids round-trip and stay valid circuit ids', () => {
    const legs = [{ id: 'harbour' }, { id: 'doomsday', toTop: true }, { id: 'flats' }];
    const id = routeId(legs);
    expect(id).toBe('rt--harbour--doomsday-up--flats');
    expect(id).toMatch(/^[a-z0-9-]{1,120}$/);
    expect(parseRouteId(id)).toEqual([{ id: 'harbour', toTop: false }, { id: 'doomsday', toTop: true }, { id: 'flats', toTop: false }]);
    expect(parseRouteId('rollers')).toBeNull();
    expect(parseRouteId('rt--')).toBeNull();
    expect(lookupCircuit('rt--harbour--nope')).toBeNull();
    expect(lookupCircuit(id)!.id).toBe(id);
    expect(findCircuit('rt--harbour--nope').id).toBe(circuits[0].id);
  });

  test('a single whole circuit is itself', () => {
    expect(buildRoute([{ circuit: by('rollers'), toTop: false }])).toBe(by('rollers'));
  });

  test('whole legs join without a step and the route stays closed', () => {
    const r = buildRoute([{ circuit: by('harbour'), toTop: false }, { circuit: by('wall'), toTop: false }]);
    expect(r.length).toBe(8000);
    expect(r.open).toBeFalsy();
    expect(r.legs!.map((l) => l.start)).toEqual([0, 2000]);
    // continuous across the join and across the lap line
    expect(Math.abs(r.altitudeAt(1999.9) - r.altitudeAt(2000.1))).toBeLessThan(0.2);
    expect(Math.abs(r.altitudeAt(7999.9) - r.altitudeAt(0.1))).toBeLessThan(0.2);
    // the second leg is the wall, lifted to meet the harbour's end
    expect(r.altitudeAt(2000 + 3000) - r.altitudeAt(2000)).toBeCloseTo(by('wall').altitudeAt(3000) - by('wall').altitudeAt(0), 6);
    expect(r.ascent).toBeCloseTo(by('harbour').ascent + by('wall').ascent, 0);
    expect(r.name).toBe('Harbour Crit → The Wall');
  });

  test('a summit cut ends at the top and makes the route open', () => {
    const wall = by('wall');
    const r = buildRoute([{ circuit: by('harbour'), toTop: false }, { circuit: wall, toTop: true }]);
    expect(r.open).toBe(true);
    expect(r.length).toBeCloseTo(2000 + wall.summitAt, 6);
    expect(r.altitudeAt(r.length - 0.1)).toBeCloseTo(r.maxAltitude, 0);
    expect(r.altitudeAt(r.length - 0.1) - r.altitudeAt(0)).toBeGreaterThan(100);
    // the climb is kept, the descent (which runs past the cut) is not
    expect(r.segments.map((s) => s.name)).toEqual(['Quayside Sprint', 'The Wall']);
    expect(r.segments[1].key).toBe('wall:climb-1');
    expect(r.segments[1].start).toBeCloseTo(2000 + wall.segments.find((s) => s.id === 'climb-1')!.start, 6);
    expect(r.ascent).toBeCloseTo(by('harbour').ascent + (wall.maxAltitude - wall.altitudeAt(0)), 0);
    expect(r.name).toBe('Harbour Crit → The Wall ↑');
  });

  test('a repeated leg numbers its segments apart but shares their bests', () => {
    const r = buildRoute([{ circuit: by('doomsday'), toTop: true }, { circuit: by('doomsday'), toTop: true }]);
    expect(r.segments.map((s) => s.id)).toEqual(['climb-1', 'climb-2']);
    expect(r.segments.map((s) => s.key)).toEqual(['doomsday:climb-1', 'doomsday:climb-1']);
    expect(r.legs![1].lift).toBeCloseTo(by('doomsday').maxAltitude - by('doomsday').altitudeAt(0), 0);
  });

  test('long names fall back to a count', () => {
    const legs = Array.from({ length: 8 }, () => ({ circuit: by('staircase'), toTop: true }));
    expect(routeName(legs, 100000)).toBe('8-leg route, 100.0 km');
    expect(routeName(legs, 100000).length).toBeLessThanOrEqual(80);
  });
});
