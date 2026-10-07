// The rider and bike: customisable look, and the drawing shared by the game and the preview.

import { postures } from './stance.ts';
import type { Posture } from './stance.ts';

export type SpokeStyle = 'classic' | 'five' | 'tri' | 'disc';
export type SleeveLength = 'short' | 'long';
export type PantsLength = 'shorts' | 'tights';

export interface RiderLook {
  helmet: boolean;
  helmetColor: string;
  hairColor: string;
  skinColor: string;
  jerseyColor: string;
  sleeves: SleeveLength;
  pantsColor: string;
  pants: PantsLength;
  frameColor: string;
  tyreColor: string;
  spokes: SpokeStyle;
}

export const defaultRiderLook: RiderLook = {
  helmet: true,
  helmetColor: '#f8f9fa',
  hairColor: '#3b2a1e',
  skinColor: '#f2c9a0',
  jerseyColor: '#1971c2',
  sleeves: 'short',
  pantsColor: '#1b2a3a',
  pants: 'shorts',
  frameColor: '#e03131',
  tyreColor: '#141414',
  spokes: 'classic',
};

export const spokeStyles: Array<{ id: SpokeStyle; name: string }> = [
  { id: 'classic', name: 'Classic spokes' },
  { id: 'five', name: 'Five-spoke' },
  { id: 'tri', name: 'Tri-spoke' },
  { id: 'disc', name: 'Disc' },
];

const HEX = /^#[0-9a-f]{6}$/i;

/** A complete, valid look from anything that came out of storage. */
export function sanitizeLook(input: unknown): RiderLook {
  const x = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
  const d = defaultRiderLook;
  const color = (key: keyof RiderLook) =>
    typeof x[key] === 'string' && HEX.test(x[key] as string) ? (x[key] as string).toLowerCase() : (d[key] as string);
  const oneOf = <T extends string>(key: keyof RiderLook, allowed: readonly T[]): T =>
    allowed.includes(x[key] as T) ? (x[key] as T) : (d[key] as T);
  return {
    helmet: typeof x.helmet === 'boolean' ? x.helmet : d.helmet,
    helmetColor: color('helmetColor'),
    hairColor: color('hairColor'),
    skinColor: color('skinColor'),
    jerseyColor: color('jerseyColor'),
    sleeves: oneOf('sleeves', ['short', 'long'] as const),
    pantsColor: color('pantsColor'),
    pants: oneOf('pants', ['shorts', 'tights'] as const),
    frameColor: color('frameColor'),
    tyreColor: color('tyreColor'),
    spokes: oneOf('spokes', ['classic', 'five', 'tri', 'disc'] as const),
  };
}

/** Darken (factor < 1) or lighten (factor > 1) a #rrggbb colour. Other formats pass through. */
export function shade(hex: string, factor: number): string {
  if (!HEX.test(hex)) return hex;
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v * factor)));
  const r = ch(n >> 16);
  const g = ch((n >> 8) & 0xff);
  const b = ch(n & 0xff);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

/** Final colours and shapes for one drawing of the rider. */
export interface RiderPaint {
  frame: string;
  tyre: string;
  spoke: string;
  disc: string;
  jersey: string;
  pants: string;
  skin: string;
  /** Far-side leg, drawn darker for depth. */
  farPants: string;
  farSkin: string;
  helmet: string;
  hair: string;
  parts: string;
  shoe: string;
  hasHelmet: boolean;
  sleeves: SleeveLength;
  pantsLength: PantsLength;
  spokes: SpokeStyle;
}

/** Colours a scene forces on the rider (shapes still come from the rider's look). */
export type PaintOverride = Partial<Pick<RiderPaint,
  'frame' | 'tyre' | 'spoke' | 'disc' | 'jersey' | 'pants' | 'skin' | 'farPants' | 'farSkin' | 'helmet' | 'hair' | 'parts' | 'shoe'
>>;

export function paintFor(look: RiderLook, override: PaintOverride | null = null): RiderPaint {
  return {
    frame: look.frameColor,
    tyre: look.tyreColor,
    spoke: 'rgba(210,210,210,0.9)',
    disc: '#2e323a',
    jersey: look.jerseyColor,
    pants: look.pantsColor,
    skin: look.skinColor,
    farPants: shade(look.pantsColor, 0.6),
    farSkin: shade(look.skinColor, 0.6),
    helmet: look.helmetColor,
    hair: look.hairColor,
    parts: '#222222',
    shoe: '#111111',
    ...override,
    hasHelmet: look.helmet,
    sleeves: look.sleeves,
    pantsLength: look.pants,
    spokes: look.spokes,
  };
}

/** Single-colour silhouette with the rider's shapes, for the ghost. */
export function monoPaint(look: RiderLook, color: string): RiderPaint {
  return {
    ...paintFor(look),
    frame: color, tyre: color, spoke: color, disc: color, jersey: color, pants: color, skin: color,
    farPants: color, farSkin: color, helmet: color, hair: color, parts: color, shoe: color,
  };
}

export interface RiderPose {
  /** Crank angle in radians. */
  crank: number;
  /** Wheel rotation in radians. */
  wheel: number;
  /** Draw a headlight beam and lights. */
  headlight: boolean;
  /** Body position; on the hoods when not given. */
  posture?: Posture;
}

interface Point {
  x: number;
  y: number;
}

const R = 0.34; // wheel radius, metres

/**
 * Draws bike and rider. The context must already be in bike units: metres, x forward,
 * y up, origin at the rear tyre's contact patch.
 */
export function drawRiderFigure(ctx: CanvasRenderingContext2D, paint: RiderPaint, pose: RiderPose): void {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (pose.headlight) {
    const beam = ctx.createLinearGradient(0.95, 0, 7, 0);
    beam.addColorStop(0, 'rgba(255,244,200,0.5)');
    beam.addColorStop(0.3, 'rgba(255,244,200,0.2)');
    beam.addColorStop(0.6, 'rgba(255,244,200,0.07)');
    beam.addColorStop(0.85, 'rgba(255,244,200,0.015)');
    beam.addColorStop(1, 'rgba(255,244,200,0)');
    ctx.fillStyle = beam;
    ctx.beginPath();
    ctx.moveTo(0.97, 0.98);
    ctx.lineTo(8, 2.1);
    ctx.lineTo(8, -0.25);
    ctx.closePath();
    ctx.fill();
  }

  const rear: Point = { x: 0, y: R };
  const front: Point = { x: 1.0, y: R };
  const bb: Point = { x: 0.42, y: 0.28 };
  const seat: Point = { x: 0.27, y: 0.93 };
  const head: Point = { x: 0.86, y: 0.9 };
  const posture = pose.posture ?? postures.normal;
  const bar: Point = posture.hand;
  const hip: Point = posture.hip;
  const shoulder: Point = posture.shoulder;
  const noggin: Point = posture.head;
  const hood: Point = { x: 0.95, y: 0.98 };

  const line = (a: Point, b: Point, w: number, color: string) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  };
  const dot = (p: Point, r: number, color: string) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
  };
  const spokesFrom = (hub: Point, count: number, width: number, color: string) => {
    for (let i = 0; i < count; i++) {
      const a = -pose.wheel + (i * Math.PI * 2) / count;
      line(hub, { x: hub.x + Math.cos(a) * (R - 0.04), y: hub.y + Math.sin(a) * (R - 0.04) }, width, color);
    }
  };

  const wheelAt = (hub: Point) => {
    if (paint.spokes === 'disc') {
      dot(hub, R - 0.03, paint.disc);
      // a stripe and a valve mark so the disc visibly turns
      spokesFrom(hub, 1, 0.03, paint.spoke);
      const a = -pose.wheel + Math.PI;
      dot({ x: hub.x + Math.cos(a) * (R - 0.1), y: hub.y + Math.sin(a) * (R - 0.1) }, 0.02, paint.spoke);
    } else if (paint.spokes === 'tri') {
      spokesFrom(hub, 3, 0.05, paint.spoke);
    } else if (paint.spokes === 'five') {
      spokesFrom(hub, 5, 0.03, paint.spoke);
    } else {
      spokesFrom(hub, 10, 0.011, paint.spoke);
    }
    ctx.strokeStyle = paint.tyre;
    ctx.lineWidth = 0.05;
    ctx.beginPath();
    ctx.arc(hub.x, hub.y, R - 0.025, 0, Math.PI * 2);
    ctx.stroke();
    dot(hub, 0.025, paint.parts);
  };

  // two-link leg from hip to pedal, knee pointing forward
  const leg = (a: number, far: boolean) => {
    const pedal: Point = { x: bb.x + Math.cos(-a) * 0.17, y: bb.y + Math.sin(-a) * 0.17 };
    const thigh = 0.45;
    const shin = 0.47;
    const dx = pedal.x - hip.x;
    const dy = pedal.y - hip.y;
    const dist = Math.min(thigh + shin - 0.001, Math.hypot(dx, dy));
    const along = (thigh * thigh - shin * shin + dist * dist) / (2 * dist);
    const off = Math.sqrt(Math.max(0, thigh * thigh - along * along));
    const ux = dx / dist;
    const uy = dy / dist;
    const k1: Point = { x: hip.x + ux * along + uy * off, y: hip.y + uy * along - ux * off };
    const k2: Point = { x: hip.x + ux * along - uy * off, y: hip.y + uy * along + ux * off };
    const knee = k1.x > k2.x ? k1 : k2;
    const pants = far ? paint.farPants : paint.pants;
    const skin = far ? paint.farSkin : paint.skin;
    line(bb, pedal, 0.03, paint.parts);
    line(knee, pedal, 0.08, paint.pantsLength === 'tights' ? pants : skin);
    line(hip, knee, 0.1, pants);
    line({ x: pedal.x - 0.04, y: pedal.y }, { x: pedal.x + 0.1, y: pedal.y }, 0.055, paint.shoe);
  };

  leg(pose.crank + Math.PI, true);
  wheelAt(rear);
  wheelAt(front);
  line(rear, bb, 0.035, paint.frame);
  line(rear, seat, 0.03, paint.frame);
  line(bb, seat, 0.04, paint.frame);
  line(bb, head, 0.045, paint.frame);
  line({ x: 0.3, y: 0.86 }, head, 0.04, paint.frame);
  line(head, front, 0.035, paint.frame);
  line(head, hood, 0.03, paint.parts);
  line({ x: 0.2, y: 0.95 }, { x: 0.36, y: 0.95 }, 0.04, paint.parts);
  leg(pose.crank, false);
  line(hip, shoulder, 0.17, paint.jersey);

  // arm
  if (paint.sleeves === 'long') {
    line(shoulder, bar, 0.07, paint.jersey);
    dot(bar, 0.04, paint.skin);
  } else {
    const cuff: Point = { x: shoulder.x + (bar.x - shoulder.x) * 0.4, y: shoulder.y + (bar.y - shoulder.y) * 0.4 };
    line(shoulder, bar, 0.06, paint.skin);
    line(shoulder, cuff, 0.075, paint.jersey);
  }

  // head
  dot(noggin, 0.1, paint.skin);
  ctx.beginPath();
  if (paint.hasHelmet) {
    // hair shows below the back of the helmet
    ctx.fillStyle = paint.hair;
    ctx.arc(noggin.x - 0.015, noggin.y - 0.005, 0.105, Math.PI * 0.75, Math.PI * 1.4);
    ctx.fill();
    ctx.beginPath();
    ctx.fillStyle = paint.helmet;
    ctx.arc(noggin.x, noggin.y + 0.02, 0.115, Math.PI * 0.05, Math.PI * 1.05);
  } else {
    ctx.fillStyle = paint.hair;
    ctx.arc(noggin.x - 0.01, noggin.y + 0.015, 0.105, Math.PI * 0.2, Math.PI * 1.25);
  }
  ctx.fill();

  if (pose.headlight) {
    dot({ x: 0.2, y: 0.86 }, 0.035, '#ff3b3b');
    dot({ x: 0.97, y: 0.98 }, 0.035, '#fff8dc');
  }
}

// --- the pacemaker: a robot on a bike ---------------------------------------------------

export interface RobotColors {
  /** Body panels. */
  metal: string;
  /** Joints, far-side limbs, tyres. */
  dark: string;
  /** Frame, visor, antenna tip and chest light. */
  accent: string;
}

/** Robot colours for a scene: light metal normally, all-neon where the scene is neon. */
export function robotColors(accent: string, neon: boolean): RobotColors {
  return neon
    ? { metal: accent, dark: shade(accent, 0.5), accent: '#ffffff' }
    : { metal: '#b9c3cd', dark: '#4a545f', accent };
}

/**
 * Draws the pacemaker: a boxy robot with an antenna and a glowing visor. Same bike units
 * and origin as drawRiderFigure.
 */
export function drawRobotFigure(ctx: CanvasRenderingContext2D, c: RobotColors, pose: RiderPose): void {
  ctx.lineJoin = 'round';

  const rear: Point = { x: 0, y: R };
  const front: Point = { x: 1.0, y: R };
  const bb: Point = { x: 0.42, y: 0.28 };
  const seat: Point = { x: 0.27, y: 0.93 };
  const head: Point = { x: 0.86, y: 0.9 };
  const bar: Point = { x: 0.95, y: 0.98 };
  const hip: Point = { x: 0.29, y: 1.0 };
  const shoulder: Point = { x: 0.68, y: 1.36 };
  const skull: Point = { x: 0.82, y: 1.56 };

  const line = (a: Point, b: Point, w: number, color: string, cap: CanvasLineCap = 'butt') => {
    ctx.lineCap = cap;
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  };
  const dot = (p: Point, r: number, color: string) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
  };

  const wheelAt = (hub: Point) => {
    for (let i = 0; i < 5; i++) {
      const a = -pose.wheel + (i * Math.PI * 2) / 5;
      line(hub, { x: hub.x + Math.cos(a) * (R - 0.04), y: hub.y + Math.sin(a) * (R - 0.04) }, 0.028, c.metal, 'round');
    }
    ctx.strokeStyle = c.dark;
    ctx.lineWidth = 0.055;
    ctx.beginPath();
    ctx.arc(hub.x, hub.y, R - 0.027, 0, Math.PI * 2);
    ctx.stroke();
    dot(hub, 0.04, c.accent);
  };

  // segmented leg: square-ended struts with a joint at the knee
  const leg = (a: number, far: boolean) => {
    const pedal: Point = { x: bb.x + Math.cos(-a) * 0.17, y: bb.y + Math.sin(-a) * 0.17 };
    const thigh = 0.45;
    const shin = 0.47;
    const dx = pedal.x - hip.x;
    const dy = pedal.y - hip.y;
    const dist = Math.min(thigh + shin - 0.001, Math.hypot(dx, dy));
    const along = (thigh * thigh - shin * shin + dist * dist) / (2 * dist);
    const off = Math.sqrt(Math.max(0, thigh * thigh - along * along));
    const ux = dx / dist;
    const uy = dy / dist;
    const k1: Point = { x: hip.x + ux * along + uy * off, y: hip.y + uy * along - ux * off };
    const k2: Point = { x: hip.x + ux * along - uy * off, y: hip.y + uy * along + ux * off };
    const knee = k1.x > k2.x ? k1 : k2;
    const strut = far ? c.dark : c.metal;
    line(bb, pedal, 0.03, c.dark, 'round');
    line(knee, pedal, 0.075, strut);
    line(hip, knee, 0.095, strut);
    dot(knee, 0.055, far ? c.dark : c.accent);
    ctx.fillStyle = c.dark;
    ctx.fillRect(pedal.x - 0.06, pedal.y - 0.035, 0.19, 0.07);
  };

  leg(pose.crank + Math.PI, true);
  wheelAt(rear);
  wheelAt(front);
  line(rear, bb, 0.035, c.accent, 'round');
  line(rear, seat, 0.03, c.accent, 'round');
  line(bb, seat, 0.04, c.accent, 'round');
  line(bb, head, 0.045, c.accent, 'round');
  line({ x: 0.3, y: 0.86 }, head, 0.04, c.accent, 'round');
  line(head, front, 0.035, c.accent, 'round');
  line(head, bar, 0.03, c.dark, 'round');
  line({ x: 0.2, y: 0.95 }, { x: 0.36, y: 0.95 }, 0.04, c.dark, 'round');
  leg(pose.crank, false);

  // torso: a slab from hip to shoulder, with a chest light
  line(hip, shoulder, 0.21, c.dark);
  line({ x: hip.x + 0.012, y: hip.y + 0.011 }, { x: shoulder.x - 0.012, y: shoulder.y - 0.011 }, 0.17, c.metal);
  dot({ x: (hip.x + shoulder.x) / 2 + 0.03, y: (hip.y + shoulder.y) / 2 + 0.02 }, 0.03, c.accent);
  dot(hip, 0.06, c.dark);

  // arm in two struts with an elbow
  const elbow: Point = { x: 0.86, y: 1.13 };
  line(shoulder, elbow, 0.07, c.metal);
  line(elbow, bar, 0.06, c.metal);
  dot(shoulder, 0.06, c.dark);
  dot(elbow, 0.045, c.accent);
  dot(bar, 0.045, c.dark);

  // head: a box tipped forward, with a visor and an antenna
  line(shoulder, skull, 0.05, c.dark);
  ctx.save();
  ctx.translate(skull.x, skull.y);
  ctx.rotate(-0.28);
  ctx.strokeStyle = c.dark;
  ctx.lineCap = 'round';
  ctx.lineWidth = 0.02;
  ctx.beginPath();
  ctx.moveTo(-0.05, 0.1);
  ctx.lineTo(-0.08, 0.24);
  ctx.stroke();
  dot({ x: -0.08, y: 0.25 }, 0.03, c.accent);
  ctx.fillStyle = c.metal;
  ctx.beginPath();
  ctx.roundRect(-0.13, -0.1, 0.26, 0.2, 0.035);
  ctx.fill();
  ctx.strokeStyle = c.dark;
  ctx.lineWidth = 0.018;
  ctx.stroke();
  ctx.fillStyle = c.dark;
  ctx.fillRect(0.0, -0.035, 0.125, 0.085);
  ctx.fillStyle = c.accent;
  ctx.fillRect(0.02, -0.015, 0.09, 0.045);
  ctx.restore();
}
