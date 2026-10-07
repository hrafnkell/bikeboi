<script setup lang="ts">
import type { Circuit } from '../ride/circuit.ts';
import type { RideOutcome } from '../ride/outcome.ts';
import type { SavedRide } from '../ride/ride-store.ts';
import { startRide } from './ride.ts';
import LegacyHost from './LegacyHost.vue';

const props = defineProps<{ circuit: Circuit; resume: SavedRide | null }>();
const emit = defineEmits<{ end: [outcome: RideOutcome] }>();
const render = (root: HTMLElement) => startRide(root, props.circuit, (o) => emit('end', o), props.resume);
</script>

<template>
  <LegacyHost :render="render" />
</template>
