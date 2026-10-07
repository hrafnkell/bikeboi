<script setup lang="ts">
// Offers to resume, save or discard a ride that was interrupted.
import { onMounted, ref, shallowRef } from 'vue';
import { fmtClock, fmtKm } from '../format.ts';
import type { Circuit } from '../ride/circuit.ts';
import { circuits } from '../ride/circuits/index.ts';
import {
  discardSavedRide, downloadFit, encodeFit, fitFilename, recoverRide, summarize,
} from '../ride/recorder.ts';
import type { SavedRide } from '../ride/ride-store.ts';
import { settings } from '../state.ts';

defineProps<{ resumeLabel: string }>();
const emit = defineEmits<{ resume: [circuit: Circuit, ride: SavedRide] }>();

const ride = shallowRef<SavedRide | null>(null);
const circuit = shallowRef<Circuit | null>(null);
const message = ref('');
let disposed = false;

onMounted(() => {
  void recoverRide().then((found) => {
    if (disposed || !found) return;
    const s = summarize(found);
    const c = circuits.find((x) => x.id === found.meta.circuitId) ?? null;
    message.value =
      `An unfinished ride on ${found.meta.circuitName} was found: ${fmtClock(s.durationS)}, ${fmtKm(s.distanceM)} km. ` +
      `${c ? 'You can pick it up where it stopped, or save what was recorded.' : 'You can save what was recorded.'} Starting a new ride replaces it.`;
    circuit.value = c;
    ride.value = found;
  }).catch(() => {});
});

async function save() {
  if (!ride.value) return;
  try {
    downloadFit(await encodeFit(ride.value, settings.ftp), fitFilename(ride.value.meta));
  } catch (e) {
    message.value = `Could not build the file: ${e instanceof Error ? e.message : String(e)}`;
  }
}

async function discard() {
  await discardSavedRide();
  ride.value = null;
}

defineExpose({ dispose: () => (disposed = true) });
</script>

<template>
  <div class="recovery" :hidden="!ride">
    <p>{{ message }}</p>
    <div class="row">
      <button v-if="circuit" class="btn btn-primary" @click="circuit && ride && emit('resume', circuit, ride)">{{ resumeLabel }}</button>
      <button class="btn" @click="save">Save FIT file</button>
      <button class="btn" @click="discard">Discard</button>
    </div>
  </div>
</template>
