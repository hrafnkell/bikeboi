// Riding stance: how the rider sits on the bike, chosen from effort, speed and gradient.

export type StanceId = 'relaxed' | 'normal' | 'drops' | 'standing' | 'tuck';

/** Body positions in bike units (metres, x forward, y up, origin at the rear contact patch). */
export interface Posture {
  hip: { x: number; y: number };
  shoulder: { x: number; y: number };
  head: { x: number; y: number };
  hand: { x: number; y: number };
}

export const postures: Record<StanceId, Posture> = {
  // upright, hands on the tops: spinning along
  relaxed: { hip: { x: 0.29, y: 1.0 }, shoulder: { x: 0.57, y: 1.47 }, head: { x: 0.68, y: 1.65 }, hand: { x: 0.82, y: 1.01 } },
  // on the hoods
  normal: { hip: { x: 0.29, y: 1.0 }, shoulder: { x: 0.7, y: 1.38 }, head: { x: 0.83, y: 1.55 }, hand: { x: 0.95, y: 0.98 } },
  // in the drops, low and forward: pushing hard or going fast
  drops: { hip: { x: 0.29, y: 1.0 }, shoulder: { x: 0.79, y: 1.2 }, head: { x: 0.94, y: 1.34 }, hand: { x: 0.99, y: 0.87 } },
  // out of the saddle: sprinting or grinding up a steep pitch
  standing: { hip: { x: 0.46, y: 1.14 }, shoulder: { x: 0.82, y: 1.47 }, head: { x: 0.94, y: 1.65 }, hand: { x: 0.95, y: 0.98 } },
  // aero tuck on a fast descent, hands together on the tops, head down
  tuck: { hip: { x: 0.31, y: 0.97 }, shoulder: { x: 0.76, y: 1.12 }, head: { x: 0.92, y: 1.2 }, hand: { x: 0.86, y: 1.0 } },
};

export interface StanceInput {
  /** Watts, smoothed over a second or two. */
  power: number;
  ftp: number;
  /** m/s */
  speed: number;
  /** fraction */
  grade: number;
}

/** The stance the numbers call for right now, before any smoothing. */
export function pickStance(i: StanceInput): StanceId {
  const ftp = Math.max(50, i.ftp);
  const effort = i.power / ftp;
  if (i.speed >= 12.5 && effort < 0.3) return 'tuck'; // 45 km/h and coasting
  if (effort >= 1.4) return 'standing';
  if (effort >= 1.1 && i.grade >= 0.06) return 'standing';
  if (effort >= 0.9 || i.speed >= 10) return 'drops'; // threshold work, or 36 km/h
  if (effort < 0.5 && i.speed < 8) return 'relaxed';
  return 'normal';
}

/** How long a new stance must be called for before the rider changes to it, seconds. */
const HOLD: Record<StanceId, number> = { relaxed: 2, normal: 1.2, drops: 1, standing: 0.4, tuck: 1 };

/** Debounces pickStance so the rider does not fidget between stances. */
export class StanceSelector {
  current: StanceId = 'normal';
  private candidate: StanceId = 'normal';
  private held = 0;

  update(dt: number, input: StanceInput): StanceId {
    const wanted = pickStance(input);
    if (wanted === this.current) {
      this.candidate = wanted;
      this.held = 0;
      return this.current;
    }
    if (wanted !== this.candidate) {
      this.candidate = wanted;
      this.held = 0;
    }
    this.held += dt;
    if (this.held >= HOLD[wanted]) {
      this.current = wanted;
      this.held = 0;
    }
    return this.current;
  }
}

/** Move a posture part of the way towards another; rate 1 reaches it. */
export function blendPosture(from: Posture, to: Posture, rate: number): Posture {
  const t = Math.min(1, Math.max(0, rate));
  const mix = (a: { x: number; y: number }, b: { x: number; y: number }) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  return { hip: mix(from.hip, to.hip), shoulder: mix(from.shoulder, to.shoulder), head: mix(from.head, to.head), hand: mix(from.hand, to.hand) };
}
