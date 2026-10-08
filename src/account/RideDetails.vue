<script setup lang="ts">
// Graphs for one ride from the account: the circuit, elevation, and power with heart rate.
import { computed, onMounted, ref } from 'vue';
import { ApiError } from '../api/client.ts';
import { readFitTrack } from '../ride/fit-read.ts';
import type { FitTrack } from '../ride/fit-read.ts';
import { circuits } from '../ride/circuits/index.ts';
import type { Circuit } from '../ride/circuit.ts';
import LineChart from '../ui/LineChart.vue';
import { settings } from '../state.ts';
import { describeError } from './session.ts';

const props = defineProps<{ rideId: string; circuitId: string }>();

const track = ref<FitTrack | null>(null);
const error = ref('');

/** One-per-second series for the chart: the recorder wrote one record a second, with gaps when paused. */
function perSecond<T>(t: FitTrack, values: T[], fill: T): T[] {
  const last = t.seconds[t.seconds.length - 1] ?? 0;
  const out: T[] = new Array(last + 1).fill(fill);
  t.seconds.forEach((s, i) => (out[s] = values[i]));
  return out;
}

const circuit = computed<Circuit | null>(() => circuits.find((c) => c.id === props.circuitId) ?? null);
const profilePoints = computed(() => {
  const c = circuit.value;
  if (!c) return '';
  const W = 300;
  const H = 48;
  const range = Math.max(8, c.maxAltitude - c.minAltitude);
  const pts = [`0,${H}`];
  for (let i = 0; i <= 120; i++) {
    const a = (c.altitudeAt((i / 120) * c.length) - c.minAltitude) / range;
    pts.push(`${((i / 120) * W).toFixed(1)},${(H - 4 - a * (H - 10)).toFixed(1)}`);
  }
  pts.push(`${W},${H}`);
  return pts.join(' ');
});

const power = computed(() => (track.value ? perSecond(track.value, track.value.power, null as number | null) : []));
const heart = computed(() => (track.value ? perSecond(track.value, track.value.heartRate, null) : []));
const altitude = computed(() => (track.value ? perSecond(track.value, track.value.altitude, null as number | null) : []));
const hasHeart = computed(() => heart.value.filter((h) => h !== null).length > 1);
const stats = (xs: Array<number | null>) => {
  const v = xs.filter((x): x is number => x !== null);
  return { avg: v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : 0, max: v.length ? Math.round(Math.max(...v)) : 0 };
};

onMounted(async () => {
  try {
    const res = await fetch(`/api/rides/${encodeURIComponent(props.rideId)}/fit`, { credentials: 'include', cache: 'no-store' });
    if (!res.ok) throw new ApiError(res.status, 'could not load the ride file');
    track.value = await readFitTrack(new Uint8Array(await res.arrayBuffer()));
  } catch (e) {
    error.value = describeError(e);
  }
});
</script>

<template>
  <div class="ride-details">
    <p v-if="error" class="account-error">{{ error }}</p>
    <p v-else-if="!track" class="note">Loading…</p>
    <template v-else>
      <figure v-if="circuit" class="ride-route">
        <svg class="profile" viewBox="0 0 300 48" preserveAspectRatio="none" role="img" :aria-label="`Elevation profile of ${circuit.name}`">
          <polygon :points="profilePoints" />
        </svg>
        <figcaption class="note">{{ circuit.name }} · one lap: {{ (circuit.length / 1000).toFixed(1) }} km, {{ Math.round(circuit.ascent) }} m up</figcaption>
      </figure>
      <div class="charts">
        <LineChart
          title="Elevation" unit="m" color="#199e70" :zero-based="false" :values="altitude"
          :summary="`${Math.round(Math.min(...altitude.filter((a): a is number => a !== null)))}–${Math.round(Math.max(...altitude.filter((a): a is number => a !== null)))} m`"
        />
        <LineChart
          title="Power" unit="W" color="#3987e5" :zero-based="true" :values="power" :summary="`avg ${stats(power).avg} W · max ${stats(power).max} W`"
          :zones-ftp="settings.ftp"
          :secondary="hasHeart ? { title: 'Heart rate', unit: 'bpm', color: '#e66767', zeroBased: false, values: heart, summary: `avg ${stats(heart).avg} bpm · max ${stats(heart).max} bpm` } : null"
        />
        <p v-if="!hasHeart" class="note">No heart-rate data in this ride.</p>
      </div>
    </template>
  </div>
</template>
