// Canvas renderer: parallax scenery, terrain from the circuit profile, rider and ghost.

import type { Circuit } from '../ride/circuit.ts';
import { defaultRiderLook, drawRiderFigure, monoPaint, paintFor } from './rider.ts';
import type { RiderLook, RiderPaint } from './rider.ts';
import { findScene } from './scenes.ts';
import type { Palette, Scene as SceneStyle, SceneId } from './scenes.ts';
import { hash, makeCamera, noise, toScreenX, toScreenY, visibleRange } from './world.ts';
import type { Camera, Viewport } from './world.ts';

export interface Scene {
  /** Rider's world distance (m), interpolated. */
  distance: number;
  speed: number; // m/s
  cadence: number; // rpm
  /** Ghost's world distance, or null when there is no ghost. */
  ghostDistance: number | null;
  /** Seconds since the previous frame. */
  dt: number;
}

/** Scenery and rider are drawn larger than true scale so they read on a phone. */
const SPRITE_SCALE = 2.2;
const TREE_SLOT = 14; // metres between possible tree positions
const MARKER_EVERY = 500; // metres between distance signs

export function gradeColor(grade: number): string {
  const g = grade * 100;
  if (g < -1) return '#4dabf7';
  if (g < 1.5) return '#69db7c';
  if (g < 4) return '#ffd43b';
  if (g < 7) return '#ff922b';
  return '#fa5252';
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private viewport: Viewport = { width: 1, height: 1 };
  private dpr = 1;
  private observer: ResizeObserver | null = null;
  private wheelAngle = 0;
  private crankAngle = 0;
  private ghostCrank = 0;
  private anchorShift = 0;
  private profile: HTMLCanvasElement | null = null;
  private profileKey = '';
  private palette: Palette;
  private style: SceneStyle;
  private clock = 0;
  private riderPaint: RiderPaint;
  private ghostPaint: RiderPaint;

  constructor(
    private canvas: HTMLCanvasElement,
    private circuit: Circuit,
    scene: SceneId = circuit.scene,
    look: RiderLook = defaultRiderLook,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2d canvas is not available');
    this.ctx = ctx;
    this.style = findScene(scene);
    this.palette = this.style.palette;
    this.riderPaint = paintFor(look, this.style.riderOverride);
    this.ghostPaint = monoPaint(look, this.style.ghost);
    this.resize();
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(() => this.resize());
      this.observer.observe(canvas);
    }
  }

  destroy(): void {
    this.observer?.disconnect();
  }

  resize(): void {
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    this.dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    this.viewport = { width, height };
    const w = Math.round(width * this.dpr);
    const h = Math.round(height * this.dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  draw(scene: Scene): void {
    const { ctx, viewport, circuit } = this;
    const { width, height } = viewport;
    if (width < 2 || height < 2) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    const cam = makeCamera(viewport, scene.distance, circuit.altitudeAt(scene.distance));
    // on descents lift the rider so the road ahead stays in view
    const grade = circuit.gradeAt(scene.distance + 6);
    const target = Math.max(-0.2, Math.min(0.05, grade * cam.exaggeration * 0.6));
    this.anchorShift += (target - this.anchorShift) * Math.min(1, scene.dt * 2);
    cam.anchorY = height * (0.7 + this.anchorShift);

    const sprite = cam.pxPerM * SPRITE_SCALE;
    const wheelRadius = 0.34 * sprite;
    this.wheelAngle += (scene.speed * cam.pxPerM * scene.dt) / wheelRadius;
    this.crankAngle += (scene.cadence / 60) * Math.PI * 2 * scene.dt;
    this.ghostCrank += (85 / 60) * Math.PI * 2 * scene.dt;
    this.clock += scene.dt;

    this.drawSky(cam);
    this.drawRange(cam, 0.03, 0.34, 0.2, 0.012, this.palette.far, circuit.seed + 1);
    this.drawRange(cam, 0.1, 0.5, 0.16, 0.03, this.palette.mid, circuit.seed + 2);
    this.drawTrees(cam, sprite);
    this.drawGround(cam);
    this.drawMarkers(cam, sprite);

    if (scene.ghostDistance !== null) {
      const gx = toScreenX(cam, scene.ghostDistance);
      if (gx > -sprite * 2 && gx < width + sprite * 2) {
        this.drawRider(cam, scene.ghostDistance, sprite, this.ghostCrank, this.wheelAngle, true);
      } else {
        this.drawGhostArrow(cam, gx < 0 ? -1 : 1);
      }
    }
    this.drawRider(cam, scene.distance, sprite, this.crankAngle, this.wheelAngle, false);
    if (this.style.rain) this.drawRain(scene.speed);
    this.drawProfile(scene);
  }

  private drawSky(cam: Camera): void {
    const { ctx, viewport, palette, style } = this;
    const { width, height } = viewport;
    const sky = ctx.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, palette.skyTop);
    sky.addColorStop(0.75, palette.skyBottom);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height);

    if (style.stars) {
      const count = Math.round(Math.min(140, (width * height) / 5000));
      for (let i = 0; i < count; i++) {
        const x = hash(i, 101) * width;
        const y = hash(i, 202) * height * 0.6;
        const twinkle = 0.45 + 0.55 * Math.abs(Math.sin(this.clock * (0.6 + hash(i, 303)) + i));
        ctx.fillStyle = `rgba(255,255,255,${(twinkle * (0.4 + hash(i, 404) * 0.6)).toFixed(3)})`;
        const size = hash(i, 505) > 0.85 ? 2 : 1.2;
        ctx.fillRect(x, y, size, size);
      }
    }

    const orbX = width * 0.78 - ((cam.distance * 0.004 * cam.pxPerM) % (width * 0.2));
    const orbY = height * 0.24;
    const r = Math.min(width, height) * 0.07;

    if (style.sky === 'overcast') {
      // slow cloud bank, no sun
      for (let i = 0; i < 9; i++) {
        const span = width + 400;
        const x = ((hash(i, 11) * span + this.clock * (4 + hash(i, 12) * 6) - cam.distance * 0.05) % span + span) % span - 200;
        const y = height * (0.06 + hash(i, 13) * 0.3);
        const w = width * (0.22 + hash(i, 14) * 0.2);
        ctx.fillStyle = `rgba(${i % 2 ? '70,78,92' : '150,160,175'},0.28)`;
        ctx.beginPath();
        ctx.ellipse(x, y, w, w * 0.22, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      return;
    }

    if (style.sky === 'synth') {
      const R = r * 2.2;
      const cy = height * 0.42;
      const fill = ctx.createLinearGradient(0, cy - R, 0, cy + R);
      fill.addColorStop(0, palette.orb);
      fill.addColorStop(1, palette.accent);
      ctx.save();
      ctx.beginPath();
      ctx.arc(width * 0.62, cy, R, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = fill;
      ctx.fillRect(width * 0.62 - R, cy - R, R * 2, R * 2);
      ctx.fillStyle = palette.skyBottom;
      for (let i = 0; i < 6; i++) {
        const y = cy + R * (0.08 + i * 0.16);
        ctx.fillRect(width * 0.62 - R, y, R * 2, 2 + i * 1.6);
      }
      ctx.restore();
      return;
    }

    const glow = ctx.createRadialGradient(orbX, orbY, r * 0.2, orbX, orbY, r * 3);
    glow.addColorStop(0, style.sky === 'moon' ? 'rgba(200,215,255,0.35)' : palette.orb);
    glow.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(orbX - r * 3, orbY - r * 3, r * 6, r * 6);
    ctx.fillStyle = palette.orb;
    ctx.beginPath();
    ctx.arc(orbX, orbY, style.sky === 'moon' ? r * 0.8 : r, 0, Math.PI * 2);
    ctx.fill();
    if (style.sky === 'moon') {
      ctx.fillStyle = 'rgba(150,165,190,0.5)';
      for (const [dx, dy, cr] of [[-0.25, -0.2, 0.16], [0.2, 0.15, 0.22], [-0.1, 0.35, 0.1]]) {
        ctx.beginPath();
        ctx.arc(orbX + dx * r, orbY + dy * r, cr * r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  /** A ridge line that scrolls slower than the road. */
  private drawRange(
    cam: Camera, parallax: number, base: number, amplitude: number, frequency: number,
    color: string, seed: number,
  ): void {
    const { ctx, viewport, circuit } = this;
    const { width, height } = viewport;
    const offset = cam.distance * parallax * cam.pxPerM;
    const range = Math.max(1, circuit.maxAltitude - circuit.minAltitude);
    const lift = ((cam.altitude - circuit.minAltitude) / range) * height * 0.06 * (parallax * 10);
    const step = Math.max(6, width / 90);
    const ridge = new Path2D();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, height);
    for (let x = 0; x <= width + step; x += step) {
      const u = (x + offset) * frequency;
      const n = noise(u, seed) * 0.65 + noise(u * 2.7, seed + 7) * 0.35;
      // neon ridges are angular: snap the noise to steps
      const v = this.style.neon ? Math.round(n * 7) / 7 : n;
      const y = height * (base + (1 - v) * amplitude) + lift;
      ctx.lineTo(x, y);
      ridge.lineTo(x, y);
    }
    ctx.lineTo(width + step, height);
    ctx.closePath();
    ctx.fill();
    if (this.style.neon) {
      const edge = parallax < 0.05 ? this.palette.accent : this.palette.outline;
      this.glowStroke(ridge, edge, 1.5, 0.5);
    }
  }

  private drawTrees(cam: Camera, sprite: number): void {
    const { ctx, viewport, circuit, palette } = this;
    const [d0, d1] = visibleRange(cam, viewport);
    const slots = Math.max(1, Math.round(circuit.length / TREE_SLOT));
    const slotLength = circuit.length / slots;
    const first = Math.floor((d0 - 6) / slotLength);
    const last = Math.ceil((d1 + 6) / slotLength);
    for (let s = first; s <= last; s++) {
      const id = ((s % slots) + slots) % slots;
      if (hash(id, circuit.seed) > 0.55) continue;
      const d = (s + hash(id, circuit.seed + 3) * 0.8) * slotLength;
      const x = toScreenX(cam, d);
      const y = toScreenY(cam, circuit.altitudeAt(d)) + 2;
      const size = sprite * (1.6 + hash(id, circuit.seed + 5) * 1.6);
      if (this.style.neon) {
        const shape = new Path2D();
        shape.moveTo(x, y);
        shape.lineTo(x, y - size * 0.35);
        shape.moveTo(x - size * 0.3, y - size * 0.35);
        shape.lineTo(x, y - size * 1.2);
        shape.lineTo(x + size * 0.3, y - size * 0.35);
        shape.closePath();
        shape.moveTo(x - size * 0.18, y - size * 0.68);
        shape.lineTo(x + size * 0.18, y - size * 0.68);
        this.glowStroke(shape, hash(id, circuit.seed + 9) > 0.5 ? palette.accent : palette.outline, 1.5, 0.35);
        continue;
      }
      ctx.fillStyle = palette.trunk;
      ctx.fillRect(x - size * 0.05, y - size * 0.4, size * 0.1, size * 0.42);
      ctx.fillStyle = palette.tree;
      if (hash(id, circuit.seed + 9) > 0.5) {
        ctx.beginPath();
        ctx.moveTo(x, y - size * 1.25);
        ctx.lineTo(x + size * 0.34, y - size * 0.3);
        ctx.lineTo(x - size * 0.34, y - size * 0.3);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(x, y - size * 0.75, size * 0.38, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  private drawGround(cam: Camera): void {
    const { ctx, viewport, circuit, palette } = this;
    const { width, height } = viewport;
    const [d0, d1] = visibleRange(cam, viewport);
    const step = Math.max(0.4, (d1 - d0) / 120);
    const start = Math.floor(d0 / step) * step;

    ctx.beginPath();
    for (let d = start; d <= d1 + step; d += step) {
      ctx.lineTo(toScreenX(cam, d), toScreenY(cam, circuit.altitudeAt(d)));
    }
    const road = new Path2D();
    for (let d = start; d <= d1 + step; d += step) {
      road.lineTo(toScreenX(cam, d), toScreenY(cam, circuit.altitudeAt(d)));
    }
    ctx.lineTo(width + 10, height + 10);
    ctx.lineTo(-10, height + 10);
    ctx.closePath();
    const fill = ctx.createLinearGradient(0, cam.anchorY - height * 0.2, 0, height);
    fill.addColorStop(0, palette.ground);
    fill.addColorStop(1, palette.groundDeep);
    ctx.fillStyle = fill;
    ctx.fill();

    const thickness = Math.max(5, cam.pxPerM * 0.45);

    if (this.style.neon) {
      // grid: verticals fixed to the world, horizontals following the road
      ctx.strokeStyle = palette.accent;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.28;
      ctx.beginPath();
      const cell = 4;
      for (let d = Math.floor(d0 / cell) * cell; d <= d1; d += cell) {
        const x = toScreenX(cam, d);
        ctx.moveTo(x, toScreenY(cam, circuit.altitudeAt(d)) + thickness);
        ctx.lineTo(x, height);
      }
      ctx.stroke();
      for (let k = 1; k <= 7; k++) {
        ctx.save();
        ctx.translate(0, thickness + k * k * 5);
        ctx.globalAlpha = 0.3 - k * 0.03;
        ctx.stroke(road);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    }

    ctx.save();
    ctx.translate(0, thickness / 2);
    ctx.lineJoin = 'round';
    ctx.strokeStyle = palette.road;
    ctx.lineWidth = thickness;
    ctx.stroke(road);
    ctx.restore();

    if (this.style.neon) {
      this.glowStroke(road, palette.outline, 2, 0.45);
    } else if (this.style.rain) {
      // wet sheen along the top of the road
      ctx.save();
      ctx.translate(0, 1.5);
      ctx.strokeStyle = 'rgba(210,225,245,0.28)';
      ctx.lineWidth = 2;
      ctx.stroke(road);
      ctx.restore();
    }

    // dashes painted on the road give a sense of speed
    ctx.fillStyle = palette.dash;
    const dash = 4;
    for (let d = Math.floor(d0 / dash) * dash; d <= d1; d += dash) {
      const x = toScreenX(cam, d);
      const y = toScreenY(cam, circuit.altitudeAt(d));
      const x2 = toScreenX(cam, d + 1.2);
      const y2 = toScreenY(cam, circuit.altitudeAt(d + 1.2));
      ctx.save();
      ctx.translate(x, y + thickness * 0.5);
      ctx.rotate(Math.atan2(y2 - y, x2 - x));
      ctx.fillRect(0, -1, Math.hypot(x2 - x, y2 - y), 2);
      ctx.restore();
    }
  }

  private drawMarkers(cam: Camera, sprite: number): void {
    const { ctx, viewport, circuit } = this;
    const [d0, d1] = visibleRange(cam, viewport);
    const length = circuit.length;

    // distance signs
    for (let d = Math.ceil((d0 - 2) / MARKER_EVERY) * MARKER_EVERY; d <= d1 + 2; d += MARKER_EVERY) {
      const inLap = ((d % length) + length) % length;
      if (inLap < 1 || length - inLap < 1) continue;
      const x = toScreenX(cam, d);
      const y = toScreenY(cam, circuit.altitudeAt(d));
      const h = sprite * 1.1;
      ctx.fillStyle = '#d9d9d9';
      ctx.fillRect(x - 1.5, y - h, 3, h);
      const label = `${(inLap / 1000).toFixed(1)} km`;
      ctx.font = `600 ${Math.max(10, sprite * 0.26)}px system-ui, sans-serif`;
      const w = ctx.measureText(label).width + 10;
      ctx.fillStyle = '#1c7ed6';
      ctx.fillRect(x - w / 2, y - h - sprite * 0.36, w, sprite * 0.4);
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, x, y - h - sprite * 0.16);
    }

    // start / finish arch at every lap line
    for (let d = Math.ceil((d0 - 3) / length) * length; d <= d1 + 3; d += length) {
      const x = toScreenX(cam, d);
      const y = toScreenY(cam, circuit.altitudeAt(d));
      const h = sprite * 2.5;
      const w = sprite * 0.5;
      ctx.fillStyle = '#f1f3f5';
      ctx.fillRect(x - 2.5, y - h, 5, h);
      const cell = w / 2;
      for (let r = 0; r < 2; r++) {
        for (let c = 0; c < 6; c++) {
          ctx.fillStyle = (r + c) % 2 === 0 ? '#111' : '#fff';
          ctx.fillRect(x - cell * 3 + c * cell, y - h - cell * 2 + r * cell, cell, cell);
        }
      }
    }
  }

  private drawRider(
    cam: Camera, distance: number, s: number, crank: number, wheel: number, ghost: boolean,
  ): void {
    const { ctx, circuit } = this;
    const half = (0.5 * s) / cam.pxPerM;
    const xr = toScreenX(cam, distance - half);
    const yr = toScreenY(cam, circuit.altitudeAt(distance - half));
    const xf = toScreenX(cam, distance + half);
    const yf = toScreenY(cam, circuit.altitudeAt(distance + half));
    const angle = Math.atan2(yf - yr, xf - xr);

    ctx.save();
    ctx.translate(xr, yr);
    ctx.rotate(angle);
    ctx.scale(s, -s); // bike units: metres, x forward, y up, origin at the rear contact patch
    if (ghost) ctx.globalAlpha = this.style.neon ? 0.6 : 0.4;
    drawRiderFigure(ctx, ghost ? this.ghostPaint : this.riderPaint, {
      crank, wheel, headlight: this.style.headlight && !ghost,
    });
    ctx.restore();
  }

  private drawGhostArrow(cam: Camera, side: -1 | 1): void {
    const { ctx, viewport } = this;
    const x = side < 0 ? 16 : viewport.width - 16;
    const y = cam.anchorY - viewport.height * 0.12;
    ctx.fillStyle = this.style.ghost;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.moveTo(x + side * 8, y);
    ctx.lineTo(x - side * 6, y - 10);
    ctx.lineTo(x - side * 6, y + 10);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  /** A bright line with a soft halo, cheaper than canvas shadows. */
  private glowStroke(path: Path2D, color: string, width: number, haloAlpha: number): void {
    const { ctx } = this;
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.strokeStyle = color;
    ctx.globalAlpha = haloAlpha;
    ctx.lineWidth = width * 4;
    ctx.stroke(path);
    ctx.globalAlpha = 1;
    ctx.lineWidth = width;
    ctx.stroke(path);
    ctx.restore();
  }

  /** Streaks slanting back as the rider speeds up. */
  private drawRain(speed: number): void {
    const { ctx, viewport } = this;
    const { width, height } = viewport;
    const count = Math.round(Math.min(170, (width * height) / 4500));
    const slant = 0.18 + Math.min(0.7, speed / 18);
    const span = width + height * slant + 40;
    ctx.strokeStyle = 'rgba(205,222,245,0.42)';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    for (let i = 0; i < count; i++) {
      const fall = 620 + hash(i, 21) * 520;
      const len = 12 + hash(i, 22) * 16;
      const y = ((hash(i, 23) * (height + 80) + this.clock * fall) % (height + 80)) - 40;
      const x = ((hash(i, 24) * span - y * slant) % span + span) % span - 20;
      ctx.moveTo(x, y);
      ctx.lineTo(x - len * slant, y + len);
    }
    ctx.stroke();
    ctx.fillStyle = 'rgba(40,50,65,0.12)';
    ctx.fillRect(0, 0, width, height);
  }

  /** Whole-lap elevation strip at the top with rider and ghost dots. */
  private drawProfile(scene: Scene): void {
    const { ctx, viewport, circuit } = this;
    const w = Math.round(Math.min(viewport.width * 0.42, 460));
    const h = Math.round(Math.max(30, Math.min(52, viewport.height * 0.11)));
    const x0 = Math.round((viewport.width - w) / 2);
    const y0 = 10;
    const pad = 6;
    const key = `${w}x${h}@${this.dpr}`;
    if (!this.profile || this.profileKey !== key) {
      const c = document.createElement('canvas');
      c.width = Math.round(w * this.dpr);
      c.height = Math.round(h * this.dpr);
      const p = c.getContext('2d')!;
      p.scale(this.dpr, this.dpr);
      p.fillStyle = 'rgba(10,16,24,0.55)';
      p.beginPath();
      p.roundRect(0, 0, w, h, 8);
      p.fill();
      const range = Math.max(8, circuit.maxAltitude - circuit.minAltitude);
      const n = w - pad * 2;
      for (let i = 0; i < n; i++) {
        const d = (i / n) * circuit.length;
        const a = (circuit.altitudeAt(d) - circuit.minAltitude) / range;
        const bar = 3 + a * (h - pad * 2 - 3);
        p.fillStyle = gradeColor(circuit.gradeAt(d));
        p.fillRect(pad + i, h - pad - bar, 1.2, bar);
      }
      this.profile = c;
      this.profileKey = key;
    }
    ctx.drawImage(this.profile, x0, y0, w, h);

    const range = Math.max(8, circuit.maxAltitude - circuit.minAltitude);
    const dot = (distance: number, color: string, radius: number) => {
      const inLap = ((distance % circuit.length) + circuit.length) % circuit.length;
      const a = (circuit.altitudeAt(inLap) - circuit.minAltitude) / range;
      const x = x0 + pad + (inLap / circuit.length) * (w - pad * 2);
      const y = y0 + h - pad - (3 + a * (h - pad * 2 - 3));
      ctx.fillStyle = color;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    };
    if (scene.ghostDistance !== null) dot(scene.ghostDistance, '#a5d8ff', 3.5);
    dot(scene.distance, '#ffffff', 4.5);
  }
}
