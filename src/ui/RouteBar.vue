<script setup lang="ts">
// The route being put together on the start screen: its legs, the strung-together
// profile, and the button to ride it.
import { computed } from 'vue';
import { fmtLap } from '../format.ts';
import { fmtAlt, fmtDist } from './units.ts';
import type { Circuit } from '../ride/circuit.ts';
import { loadGhost } from '../ride/ghost.ts';
import { projectTime } from '../ride/sim.ts';
import { profileShape } from './profile.ts';
import { settingsR } from './store.ts';

const props = defineProps<{ route: Circuit }>();
const emit = defineEmits<{ remove: [index: number]; clear: []; ride: [] }>();

const W = 600;
const H = 64;
const shape = computed(() => profileShape(props.route, W, H, 300));
const legs = computed(() => props.route.legs ?? [{ circuit: props.route, toTop: false, start: 0, length: props.route.length, lift: 0 }]);
const ghost = computed(() => loadGhost(props.route.id));
const estimate = computed(() => {
  const r = props.route;
  const seconds = projectTime(r, settingsR.riderMass + settingsR.bikeMass, settingsR.ftp * 0.75, 0, 0, r.length);
  return Number.isFinite(seconds) ? `≈ ${Math.round(seconds / 60)} min at 75% of FTP` : '';
});
const badges = computed<Array<[string, string]>>(() => [
  [fmtDist(props.route.length, 1), 'length'],
  [fmtAlt(props.route.ascent), 'climb'],
  [`${(props.route.maxGrade * 100).toFixed(0)}%`, 'max'],
]);
</script>

<template>
  <div class="route-bar">
    <div class="route-head">
      <strong>Your route</strong>
      <span class="circuit-badges">
        <span v-for="[value, label] in badges" :key="label" class="badge"><b>{{ value }}</b> {{ label }}</span>
      </span>
    </div>
    <svg :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="none" class="profile route-profile" role="img" :aria-label="`Profile of ${route.name}`">
      <defs>
        <linearGradient id="grad-route" gradientUnits="userSpaceOnUse" x1="0" :y1="shape.bottom" x2="0" :y2="shape.scaleTop">
          <stop offset="0" stop-color="#4c956c" />
          <stop offset="1" stop-color="#d9b26f" />
        </linearGradient>
      </defs>
      <polygon :points="shape.points" fill="url(#grad-route)" />
      <line v-for="x in shape.joins" :key="x" :x1="x" :x2="x" y1="0" :y2="H" class="route-join" />
    </svg>
    <ol class="route-legs">
      <li v-for="(leg, i) in legs" :key="i" class="route-leg">
        <span class="route-leg-no">{{ i + 1 }}</span>
        <span class="route-leg-name">{{ leg.circuit.name }}<span v-if="leg.toTop" class="route-leg-top"> to the top</span></span>
        <span class="route-leg-len">{{ fmtDist(leg.length, 1) }}</span>
        <button class="btn btn-small" :aria-label="`Remove ${leg.circuit.name} from the route`" @click="emit('remove', i)">✕</button>
      </li>
    </ol>
    <p v-if="route.open" class="note">Ends at a summit: when you cross the line you are put back at the start.</p>
    <div class="route-foot">
      <span class="circuit-stats">{{ route.segments.length }} segments<template v-if="estimate"> · {{ estimate }}</template></span>
      <span class="circuit-best">{{ ghost ? `Best lap ${fmtLap(ghost.lapTime)}` : 'No lap yet' }}</span>
    </div>
    <div class="row">
      <button class="btn btn-primary" @click="emit('ride')">Ride this route</button>
      <button class="btn" @click="emit('clear')">Clear</button>
    </div>
  </div>
</template>
