<script setup lang="ts">
// Personal records and best efforts across every saved ride.
import { computed, onMounted, ref } from 'vue';
import { api } from '../api/client.ts';
import { PEAK_WINDOWS, peakLabel } from '../ride/peaks.ts';
import { RECORD_ORDER, formatRecord, recordLabel } from '../ui/records.ts';
import { describeError } from './session.ts';

interface Entry { value: number; rideId: string; startedAt: number; circuitName: string }
interface Records { rides: number; records: Record<string, Entry | undefined>; peaks: Record<string, Entry | undefined> }

const data = ref<Records | null>(null);
const error = ref('');

function when(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { dateStyle: 'medium' });
}

const records = computed(() => {
  const d = data.value;
  if (!d) return [];
  return RECORD_ORDER.flatMap((k) => {
    const e = d.records[k];
    return e ? [{ key: k, label: recordLabel(k), value: formatRecord(k, e.value), where: `${e.circuitName}, ${when(e.startedAt)}` }] : [];
  });
});

const efforts = computed(() => {
  const d = data.value;
  if (!d) return [];
  const rows = PEAK_WINDOWS.flatMap((w) => {
    const e = d.peaks[String(w)];
    return e ? [{ window: w, label: peakLabel(w), watts: e.value, where: `${e.circuitName}, ${when(e.startedAt)}` }] : [];
  });
  const top = Math.max(1, ...rows.map((r) => r.watts));
  return rows.map((r) => ({ ...r, width: `${Math.round((r.watts / top) * 100)}%` }));
});

onMounted(async () => {
  try {
    data.value = await api<Records>('GET', '/api/rides/records');
  } catch (e) {
    error.value = describeError(e);
  }
});
</script>

<template>
  <div class="stats-card records-card">
    <p v-if="error" class="account-error">{{ error }}</p>
    <p v-else-if="!data" class="note">Loading…</p>
    <p v-else-if="data.rides === 0" class="note">No rides yet. Your first ride sets every record.</p>
    <template v-else>
      <ul class="record-list">
        <li v-for="r in records" :key="r.key">
          <span class="record-label">{{ r.label }}</span>
          <span class="record-value">{{ r.value }}</span>
          <span class="record-where">{{ r.where }}</span>
        </li>
      </ul>
      <template v-if="efforts.length > 0">
        <h3>Best efforts</h3>
        <ul class="effort-list">
          <li v-for="e in efforts" :key="e.window">
            <span class="effort-label">{{ e.label }}</span>
            <span class="effort-bar"><i :style="{ width: e.width }"></i></span>
            <span class="effort-value">{{ e.watts }} W</span>
            <span class="record-where">{{ e.where }}</span>
          </li>
        </ul>
      </template>
      <p v-else class="note">Best efforts appear for rides saved from now on.</p>
    </template>
  </div>
</template>
