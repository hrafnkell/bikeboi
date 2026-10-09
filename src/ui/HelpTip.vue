<script setup lang="ts">
// A small "?" in a card's corner that opens a short explanation of the card.
import { useTemplateRef } from 'vue';

defineProps<{ title: string }>();
const dialog = useTemplateRef<HTMLDialogElement>('dialog');
</script>

<template>
  <button class="help-btn" type="button" :aria-label="`What is ${title}?`" :title="`About ${title}`" @click="dialog?.showModal()">?</button>
  <dialog ref="dialog" class="welcome help" @click.self="dialog?.close()">
    <h2>{{ title }}</h2>
    <div class="help-body">
      <slot />
    </div>
    <div class="row">
      <button class="btn btn-primary" @click="dialog?.close()">Got it</button>
    </div>
  </dialog>
</template>
