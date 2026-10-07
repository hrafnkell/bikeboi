<script setup lang="ts">
import type { Circuit } from '../ride/circuit.ts';
import type { SavedRide } from '../ride/ride-store.ts';
import { renderHome } from './home.ts';
import LegacyHost from './LegacyHost.vue';

const emit = defineEmits<{ start: [circuit: Circuit]; resume: [circuit: Circuit, ride: SavedRide] }>();
const render = (root: HTMLElement) =>
  renderHome(root, { onStart: (c) => emit('start', c), onResume: (c, r) => emit('resume', c, r) });
</script>

<template>
  <LegacyHost :render="render" />
</template>
