<script setup lang="ts">
// Power-over-time thumbnail of a workout, with a line at FTP.
import { computed } from 'vue';
import { fmtClock } from '../format.ts';
import { WorkoutPlan } from '../ride/workout.ts';
import type { ParsedWorkout } from '../ride/workout.ts';

const props = defineProps<{ workout: ParsedWorkout; ftp: number }>();

const W = 300;
const H = 56;

const shape = computed(() => {
  const plan = new WorkoutPlan(props.workout, props.ftp);
  const top = Math.max(props.ftp * 1.3, ...plan.steps.map((s) => Math.max(s.from, s.to))) * 1.05;
  const y = (w: number) => H - (w / top) * H;
  return {
    label: `Workout shape: ${plan.steps.length} steps over ${fmtClock(plan.duration)}`,
    ftpY: y(props.ftp),
    steps: plan.steps.map((s) => {
      const x0 = (s.start / plan.duration) * W;
      const x1 = Math.max(x0 + 0.5, (s.end / plan.duration) * W - 0.6);
      return { free: s.free, points: `${x0},${H} ${x0},${y(s.from)} ${x1},${y(s.to)} ${x1},${H}` };
    }),
  };
});
</script>

<template>
  <svg :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="none" class="workout-thumb" role="img" :aria-label="shape.label">
    <polygon v-for="(s, i) in shape.steps" :key="i" :points="s.points" :class="s.free ? 'free' : ''" />
    <line x1="0" :x2="W" :y1="shape.ftpY" :y2="shape.ftpY" />
  </svg>
</template>
