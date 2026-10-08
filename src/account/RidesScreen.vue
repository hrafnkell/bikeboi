<script setup lang="ts">
// Rides kept in the account, newest first.
import { onMounted, ref } from 'vue';
import { api } from '../api/client.ts';
import { fmtClock, fmtKm } from '../format.ts';
import type { RideSummary } from '../ride/recorder.ts';
import RideDetails from './RideDetails.vue';
import { describeError } from './session.ts';

interface RideRow {
  id: string;
  startedAt: number;
  circuitId: string;
  circuitName: string;
  filename: string;
  summary: RideSummary;
  meta: { pacer?: number | null; workout?: string | null; laps?: number; trace?: unknown };
  fitBytes: number;
  createdAt: number;
  intervalsId: string | null;
  intervalsAt: number | null;
  intervalsError: string | null;
}

const emit = defineEmits<{ back: [] }>();

const rides = ref<RideRow[]>([]);
const nextBefore = ref<number | null>(null);
const loading = ref(false);
const error = ref('');
const loadedOnce = ref(false);
const sending = ref<string | null>(null);
const open = ref<string | null>(null);
const intervals = ref<{ connected: boolean }>({ connected: false });

async function send(ride: RideRow) {
  sending.value = ride.id;
  error.value = '';
  try {
    const result = await api<{ ride: RideRow }>('POST', `/api/rides/${encodeURIComponent(ride.id)}/intervals`);
    Object.assign(ride, result.ride);
  } catch (e) {
    error.value = describeError(e);
  } finally {
    sending.value = null;
  }
}

function activityUrl(id: string): string {
  return `https://intervals.icu/activities/${encodeURIComponent(id)}`;
}

async function load(before: number | null) {
  loading.value = true;
  error.value = '';
  try {
    const query = before === null ? '?limit=50' : `?limit=50&before=${before}`;
    const page = await api<{ rides: RideRow[]; nextBefore: number | null }>('GET', `/api/rides${query}`);
    rides.value = before === null ? page.rides : [...rides.value, ...page.rides];
    nextBefore.value = page.nextBefore;
  } catch (e) {
    error.value = describeError(e);
  } finally {
    loading.value = false;
    loadedOnce.value = true;
  }
}

// the ride whose delete button is waiting for a yes
const confirming = ref<string | null>(null);
const removing = ref<string | null>(null);

async function remove(ride: RideRow) {
  removing.value = ride.id;
  try {
    await api('DELETE', `/api/rides/${encodeURIComponent(ride.id)}`);
    rides.value = rides.value.filter((r) => r.id !== ride.id);
  } catch (e) {
    error.value = describeError(e);
  } finally {
    removing.value = null;
    confirming.value = null;
  }
}

/** The headline numbers of a ride, as [label, value] pairs. */
function specs(ride: RideRow): Array<[string, string]> {
  const s = ride.summary;
  return [
    ['Time', fmtClock(s.durationS)],
    ['Distance', `${fmtKm(s.distanceM)} km`],
    ['Avg power', `${Math.round(s.avgPower)} W`],
    ['Avg heart rate', s.avgHeartRate > 0 ? `${Math.round(s.avgHeartRate)} bpm` : '--'],
    ['Burned', `${Math.round(s.calories)} kcal`],
    ['Climbed', `${Math.round(s.ascentM)} m`],
  ];
}

function when(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

onMounted(() => {
  void api<{ connected: boolean }>('GET', '/api/intervals').then((r) => (intervals.value = r)).catch(() => {});
  window.scrollTo(0, 0);
  void load(null);
});
</script>

<template>
  <main class="screen rides">
    <div class="row"><button class="btn" @click="emit('back')">← Back to start</button></div>
    <h1>My rides</h1>
    <p v-if="error" class="account-error">{{ error }}</p>
    <p v-if="loadedOnce && rides.length === 0 && !error" class="note">No rides yet. Finish a ride while signed in and it will be kept here.</p>
    <ol class="ride-list">
      <li v-for="ride in rides" :key="ride.id" class="ride-row">
        <div class="ride-main">
          <strong>{{ ride.circuitName }}</strong>
          <span class="ride-when">{{ when(ride.startedAt) }}</span>
        </div>
        <div class="ride-specs">
          <div v-for="[label, value] in specs(ride)" :key="label" class="ride-spec">
            <span class="ride-spec-value">{{ value }}</span>
            <span class="ride-spec-label">{{ label }}</span>
          </div>
        </div>
        <div v-if="ride.summary.laps > 0 || ride.meta?.workout || ride.meta?.pacer" class="ride-tags">
          <span v-if="ride.summary.laps > 0">{{ ride.summary.laps }} {{ ride.summary.laps === 1 ? 'lap' : 'laps' }}</span>
          <span v-if="ride.meta?.workout">Workout: {{ ride.meta.workout }}</span>
          <span v-else-if="ride.meta?.pacer">Pacemaker {{ ride.meta.pacer }} W</span>
        </div>
        <div class="row ride-actions">
          <button class="btn" :aria-expanded="open === ride.id ? 'true' : 'false'" @click="open = open === ride.id ? null : ride.id">{{ open === ride.id ? 'Hide details' : 'Details' }}</button>
          <a class="btn" :href="`/api/rides/${encodeURIComponent(ride.id)}/fit`" :download="ride.filename">Download FIT</a>
          <a v-if="ride.intervalsId" class="btn" :href="activityUrl(ride.intervalsId)" target="_blank" rel="noopener">On intervals.icu</a>
          <button v-else-if="intervals.connected" class="btn" :disabled="sending === ride.id" @click="send(ride)">
            {{ sending === ride.id ? 'Sending…' : ride.intervalsError ? 'Retry intervals.icu' : 'Send to intervals.icu' }}
          </button>
          <span v-if="confirming === ride.id" class="ride-confirm">
            <span>Delete this ride?</span>
            <button class="btn btn-danger" :disabled="removing === ride.id" @click="remove(ride)">{{ removing === ride.id ? 'Deleting…' : 'Delete' }}</button>
            <button class="btn" :disabled="removing === ride.id" @click="confirming = null">Keep</button>
          </span>
          <button v-else class="btn btn-trash" title="Delete ride" aria-label="Delete ride" @click="confirming = ride.id">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path fill="currentColor" d="M9 3h6l1 2h4v2H4V5h4l1-2zm-3 6h12l-1 12H7L6 9zm4 2v8h2v-8h-2zm4 0v8h2v-8h-2z" />
            </svg>
          </button>
        </div>
        <RideDetails v-if="open === ride.id" :ride-id="ride.id" :circuit-id="ride.circuitId" :trace="ride.meta?.trace ?? null" />
      </li>
    </ol>
    <div class="row">
      <button v-if="nextBefore !== null" class="btn" :disabled="loading" @click="load(nextBefore)">Load more</button>
      <button class="btn" @click="emit('back')">Back to start</button>
    </div>
  </main>
</template>
