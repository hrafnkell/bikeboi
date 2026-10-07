<script setup lang="ts">
// Start screen: devices, circuit choice, scene, pacemaker, ride recovery; rider and setup
// too until you sign in, after which they live on your account page.
import { computed } from 'vue';
import { sceneList } from '../game/scenes.ts';
import type { Circuit } from '../ride/circuit.ts';
import { circuits, findCircuit } from '../ride/circuits/index.ts';
import type { SavedRide } from '../ride/ride-store.ts';
import { saveSettings } from '../state.ts';
import CircuitCard from './CircuitCard.vue';
import DeviceList from './DeviceList.vue';
import PacerEditor from './PacerEditor.vue';
import { account } from '../account/session.ts';
import UserButton from '../account/UserButton.vue';
import RecoveryCard from './RecoveryCard.vue';
import RiderEditor from './RiderEditor.vue';
import SetupFields from './SetupFields.vue';
import { settingsR } from './store.ts';
import { useDevices } from './useDevices.ts';
import WelcomeDialog from './WelcomeDialog.vue';

/** Where users of a hosted copy can get the source (AGPL section 13). */
const SOURCE_URL = 'https://github.com/hrafnkell/bikeboi';

const emit = defineEmits<{ start: [circuit: Circuit]; resume: [circuit: Circuit, ride: SavedRide] }>();

const infos = useDevices();
const trainerOn = computed(() => infos.trainer.status === 'connected');

// --- circuits ---
const selected = computed(() => findCircuit(settingsR.lastCircuitId));
function select(circuit: Circuit) {
  settingsR.lastCircuitId = circuit.id;
  saveSettings();
}
select(selected.value); // normalises an unknown stored id

// --- scene ---
const sceneOptions: Array<{ id: typeof settingsR.scene; name: string }> = [
  { id: 'auto', name: 'Circuit default' },
  ...sceneList.map((s) => ({ id: s.id, name: s.name })),
];
function selectScene(id: typeof settingsR.scene) {
  settingsR.scene = id;
  saveSettings();
}
selectScene(sceneOptions.some((o) => o.id === settingsR.scene) ? settingsR.scene : 'auto');

/** True on the first visit (and false when storage is unavailable, so it never nags every time). */
function shouldWelcome(): boolean {
  try {
    return !localStorage.getItem('bikeboi:welcomed');
  } catch {
    return false;
  }
}
const welcome = shouldWelcome();
</script>

<template>
  <main class="screen home">
    <header class="home-head">
      <h1>bikeboi</h1>
      <div class="home-head-actions">
        <a class="btn" href="#about">About</a>
        <UserButton />
      </div>
    </header>
    <RecoveryCard
      :resume-label="trainerOn ? 'Resume ride' : 'Resume with simulated power'"
      @resume="(c, r) => emit('resume', c, r)"
    />
    <section>
      <h2>Devices</h2>
      <DeviceList />
    </section>
    <section>
      <h2>Circuit</h2>
      <div class="circuit-list">
        <CircuitCard
          v-for="c in circuits"
          :key="c.id"
          :circuit="c"
          :selected="c.id === selected.id"
          @select="select(c)"
        />
      </div>
    </section>
    <section>
      <h2>Scene</h2>
      <div class="chips">
        <button
          v-for="o in sceneOptions"
          :key="o.id"
          class="chip"
          :aria-pressed="o.id === settingsR.scene ? 'true' : 'false'"
          @click="selectScene(o.id)"
        >{{ o.name }}</button>
      </div>
    </section>
    <section>
      <h2>Pacemaker</h2>
      <PacerEditor />
    </section>
    <!-- signed-in riders find these under the user icon instead -->
    <section v-if="account.status !== 'in'">
      <h2>Your rider</h2>
      <RiderEditor />
    </section>
    <section v-if="account.status !== 'in'">
      <h2>Setup</h2>
      <SetupFields />
    </section>
    <p class="note">Shift with the Click, the on-screen buttons or the up / down arrow keys.</p>
    <button class="btn btn-primary btn-start" @click="emit('start', selected)">
      {{ trainerOn ? 'Ride' : 'Ride with simulated power' }}
    </button>
    <footer class="footer">
      bikeboi is free software under the AGPL-3.0, built on code from
      <a href="https://github.com/dvmarinoff/Auuki" target="_blank" rel="noopener">Auuki</a>.
      <a :href="SOURCE_URL" target="_blank" rel="noopener">Source code</a>
      &middot;
      <a href="#about">About</a>
      &middot;
      <a href="https://www.hlekkir.is" target="_blank" rel="noopener">hlekkir.is</a>
    </footer>
    <WelcomeDialog v-if="welcome" />
  </main>
</template>
