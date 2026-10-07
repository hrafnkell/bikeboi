<script setup lang="ts">
// One-time card pointing new visitors at the About page.
import { onMounted, useTemplateRef } from 'vue';

const KEY = 'bikeboi:welcomed';

const dialog = useTemplateRef<HTMLDialogElement>('dialog');

function remember() {
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    // nothing to do
  }
}

onMounted(() => dialog.value?.showModal());
</script>

<template>
  <dialog ref="dialog" class="welcome" aria-labelledby="welcome-title" @close="remember" @cancel="remember">
    <h2 id="welcome-title">Welcome to bikeboi</h2>
    <p>
      A side-scrolling game for your indoor trainer: ride laps, chase your own ghost, shift virtual gears. It needs Chrome or Edge and a Bluetooth trainer, or you can try it with simulated power.
    </p>
    <div class="row">
      <a class="btn btn-primary" href="#about" @click="dialog?.close()">Show me how it works</a>
      <button class="btn" @click="dialog?.close()">Jump straight in</button>
    </div>
  </dialog>
</template>
