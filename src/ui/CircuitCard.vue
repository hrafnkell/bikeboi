<script setup lang="ts">
// One selectable circuit: profile, description, stats, best lap and scene tag.
import { computed } from 'vue';
import { findScene } from '../game/scenes.ts';
import { fmtKm, fmtLap } from '../format.ts';
import type { Circuit } from '../ride/circuit.ts';
import { loadGhost } from '../ride/ghost.ts';
import { projectTime } from '../ride/sim.ts';
import { settingsR } from './store.ts';

const props = defineProps<{ circuit: Circuit; selected: boolean }>();
defineEmits<{ select: [] }>();

const W = 200;
const H = 48;

const points = computed(() => {
  const c = props.circuit;
  const range = Math.max(8, c.maxAltitude - c.minAltitude);
  const pts: string[] = [`0,${H}`];
  for (let i = 0; i <= 100; i++) {
    const a = (c.altitudeAt((i / 100) * c.length) - c.minAltitude) / range;
    pts.push(`${(i / 100) * W},${(H - 4 - a * (H - 10)).toFixed(1)}`);
  }
  pts.push(`${W},${H}`);
  return pts.join(' ');
});

const ghost = loadGhost(props.circuit.id);

/** A lap at a steady 75% of FTP from a standing start, with the rider's current weights. */
const estimate = computed(() => {
  const c = props.circuit;
  const seconds = projectTime(c, settingsR.riderMass + settingsR.bikeMass, settingsR.ftp * 0.75, 0, 0, c.length);
  if (!Number.isFinite(seconds)) return '';
  const minutes = Math.round(seconds / 60);
  return `\u2248 ${minutes} min at 75% of FTP`;
});
/** Length, climb and steepest gradient, as [value, label] badges. */
const badges = computed<Array<[string, string]>>(() => {
  const c = props.circuit;
  return [
    [`${fmtKm(c.length, 1)} km`, 'length'],
    [`${Math.round(c.ascent)} m`, 'climb'],
    [`${(c.maxGrade * 100).toFixed(0)}%`, 'max'],
  ];
});
const segments = computed(() => {
  const n = props.circuit.segments.length;
  return `${n} ${n === 1 ? 'segment' : 'segments'}`;
});
</script>

<template>
  <button class="circuit" :aria-pressed="selected ? 'true' : 'false'" @click="$emit('select')">
    <svg :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="none" class="profile">
      <polygon :points="points" />
    </svg>
    <strong>{{ circuit.name }}</strong>
    <span class="circuit-desc">{{ circuit.description }}</span>
    <span class="circuit-badges">
      <span v-for="[value, label] in badges" :key="label" class="badge"><b>{{ value }}</b> {{ label }}</span>
    </span>
    <span class="circuit-stats">{{ segments }}<template v-if="estimate"> · {{ estimate }}</template></span>
    <span class="circuit-best">{{ ghost ? `Best lap ${fmtLap(ghost.lapTime)}` : 'No lap yet' }}</span>
    <span class="circuit-scene">{{ findScene(circuit.scene).name }}</span>
  </button>
</template>
