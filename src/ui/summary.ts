// Summary screen after a ride.

import { downloadFit } from '../ride/recorder.ts';
import { fmtClock, fmtKm, fmtLap, h } from './dom.ts';
import type { RideOutcome } from './ride.ts';

export function renderSummary(root: HTMLElement, outcome: RideOutcome, onDone: () => void): () => void {
  const { finished, laps, circuit, error } = outcome;
  const stat = (label: string, value: string) =>
    h('div', { class: 'stat' }, h('span', { class: 'stat-value' }, value), h('span', { class: 'stat-label' }, label));

  const stats = h('div', { class: 'stats' });
  if (finished) {
    const s = finished.summary;
    stats.append(
      stat('Time', fmtClock(s.durationS)),
      stat('Distance', `${fmtKm(s.distanceM)} km`),
      stat('Avg power', `${Math.round(s.avgPower)} W`),
      stat('Max power', `${Math.round(s.maxPower)} W`),
      stat('Avg speed', `${(s.avgSpeed * 3.6).toFixed(1)} km/h`),
      stat('Avg cadence', s.avgCadence > 0 ? `${Math.round(s.avgCadence)} rpm` : '--'),
      stat('Avg heart rate', s.avgHeartRate > 0 ? `${Math.round(s.avgHeartRate)} bpm` : '--'),
      stat('Climbed', `${Math.round(s.ascentM)} m`),
      stat('Burned (estimate)', `${s.calories} kcal`),
    );
  }

  const best = laps.reduce<number | null>((b, l) => (b === null || l.time < b ? l.time : b), null);
  const lapList = h('ol', { class: 'laps' },
    ...laps.map((l) =>
      h('li', { class: l.time === best ? 'best' : '' },
        h('span', null, `Lap ${l.number}`),
        h('span', null, `${fmtLap(l.time)}${l.time === best ? ' ★' : ''}`),
      ),
    ),
  );

  const download = h('button', { class: 'btn btn-primary' }, 'Download FIT file');
  download.addEventListener('click', () => {
    if (finished) downloadFit(finished.fit, finished.filename);
  });
  const done = h('button', { class: 'btn' }, 'Back to start');
  done.addEventListener('click', onDone);

  root.replaceChildren(
    h('main', { class: 'screen summary' },
      h('h1', null, circuit.name),
      error ? h('p', { class: 'note' }, error) : null,
      finished ? stats : null,
      laps.length > 0 ? h('section', null, h('h2', null, 'Laps'), lapList) : h('p', { class: 'note' }, 'No complete laps.'),
      finished
        ? h('p', { class: 'note' }, 'Import the file into Strava, Garmin Connect or intervals.icu.')
        : null,
      h('div', { class: 'row' }, finished ? download : null, done),
    ),
  );
  return () => {};
}
