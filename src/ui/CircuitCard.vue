<script setup lang="ts">
// One selectable circuit: profile, description, badges, best lap, scene tag, and the
// buttons that add it to a route.
import { computed } from 'vue';
import { findScene } from '../game/scenes.ts';
import { fmtLap } from '../format.ts';
import { fmtAlt, fmtDist } from './units.ts';
import type { Circuit } from '../ride/circuit.ts';
import { loadGhost } from '../ride/ghost.ts';
import { projectTime } from '../ride/sim.ts';
import { profileShape } from './profile.ts';
import { settingsR } from './store.ts';

const props = defineProps<{ circuit: Circuit; selected: boolean }>();
defineEmits<{ select: []; add: [toTop: boolean] }>();

const W = 200;
const H = 48;

const shape = computed(() => profileShape(props.circuit, W, H));
const gradientId = `grad-${props.circuit.id}`;
/** A summit cut only makes sense when there is a hill to cut at. */
const hasTop = computed(() => props.circuit.ascent >= 30 && props.circuit.summitAt > 50);

const ghost = loadGhost(props.circuit.id);

/** A lap at a steady 75% of FTP from a standing start, with the rider's current weights. */
const estimate = computed(() => {
  const c = props.circuit;
  const seconds = projectTime(c, settingsR.riderMass + settingsR.bikeMass, settingsR.ftp * 0.75, 0, 0, c.length);
  if (!Number.isFinite(seconds)) return '';
  const minutes = Math.round(seconds / 60);
  return `≈ ${minutes} min at 75% of FTP`;
});
/** Length, climb and steepest gradient, as [value, label] badges. */
const badges = computed<Array<[string, string]>>(() => {
  const c = props.circuit;
  return [
    [fmtDist(c.length, 1), 'length'],
    [fmtAlt(c.ascent), 'climb'],
    [`${(c.maxGrade * 100).toFixed(0)}%`, 'max'],
  ];
});
const segments = computed(() => {
  const n = props.circuit.segments.length;
  return `${n} ${n === 1 ? 'segment' : 'segments'}`;
});
</script>

<template>
  <div
    class="circuit" role="button" tabindex="0" :aria-pressed="selected ? 'true' : 'false'"
    @click="$emit('select')" @keydown.enter.prevent="$emit('select')" @keydown.space.prevent="$emit('select')"
  >
    <svg :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="none" class="profile">
      <defs>
        <linearGradient :id="gradientId" gradientUnits="userSpaceOnUse" x1="0" :y1="shape.bottom" x2="0" :y2="shape.scaleTop">
          <stop offset="0" stop-color="#4c956c" />
          <stop offset="1" stop-color="#d9b26f" />
        </linearGradient>
      </defs>
      <polygon :points="shape.points" :fill="`url(#${gradientId})`" />
    </svg>
    <strong>{{ circuit.name }}</strong>
    <span class="circuit-desc">{{ circuit.description }}</span>
    <span class="circuit-badges">
      <span v-for="[value, label] in badges" :key="label" class="badge"><b>{{ value }}</b> {{ label }}</span>
    </span>
    <span class="circuit-stats">{{ segments }}<template v-if="estimate"> · {{ estimate }}</template></span>
    <span class="circuit-best">{{ ghost ? `Best lap ${fmtLap(ghost.lapTime)}` : 'No lap yet' }}</span>
    <span class="circuit-scene">{{ findScene(circuit.scene).name }}</span>
    <span class="circuit-add">
      <button class="btn btn-small" title="Add this circuit to the route" @click.stop="$emit('add', false)">+ Route</button>
      <button v-if="hasTop" class="btn btn-small" title="Add only the climb, up to the summit, to the route" @click.stop="$emit('add', true)">+ To the top</button>
    </span>
  </div>
</template>
