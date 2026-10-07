<script setup lang="ts">
// Temporary bridge while screens are migrated: mounts an old render function into a div.
import { onBeforeUnmount, onMounted, useTemplateRef } from 'vue';

const props = defineProps<{ render: (root: HTMLElement) => () => void }>();
const root = useTemplateRef<HTMLElement>('root');
let cleanup: (() => void) | null = null;

onMounted(() => {
  cleanup = props.render(root.value!);
});
onBeforeUnmount(() => {
  cleanup?.();
  cleanup = null;
});
</script>

<template>
  <div ref="root" style="display: contents"></div>
</template>
