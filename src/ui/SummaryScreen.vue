<script setup lang="ts">
// Summary screen after a ride.
import { computed } from 'vue';
import { fmtClock, fmtKm, fmtLap } from '../format.ts';
import type { RideOutcome } from '../ride/outcome.ts';
import { downloadFit } from '../ride/recorder.ts';
import { account } from '../account/session.ts';
import { uploads } from '../sync/upload-queue.ts';
import { PEAK_WINDOWS, peakLabel, peakPowers } from '../ride/peaks.ts';
import { describeSegment } from '../ride/segments.ts';
import type { SegmentEffort } from '../ride/segments.ts';
import LineChart from './LineChart.vue';

const props = defineProps<{ outcome: RideOutcome }>();
const emit = defineEmits<{ done: [] }>();

const finished = computed(() => props.outcome.finished);

const workoutLine = computed(() => {
  const workout = props.outcome.workout;
  if (!workout) return null;
  return workout.ridden >= workout.duration
    ? `Workout: ${workout.name}, completed (${fmtClock(workout.duration)}).`
    : `Workout: ${workout.name}, ${fmtClock(workout.ridden)} of ${fmtClock(workout.duration)} ridden.`;
});

const pacerLine = computed(() => {
  const { pacer, workout } = props.outcome;
  if (!pacer) return null;
  const s = Math.abs(pacer.gap.seconds);
  const m = Math.abs(pacer.gap.metres);
  const dist = m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
  const time = s >= 60 ? fmtClock(s) : `${s.toFixed(1)} s`;
  const who = workout ? 'workout' : `${pacer.power} W`;
  return pacer.gap.metres > 0
    ? `You finished ${time} (${dist}) behind the ${who} pacemaker.`
    : `You finished ${time} (${dist}) ahead of the ${who} pacemaker.`;
});

const stats = computed(() => {
  const f = finished.value;
  if (!f) return [];
  const s = f.summary;
  return [
    ['Time', fmtClock(s.durationS)],
    ['Distance', `${fmtKm(s.distanceM)} km`],
    ['Avg power', `${Math.round(s.avgPower)} W`],
    ['Max power', `${Math.round(s.maxPower)} W`],
    ['Avg speed', `${(s.avgSpeed * 3.6).toFixed(1)} km/h`],
    ['Avg cadence', s.avgCadence > 0 ? `${Math.round(s.avgCadence)} rpm` : '--'],
    ['Avg heart rate', s.avgHeartRate > 0 ? `${Math.round(s.avgHeartRate)} bpm` : '--'],
    ['Climbed', `${Math.round(s.ascentM)} m`],
    ['Burned (estimate)', `${s.calories} kcal`],
  ] as Array<[string, string]>;
});

/** Best average power over each window the ride was long enough for. */
const peaks = computed(() => {
  const f = finished.value;
  if (!f) return [] as Array<[string, string]>;
  const p = peakPowers(f.ride.samples.map((s) => s.power));
  return PEAK_WINDOWS.filter((w) => p[w] !== undefined).map((w) => [peakLabel(w), `${p[w]} W`] as [string, string]);
});

// Power and heart rate share one chart, each on its own axis.
const hasCharts = computed(() => !!finished.value && finished.value.ride.samples.length > 1);
const powerChart = computed(() => {
  const f = finished.value;
  if (!f) return null;
  return {
    values: f.ride.samples.map((x) => x.power),
    summary: `avg ${Math.round(f.summary.avgPower)} W · max ${Math.round(f.summary.maxPower)} W`,
  };
});
const heartChart = computed(() => {
  const f = finished.value;
  if (!f) return null;
  const values = f.ride.samples.map((x) => (x.heartRate > 0 ? x.heartRate : null));
  const readings = values.filter((v): v is number => v !== null);
  if (readings.length <= 1) return null;
  return {
    values,
    summary: `avg ${Math.round(f.summary.avgHeartRate)} bpm · max ${Math.round(Math.max(...readings))} bpm`,
  };
});
const heartSeries = computed(() => (heartChart.value ? { ...heartChart.value, title: 'Heart rate', unit: 'bpm', color: '#e66767', zeroBased: false } : null));

const bestLap = computed(() =>
  props.outcome.laps.reduce<number | null>((b, l) => (b === null || l.time < b ? l.time : b), null),
);

function versus(e: SegmentEffort): string {
  if (e.restored) return 'before the break';
  if (e.previousBest === null) return 'first time';
  return e.isBest ? `★ best by ${(e.previousBest - e.time).toFixed(1)} s` : `+${(e.time - e.previousBest).toFixed(1)} s`;
}

function download() {
  const f = finished.value;
  if (f) downloadFit(f.fit, f.filename);
}
</script>

<template>
  <main class="screen summary">
    <h1>{{ outcome.circuit.name }}</h1>
    <p v-if="outcome.error" class="note">{{ outcome.error }}</p>
    <div v-if="finished" class="stats">
      <div v-for="[label, value] in stats" :key="label" class="stat">
        <span class="stat-value">{{ value }}</span>
        <span class="stat-label">{{ label }}</span>
      </div>
    </div>
    <section v-if="peaks.length > 0">
      <h2>Best power</h2>
      <div class="stats peaks">
        <div v-for="[label, value] in peaks" :key="label" class="stat">
          <span class="stat-value">{{ value }}</span>
          <span class="stat-label">{{ label }}</span>
        </div>
      </div>
    </section>
    <p v-if="workoutLine" class="pacer-result">{{ workoutLine }}</p>
    <p v-if="pacerLine" class="pacer-result">{{ pacerLine }}</p>
    <section v-if="hasCharts && powerChart" class="charts">
      <LineChart title="Power" unit="W" color="#3987e5" :zero-based="true" :values="powerChart.values" :summary="powerChart.summary" :secondary="heartSeries" />
      <p v-if="!heartChart" class="note">No heart-rate data was recorded, so there is no heart-rate line.</p>
    </section>
    <section v-if="outcome.laps.length > 0">
      <h2>Laps</h2>
      <ol class="laps">
        <li v-for="l in outcome.laps" :key="l.number" :class="l.time === bestLap ? 'best' : ''">
          <span>Lap {{ l.number }}</span>
          <span>{{ fmtLap(l.time) }}{{ l.time === bestLap ? ' ★' : '' }}</span>
        </li>
      </ol>
    </section>
    <p v-else class="note">No complete laps.</p>
    <section v-if="outcome.efforts.length > 0">
      <h2>Segments</h2>
      <ol class="laps">
        <li v-for="(e, i) in outcome.efforts" :key="i" :class="e.isBest && e.previousBest !== null ? 'best' : ''">
          <span>{{ e.segment.name }}<em class="seg-desc">{{ describeSegment(e.segment) }}</em></span>
          <span>{{ fmtLap(e.time) }}  <em class="seg-desc">{{ versus(e) }}</em></span>
        </li>
      </ol>
    </section>
    <p v-if="finished" class="note">Import the file into Strava, Garmin Connect or intervals.icu.</p>
    <div class="row">
      <button v-if="finished" class="btn btn-primary" @click="download">Download FIT file</button>
      <span v-if="finished && outcome.simulated" class="upload-status">Simulated ride: not counted, not saved to your account</span>
      <span v-else-if="finished && account.status !== 'in'" class="upload-status">Sign in to keep your rides and send them to intervals.icu</span>
      <span v-else-if="finished" class="upload-status">
        {{ uploads.last === 'saved' && uploads.pending === 0 ? 'Saved to your account' : uploads.last === 'uploading' ? 'Uploading…' : uploads.last === 'failed' ? 'Could not be saved to your account' : 'Will be uploaded when you\u2019re online' }}<template v-if="uploads.last === 'saved' && uploads.pending === 0 && uploads.intervals"> · {{ uploads.intervals === 'sent' ? 'sent to intervals.icu' : 'intervals.icu upload failed; retry from My rides' }}</template>
      </span>
      <button class="btn" @click="emit('done')">Back to start</button>
    </div>
  </main>
</template>
