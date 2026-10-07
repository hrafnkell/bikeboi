<script setup lang="ts">
// One HUD card: label, value, unit, and optionally the max so far and a workout target.
defineProps<{
  label: string;
  unit: string;
  value: string;
  max?: string;
  target?: string;
  targetOn?: boolean;
  big?: boolean;
  color?: string;
}>();
</script>

<template>
  <div class="metric" :class="{ 'metric-big': big }">
    <span class="metric-label">{{ label }}</span>
    <span class="metric-value" :style="color ? { color } : undefined">{{ value }}</span>
    <span class="metric-unit">{{ unit }}</span>
    <span v-if="max !== undefined" class="metric-max">{{ max }}</span>
    <span class="metric-target" :class="{ on: targetOn }">{{ target ?? '' }}</span>
  </div>
</template>
