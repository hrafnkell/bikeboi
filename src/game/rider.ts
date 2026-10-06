// The rider and bike: customisable look, and the drawing shared by the game and the preview.

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
  const bar: Point = { x: 0.95, y: 0.98 };
  const hip: Point = { x: 0.29, y: 1.0 };
  const shoulder: Point = { x: 0.7, y: 1.38 };
  const noggin: Point = { x: 0.83, y: 1.55 };

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
  line(head, bar, 0.03, paint.parts);
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
