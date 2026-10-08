// Power zones as fractions of FTP (Coggan's seven), with the colours used wherever effort is shown.

export interface PowerZone {
  /** 1..7 */
  zone: number;
  name: string;
  /** Lower bound as a fraction of FTP; the first starts at 0. */
  from: number;
  color: string;
}

export const POWER_ZONES: readonly PowerZone[] = [
  { zone: 1, name: 'Recovery', from: 0, color: '#868e96' },
  { zone: 2, name: 'Endurance', from: 0.55, color: '#339af0' },
  { zone: 3, name: 'Tempo', from: 0.76, color: '#51cf66' },
  { zone: 4, name: 'Threshold', from: 0.91, color: '#fcc419' },
  { zone: 5, name: 'VO2max', from: 1.06, color: '#ff922b' },
  { zone: 6, name: 'Anaerobic', from: 1.21, color: '#f03e3e' },
  { zone: 7, name: 'Sprint', from: 1.51, color: '#be4bdb' },
];

/** Zone 1..7 for a power, or 0 when there is no power or no usable FTP. */
export function powerZone(watts: number, ftp: number): number {
  if (!(watts > 0) || !(ftp > 0)) return 0;
  const ratio = watts / ftp;
  let zone = 1;
  for (const z of POWER_ZONES) if (ratio >= z.from) zone = z.zone;
  return zone;
}

export function zoneColor(zone: number): string {
  return POWER_ZONES[Math.min(POWER_ZONES.length, Math.max(1, zone)) - 1].color;
}

/** Seconds spent in each zone (index 0 is "no power"), one sample per second. */
export function timeInZones(power: Array<number | null>, ftp: number): number[] {
  const out = new Array(POWER_ZONES.length + 1).fill(0);
  for (const p of power) out[powerZone(p ?? 0, ftp)]++;
  return out;
}
