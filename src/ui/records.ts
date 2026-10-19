// Names and formatting for the personal records the server keeps (see server/records.ts).
import { fmtClock } from '../format.ts';
import { peakLabel } from '../ride/peaks.ts';
import { fmtAlt, fmtDist, fmtSpeed } from './units.ts';

const LABELS: Record<string, string> = {
  distance: 'Longest ride',
  duration: 'Longest time riding',
  ascent: 'Most climbing',
  work: 'Most work',
  avgPower: 'Highest average power',
  avgSpeed: 'Fastest average speed',
};

/** The order records are listed in. */
export const RECORD_ORDER = ['distance', 'duration', 'ascent', 'work', 'avgPower', 'avgSpeed'];

export function recordLabel(key: string): string {
  const peak = /^peak(\d+)$/.exec(key);
  if (peak) return `Best ${peakLabel(Number(peak[1]))} power`;
  return LABELS[key] ?? key;
}

export function formatRecord(key: string, value: number): string {
  switch (key) {
    case 'distance': return fmtDist(value);
    case 'duration': return fmtClock(value);
    case 'ascent': return fmtAlt(value);
    case 'work': return `${Math.round(value / 1000)} kJ`;
    case 'avgPower': return `${Math.round(value)} W`;
    case 'avgSpeed': return fmtSpeed(value);
    default: return `${Math.round(value)} W`;
  }
}

/** One sentence for the summary screen: "New records: longest ride and best 5 s power." */
export function recordsSentence(keys: string[]): string {
  const names = keys.map((k) => recordLabel(k).toLowerCase());
  if (names.length === 0) return '';
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `${names.length === 1 ? 'New record' : 'New records'}: ${list}.`;
}
