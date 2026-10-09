<script setup lang="ts">
// Graphs for one ride from the account: the circuit, elevation, and power with heart rate.
import { computed, onMounted, ref } from 'vue';
import { ApiError } from '../api/client.ts';
import { readFitTrack } from '../ride/fit-read.ts';
import type { FitTrack } from '../ride/fit-read.ts';
import { lookupCircuit } from '../ride/circuits/index.ts';
import type { Circuit } from '../ride/circuit.ts';
import LineChart from '../ui/LineChart.vue';
import { settings } from '../state.ts';
import { describeError } from './session.ts';
import { decodeTrace } from '../ride/trace.ts';
import { altValue, fmtAlt, fmtDist, speedValue, unitLabels } from '../ui/units.ts';

const props = defineProps<{ rideId: string; circuitId: string; trace?: unknown }>();

// diagnostics kept beside the file: gear, the trainer's wheel speed and what it was told
const trace = computed(() => decodeTrace(props.trace));

const track = ref<FitTrack | null>(null);
const error = ref('');

/** One-per-second series for the chart: the recorder wrote one record a second, with gaps when paused. */
function perSecond<T>(t: FitTrack, values: T[], fill: T): T[] {
  const last = t.seconds[t.seconds.length - 1] ?? 0;
  const out: T[] = new Array(last + 1).fill(fill);
  t.seconds.forEach((s, i) => (out[s] = values[i]));
  return out;
}

const circuit = computed<Circuit | null>(() => lookupCircuit(props.circuitId));
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
const altitude = computed(() => (track.value ? perSecond(track.value, track.value.altitude.map((a) => altValue(a)), null as number | null) : []));
const hasHeart = computed(() => heart.value.filter((h) => h !== null).length > 1);
const speed = computed(() => (track.value ? perSecond(track.value, track.value.speed.map((v) => speedValue(v)), null as number | null) : []));
const grade = computed(() => (track.value ? perSecond(track.value, track.value.grade, null as number | null) : []));
/** A trace column spread to one-per-second like the FIT series (they share record order). */
function traceSeries(values: Array<number | null>): Array<number | null> {
  const t = track.value;
  if (!t || values.length !== t.seconds.length) return [];
  return perSecond(t, values, null);
}
const gear = computed(() => (trace.value ? traceSeries(trace.value.gear.map((g) => (g > 0 ? g : null))) : []));
const wheel = computed(() => (trace.value ? traceSeries(trace.value.wheelSpeed.map((v) => speedValue(v))) : []));
const sent = computed(() => (trace.value ? traceSeries(trace.value.sentGrade) : []));
const target = computed(() => (trace.value ? traceSeries(trace.value.target) : []));
const hasTrace = computed(() => gear.value.some((g) => g !== null));
const hasWheel = computed(() => wheel.value.some((w) => w !== null && w > 0));
const hasTarget = computed(() => target.value.some((w) => w !== null));
const span = (xs: Array<number | null>) => {
  const v = xs.filter((x): x is number => x !== null);
  return v.length ? `${Math.min(...v)}–${Math.max(...v)}` : '';
};
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
        <figcaption class="note">{{ circuit.name }} · one lap: {{ fmtDist(circuit.length, 1) }}, {{ fmtAlt(circuit.ascent) }} up</figcaption>
      </figure>
      <div class="charts">
        <LineChart
          title="Elevation" :unit="unitLabels().alt" color="#199e70" :zero-based="false" :values="altitude"
          :summary="`${Math.round(Math.min(...altitude.filter((a): a is number => a !== null)))}–${Math.round(Math.max(...altitude.filter((a): a is number => a !== null)))} ${unitLabels().alt}`"
        />
        <LineChart
          title="Power" unit="W" color="#3987e5" :zero-based="true" :values="power" :summary="`avg ${stats(power).avg} W · max ${stats(power).max} W`"
          :zones-ftp="settings.ftp"
          :secondary="hasHeart ? { title: 'Heart rate', unit: 'bpm', color: '#e66767', zeroBased: false, values: heart, summary: `avg ${stats(heart).avg} bpm · max ${stats(heart).max} bpm` } : null"
        />
        <p v-if="!hasHeart" class="note">No heart-rate data in this ride.</p>
        <template v-if="hasTrace">
          <LineChart title="Gear" unit="" color="#b197fc" :zero-based="false" :values="gear" :summary="`gears ${span(gear)}`" />
          <LineChart
            title="Trainer wheel speed" :unit="unitLabels().speed" color="#fcc419" :zero-based="true" :values="hasWheel ? wheel : []" :summary="hasWheel ? `avg ${stats(wheel).avg} ${unitLabels().speed}` : 'not reported by the trainer'"
            :secondary="{ title: 'Game speed', unit: unitLabels().speed, color: '#3987e5', zeroBased: true, values: speed, summary: `avg ${stats(speed).avg} ${unitLabels().speed}` }"
          />
          <LineChart
            title="Gradient sent to the trainer" unit="%" color="#ff922b" :zero-based="false" :values="sent" :summary="`${span(sent.map((v) => (v === null ? null : Math.round(v))))} %`"
            :secondary="{ title: 'Road gradient', unit: '%', color: '#199e70', zeroBased: false, values: grade, summary: `${span(grade.map((v) => (v === null ? null : Math.round(v))))} %` }"
          />
          <LineChart v-if="hasTarget" title="ERG target" unit="W" color="#e66767" :zero-based="true" :values="target" :summary="`${span(target)} W`" />
        </template>
        <p v-else class="note">No gear or trainer diagnostics in this ride (recorded before they were logged).</p>
      </div>
    </template>
  </div>
</template>
