// Summary screen after a ride.

import { downloadFit } from '../ride/recorder.ts';
import { describeSegment } from '../ride/segments.ts';
import { lineChart } from './chart.ts';
import { fmtClock, fmtKm, fmtLap, h } from './dom.ts';
import type { RideOutcome } from './ride.ts';

export function renderSummary(root: HTMLElement, outcome: RideOutcome, onDone: () => void): () => void {
  const { finished, laps, efforts, circuit, error, pacer, workout } = outcome;
  const workoutLine = workout
    ? workout.ridden >= workout.duration
      ? `Workout: ${workout.name}, completed (${fmtClock(workout.duration)}).`
      : `Workout: ${workout.name}, ${fmtClock(workout.ridden)} of ${fmtClock(workout.duration)} ridden.`
    : null;
  const pacerLine = pacer
    ? (() => {
      const s = Math.abs(pacer.gap.seconds);
      const m = Math.abs(pacer.gap.metres);
      const dist = m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
      const time = s >= 60 ? fmtClock(s) : `${s.toFixed(1)} s`;
      return pacer.gap.metres > 0
        ? `You finished ${time} (${dist}) behind the ${workout ? 'workout' : `${pacer.power} W`} pacemaker.`
        : `You finished ${time} (${dist}) ahead of the ${workout ? 'workout' : `${pacer.power} W`} pacemaker.`;
    })()
    : null;
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

  // Two measures on different scales get a chart each, never a shared axis.
  const charts = h('section', { class: 'charts' });
  if (finished && finished.ride.samples.length > 1) {
    const samples = finished.ride.samples;
    const s = finished.summary;
    charts.append(
      lineChart({
        title: 'Power', unit: 'W', color: '#3987e5', zeroBased: true,
        values: samples.map((x) => x.power),
        summary: `avg ${Math.round(s.avgPower)} W \u00B7 max ${Math.round(s.maxPower)} W`,
      }),
    );
    const heart = samples.map((x) => (x.heartRate > 0 ? x.heartRate : null));
    const readings = heart.filter((v): v is number => v !== null);
    if (readings.length > 1) {
      charts.append(
        lineChart({
          title: 'Heart rate', unit: 'bpm', color: '#e66767', zeroBased: false, values: heart,
          summary: `avg ${Math.round(s.avgHeartRate)} bpm \u00B7 max ${Math.round(Math.max(...readings))} bpm`,
        }),
      );
    } else {
      charts.append(h('p', { class: 'note' }, 'No heart-rate data was recorded, so there is no heart-rate graph.'));
    }
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

  const effortList = h('ol', { class: 'laps' },
    ...efforts.map((e) => {
      const versus = e.restored
        ? 'before the break'
        : e.previousBest === null
        ? 'first time'
        : e.isBest
          ? `\u2605 best by ${(e.previousBest - e.time).toFixed(1)} s`
          : `+${(e.time - e.previousBest).toFixed(1)} s`;
      return h('li', { class: e.isBest && e.previousBest !== null ? 'best' : '' },
        h('span', null, e.segment.name, h('em', { class: 'seg-desc' }, describeSegment(e.segment))),
        h('span', null, `${fmtLap(e.time)}  `, h('em', { class: 'seg-desc' }, versus)),
      );
    }),
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
      workoutLine ? h('p', { class: 'pacer-result' }, workoutLine) : null,
      pacerLine ? h('p', { class: 'pacer-result' }, pacerLine) : null,
      charts.childElementCount > 0 ? charts : null,
      laps.length > 0 ? h('section', null, h('h2', null, 'Laps'), lapList) : h('p', { class: 'note' }, 'No complete laps.'),
      efforts.length > 0 ? h('section', null, h('h2', null, 'Segments'), effortList) : null,
      finished
        ? h('p', { class: 'note' }, 'Import the file into Strava, Garmin Connect or intervals.icu.')
        : null,
      h('div', { class: 'row' }, finished ? download : null, done),
    ),
  );
  return () => {};
}
