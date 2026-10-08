// Routes: circuits strung together into one lap. A leg is a circuit ridden whole, or only
// up to its summit; after a summit the road jumps to the next leg's start (or back to the
// route start), so such a route is "open" and its lap line is a cut rather than a join.

import type { Circuit, Leg } from './circuit.ts';
import type { Segment } from './segments.ts';

export interface LegDef {
  id: string;
  toTop?: boolean;
}

const ROUTE_PREFIX = 'rt--';
const LEG_JOIN = '--';
const TOP_SUFFIX = '-up';
/** Longest route id the server stores. */
export const MAX_ROUTE_ID = 120;
const MAX_NAME = 80;

export function isRouteId(id: string): boolean {
  return id.startsWith(ROUTE_PREFIX);
}

/** `rt--harbour--doomsday-up--flats`: ids only contain [a-z0-9-], so this stays a valid circuit id. */
export function routeId(legs: LegDef[]): string {
  return ROUTE_PREFIX + legs.map((l) => l.id + (l.toTop ? TOP_SUFFIX : '')).join(LEG_JOIN);
}

export function parseRouteId(id: string): LegDef[] | null {
  if (!isRouteId(id)) return null;
  const legs = id.slice(ROUTE_PREFIX.length).split(LEG_JOIN).filter(Boolean).map((part) => (
    part.endsWith(TOP_SUFFIX) ? { id: part.slice(0, -TOP_SUFFIX.length), toTop: true } : { id: part, toTop: false }
  ));
  return legs.length > 0 ? legs : null;
}

export function routeName(legs: Array<{ circuit: Circuit; toTop: boolean }>, lengthM: number): string {
  const full = legs.map((l) => l.circuit.name + (l.toTop ? ' ↑' : '')).join(' → ');
  return full.length <= MAX_NAME ? full : `${legs.length}-leg route, ${(lengthM / 1000).toFixed(1)} km`;
}

/** A circuit that is the legs ridden one after another. One leg ridden whole is just that circuit. */
export function buildRoute(defs: Array<{ circuit: Circuit; toTop: boolean }>): Circuit {
  if (defs.length === 0) throw new Error('a route needs at least one leg');
  if (defs.length === 1 && !defs[0].toTop) return defs[0].circuit;

  const legs: Leg[] = [];
  let start = 0;
  let endAltitude = defs[0].circuit.altitudeAt(0);
  for (const d of defs) {
    const c = d.circuit;
    // a summit cut stops where the circuit is highest, if that is not the start itself
    const toTop = d.toTop && c.summitAt > 50;
    const length = toTop ? c.summitAt : c.length;
    const lift = endAltitude - c.altitudeAt(0);
    legs.push({ circuit: c, toTop, start, length, lift });
    start += length;
    endAltitude = c.altitudeAt(length) + lift;
  }
  const length = start;
  const open = Math.abs(endAltitude - legs[0].circuit.altitudeAt(0) - legs[0].lift) > 0.5;

  const legAt = (distance: number): Leg => {
    const d = ((distance % length) + length) % length;
    let lo = 0;
    let hi = legs.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (legs[mid].start <= d) lo = mid;
      else hi = mid - 1;
    }
    return legs[lo];
  };
  const inLeg = (distance: number, leg: Leg) => ((distance % length) + length) % length - leg.start;
  const altitudeAt = (distance: number) => {
    const leg = legAt(distance);
    return leg.circuit.altitudeAt(inLeg(distance, leg)) + leg.lift;
  };
  const gradeAt = (distance: number) => {
    const leg = legAt(distance);
    return leg.circuit.gradeAt(inLeg(distance, leg));
  };

  // segments carry over, except those that run past the end of their leg
  const counts: Record<string, number> = {};
  const segments: Segment[] = [];
  for (const leg of legs) {
    for (const s of leg.circuit.segments) {
      if (s.start + s.length > leg.length + 1) continue;
      counts[s.type] = (counts[s.type] ?? 0) + 1;
      segments.push({ ...s, id: `${s.type}-${counts[s.type]}`, start: leg.start + s.start, key: `${leg.circuit.id}:${s.id}` });
    }
  }

  let minAltitude = Infinity;
  let maxAltitude = -Infinity;
  let summitAt = 0;
  let ascent = 0;
  let maxGrade = 0;
  const step = 5;
  let prev = altitudeAt(0);
  for (let d = 0; d < length; d += step) {
    const a = altitudeAt(d);
    minAltitude = Math.min(minAltitude, a);
    if (a > maxAltitude) {
      maxAltitude = a;
      summitAt = d;
    }
    if (d > 0) ascent += Math.max(0, a - prev);
    prev = a;
    maxGrade = Math.max(maxGrade, Math.abs(gradeAt(d)));
  }
  if (!open) ascent += Math.max(0, altitudeAt(0) - prev);

  const legDefs = legs.map((l) => ({ id: l.circuit.id, toTop: l.toTop }));
  const first = legs[0].circuit;
  return {
    id: routeId(legDefs),
    name: routeName(legs, length),
    description: legs.map((l) => `${l.circuit.name}${l.toTop ? ' to the top' : ''}`).join(', '),
    seed: first.seed,
    scene: first.scene,
    group: first.group,
    length,
    points: [],
    altitudeAt,
    gradeAt,
    segments,
    minAltitude,
    maxAltitude,
    ascent,
    maxGrade,
    summitAt,
    open,
    legs,
  };
}
