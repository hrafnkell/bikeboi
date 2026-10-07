<script setup lang="ts">
// Start screen: devices, circuit choice, scene, pacemaker, rider, setup, ride recovery.
import { computed } from 'vue';
import { devices } from '../ble/devices.ts';
import { sceneList } from '../game/scenes.ts';
import { clamp } from '../format.ts';
import type { Circuit } from '../ride/circuit.ts';
import { circuits, findCircuit } from '../ride/circuits/index.ts';
import type { SavedRide } from '../ride/ride-store.ts';
import { saveSettings } from '../state.ts';
import type { GearMode } from '../state.ts';
import CircuitCard from './CircuitCard.vue';
import DeviceList from './DeviceList.vue';
import PacerEditor from './PacerEditor.vue';
import AccountPanel from '../account/AccountPanel.vue';
import RecoveryCard from './RecoveryCard.vue';
import RiderEditor from './RiderEditor.vue';
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

// --- setup ---
function setNumber(e: Event, key: 'riderMass' | 'bikeMass' | 'ftp', min: number, max: number) {
  const input = e.target as HTMLInputElement;
  const v = Number(input.value);
  settingsR[key] = Number.isFinite(v) ? clamp(Math.round(v), min, max) : settingsR[key];
  input.value = String(settingsR[key]);
  saveSettings();
  devices.setRiderMass(settingsR.riderMass, settingsR.bikeMass);
}
function setGearMode(e: Event) {
  settingsR.gearMode = (e.target as HTMLSelectElement).value as GearMode;
  saveSettings();
}
function setDifficulty(e: Event) {
  settingsR.difficulty = clamp(Number((e.target as HTMLInputElement).value) / 100, 0, 1);
  saveSettings();
}

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
      <a class="btn" href="#about">About</a>
    </header>
    <RecoveryCard
      :resume-label="trainerOn ? 'Resume ride' : 'Resume with simulated power'"
      @resume="(c, r) => emit('resume', c, r)"
    />
    <AccountPanel />
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
    <section>
      <h2>Your rider</h2>
      <RiderEditor />
    </section>
    <section>
      <h2>Setup</h2>
      <div class="settings">
        <label class="field">
          <span>Rider weight</span>
          <input type="number" min="30" max="200" step="1" :value="settingsR.riderMass" inputmode="numeric" @change="setNumber($event, 'riderMass', 30, 200)" />
          <em>kg</em>
        </label>
        <label class="field">
          <span>Bike weight</span>
          <input type="number" min="4" max="30" step="1" :value="settingsR.bikeMass" inputmode="numeric" @change="setNumber($event, 'bikeMass', 4, 30)" />
          <em>kg</em>
        </label>
        <label class="field">
          <span>FTP</span>
          <input type="number" min="50" max="600" step="1" :value="settingsR.ftp" inputmode="numeric" @change="setNumber($event, 'ftp', 50, 600)" />
          <em>W</em>
        </label>
        <label class="field">
          <span>Gear feel</span>
          <select :value="settingsR.gearMode" @change="setGearMode">
            <option value="model">Realistic (speed-aware)</option>
            <option value="offset">Simple (fixed step per gear)</option>
          </select>
        </label>
        <label class="field">
          <span>Hill difficulty</span>
          <input type="range" min="0" max="100" step="5" :value="Math.round(settingsR.difficulty * 100)" @input="setDifficulty" />
          <em>{{ Math.round(settingsR.difficulty * 100) }}%</em>
        </label>
      </div>
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
