<script setup lang="ts">
import type { RideOutcome } from '../ride/outcome.ts';
import { renderSummary } from './summary.ts';
import LegacyHost from './LegacyHost.vue';

const props = defineProps<{ outcome: RideOutcome }>();
const emit = defineEmits<{ done: [] }>();
const render = (root: HTMLElement) => renderSummary(root, props.outcome, () => emit('done'));
</script>

<template>
  <LegacyHost :render="render" />
</template>
