<script setup lang="ts">
import { renderAbout } from './about.ts';
import LegacyHost from './LegacyHost.vue';

const emit = defineEmits<{ back: [] }>();
const render = (root: HTMLElement) => renderAbout(root, () => emit('back'));
</script>

<template>
  <LegacyHost :render="render" />
</template>
