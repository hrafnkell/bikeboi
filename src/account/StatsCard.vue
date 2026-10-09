<script setup lang="ts">
// The last seven days against the seven before, and everything so far.
import { computed, onMounted, ref } from 'vue';
import { api } from '../api/client.ts';
import { fmtAlt, fmtDist } from '../ui/units.ts';
import { describeError } from './session.ts';

interface Totals {
  rides: number;
  durationS: number;
  distanceM: number;
  ascentM: number;
  calories: number;
  /** Joules. */
  work: number;
}
interface Stats {
  week: Totals;
  previous: Totals;
  total: Totals;
}

const stats = ref<Stats | null>(null);
const error = ref('');

function hours(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

const rows = computed(() => {
  const s = stats.value;
  if (!s) return [];
  const row = (label: string, pick: (t: Totals) => number, fmt: (v: number) => string) => ({
    label, week: fmt(pick(s.week)), previous: fmt(pick(s.previous)), total: fmt(pick(s.total)),
    up: pick(s.week) > pick(s.previous), same: pick(s.week) === pick(s.previous),
  });
  return [
    row('Rides', (t) => t.rides, (v) => String(v)),
    row('Time', (t) => t.durationS, hours),
    row('Distance', (t) => t.distanceM, (v) => fmtDist(v, 1)),
    row('Climbed', (t) => t.ascentM, (v) => fmtAlt(v)),
    row('Burned', (t) => t.calories, (v) => `${Math.round(v)} kcal`),
    row('Work', (t) => t.work, (v) => `${Math.round(v / 1000)} kJ`),
  ];
});

/** One line of encouragement, from how the week compares. */
const verdict = computed(() => {
  const s = stats.value;
  if (!s) return '';
  if (s.week.rides === 0 && s.previous.rides === 0) return s.total.rides === 0 ? 'No rides yet. The first one is the hardest.' : 'Nothing in the last two weeks. The trainer misses you.';
  if (s.week.rides === 0) return 'Nothing yet this week. There is still time.';
  if (s.previous.rides === 0) return 'Back on the bike this week. Well done.';
  const more = s.week.durationS > s.previous.durationS;
  const pct = Math.round(Math.abs(s.week.durationS / s.previous.durationS - 1) * 100);
  if (pct < 5) return 'About the same as last week. Consistency counts.';
  return more ? `${pct}% more riding than the week before. Well done!` : `${pct}% less than the week before. A short ride still counts.`;
});

onMounted(async () => {
  try {
    stats.value = await api<Stats>('GET', '/api/rides/stats');
  } catch (e) {
    error.value = describeError(e);
  }
});
</script>

<template>
  <div class="stats-card">
    <p v-if="error" class="account-error">{{ error }}</p>
    <p v-else-if="!stats" class="note">Loading…</p>
    <template v-else>
      <p class="stats-verdict">{{ verdict }}</p>
      <table class="stats-table">
        <thead>
          <tr><th></th><th>Last 7 days</th><th>7 before</th><th>All time</th></tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="r.label">
            <th>{{ r.label }}</th>
            <td :class="{ up: r.up, down: !r.up && !r.same }">{{ r.week }}</td>
            <td>{{ r.previous }}</td>
            <td>{{ r.total }}</td>
          </tr>
        </tbody>
      </table>
    </template>
  </div>
</template>
