// World (distance, altitude) to screen transforms.

export interface Viewport {
  width: number; // CSS px
  height: number; // CSS px
}

export interface Camera {
  /** World distance (m) shown at anchorX. */
  distance: number;
  /** World altitude (m) shown at anchorY. */
  altitude: number;
  pxPerM: number;
  /** Vertical exaggeration so gradients read clearly. */
  exaggeration: number;
  anchorX: number;
  anchorY: number;
}

export const EXAGGERATION = 3;

/** Metres of road visible across the screen. */
export function viewMeters(viewport: Viewport): number {
  const aspect = viewport.width / Math.max(1, viewport.height);
  return Math.min(60, Math.max(22, 26 * aspect));
}

export function makeCamera(viewport: Viewport, distance: number, altitude: number): Camera {
  return {
    distance,
    altitude,
    pxPerM: viewport.width / viewMeters(viewport),
    exaggeration: EXAGGERATION,
    anchorX: viewport.width * 0.36,
    anchorY: viewport.height * 0.7,
  };
}

export function toScreenX(cam: Camera, distance: number): number {
  return cam.anchorX + (distance - cam.distance) * cam.pxPerM;
}

export function toScreenY(cam: Camera, altitude: number): number {
  return cam.anchorY - (altitude - cam.altitude) * cam.pxPerM * cam.exaggeration;
}

/** World distances at the left and right screen edges. */
export function visibleRange(cam: Camera, viewport: Viewport): [number, number] {
  return [
    cam.distance - cam.anchorX / cam.pxPerM,
    cam.distance + (viewport.width - cam.anchorX) / cam.pxPerM,
  ];
}

/** On-screen road angle in radians (positive = uphill) for a gradient fraction. */
export function slopeAngle(grade: number, exaggeration = EXAGGERATION): number {
  return Math.atan(grade * exaggeration);
}

/** Deterministic pseudo-random number in [0, 1) from an integer and a seed. */
export function hash(n: number, seed: number): number {
  let x = (Math.imul(n | 0, 374761393) + Math.imul(seed | 0, 668265263)) | 0;
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

/** Smooth 1-D value noise in [0, 1). */
export function noise(x: number, seed: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return hash(i, seed) * (1 - u) + hash(i + 1, seed) * u;
}
