<script setup lang="ts">
// Rides kept in the account, newest first.
import { onMounted, ref } from 'vue';
import { api } from '../api/client.ts';
import { fmtClock, fmtKm } from '../format.ts';
import type { RideSummary } from '../ride/recorder.ts';
import { describeError } from './session.ts';

interface RideRow {
  id: string;
  startedAt: number;
  circuitId: string;
  circuitName: string;
  filename: string;
  summary: RideSummary;
  meta: { pacer?: number | null; workout?: string | null; laps?: number };
  fitBytes: number;
  createdAt: number;
}

const emit = defineEmits<{ back: [] }>();

const rides = ref<RideRow[]>([]);
const nextBefore = ref<number | null>(null);
const loading = ref(false);
const error = ref('');
const loadedOnce = ref(false);

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

async function remove(ride: RideRow) {
  if (!confirm(`Delete the ride on ${ride.circuitName} from ${when(ride.startedAt)}?`)) return;
  try {
    await api('DELETE', `/api/rides/${encodeURIComponent(ride.id)}`);
    rides.value = rides.value.filter((r) => r.id !== ride.id);
  } catch (e) {
    error.value = describeError(e);
  }
}

function when(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

onMounted(() => {
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
        <div class="ride-stats">
          <span>{{ fmtClock(ride.summary.durationS) }}</span>
          <span>{{ fmtKm(ride.summary.distanceM) }} km</span>
          <span>{{ Math.round(ride.summary.avgPower) }} W avg</span>
          <span v-if="ride.summary.laps > 0">{{ ride.summary.laps }} {{ ride.summary.laps === 1 ? 'lap' : 'laps' }}</span>
          <span v-if="ride.meta?.workout">{{ ride.meta.workout }}</span>
        </div>
        <div class="row ride-actions">
          <a class="btn" :href="`/api/rides/${encodeURIComponent(ride.id)}/fit`" :download="ride.filename">Download FIT</a>
          <button class="btn" @click="remove(ride)">Delete</button>
        </div>
      </li>
    </ol>
    <div class="row">
      <button v-if="nextBefore !== null" class="btn" :disabled="loading" @click="load(nextBefore)">Load more</button>
      <button class="btn" @click="emit('back')">Back to start</button>
    </div>
  </main>
</template>
