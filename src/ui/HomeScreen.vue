<script setup lang="ts">
// Start screen: devices, circuit choice, scene, pacemaker, ride recovery; rider and setup
// too until you sign in, after which they live on your account page.
import { computed } from 'vue';
import { sceneList } from '../game/scenes.ts';
import type { Circuit } from '../ride/circuit.ts';
import { circuitGroups, circuits, findCircuit } from '../ride/circuits/index.ts';
import type { SavedRide } from '../ride/ride-store.ts';
import { MAX_ROUTE_LEGS, saveSettings } from '../state.ts';
import { MAX_ROUTE_ID, buildRoute, routeId } from '../ride/route.ts';
import RouteBar from './RouteBar.vue';
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

// --- route: circuits strung together, kept in settings so it survives a reload ---
const route = computed<Circuit | null>(() => {
  const legs = settingsR.route
    .map((l) => ({ circuit: circuits.find((c) => c.id === l.id), toTop: l.toTop }))
    .filter((l): l is { circuit: Circuit; toTop: boolean } => !!l.circuit);
  if (legs.length === 0) return null;
  const built = buildRoute(legs);
  return built.id.length <= MAX_ROUTE_ID ? built : null;
});
function addLeg(circuit: Circuit, toTop: boolean) {
  if (settingsR.route.length >= MAX_ROUTE_LEGS) return;
  const next = [...settingsR.route, { id: circuit.id, toTop }];
  if (routeId(next).length > MAX_ROUTE_ID) return;
  settingsR.route = next;
  saveSettings();
}
function removeLeg(index: number) {
  settingsR.route = settingsR.route.filter((_, i) => i !== index);
  saveSettings();
}
function clearRoute() {
  settingsR.route = [];
  saveSettings();
}

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

function setWarmup(on: boolean) {
  settingsR.warmup = on;
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
      <div class="home-head-actions">
        <a class="btn" href="#about">About</a>
        <UserButton />
      </div>
    </header>
    <RecoveryCard
      :resume-label="trainerOn ? 'Resume ride' : 'Resume with simulated power'"
      @resume="(c, r) => emit('resume', c, r)"
    />
    <div class="group">
        Bikeboi is a side scrolling game for bike trainers. Connect your trainer and any accessories, pick a track or a combo of tracks and start riding.<br/>
        Account is optional, but will keep your rides and settings between different devices.<br/>
        Bikeboi works on phones, tablets and PCs. Chrome is preferred.

    </div>
    <div class="group">
      <section>
        <h2>Devices</h2>
        <DeviceList />
      </section>
    </div>
    <div class="group">
      <section>
        <h2>Circuit</h2>
        <div v-for="g in circuitGroups" :key="g.id" class="circuit-group">
          <h3>{{ g.name }} <span class="note">{{ g.blurb }}</span></h3>
          <div class="circuit-list">
            <CircuitCard
              v-for="c in g.circuits"
              :key="c.id"
              :circuit="c"
              :selected="c.id === selected.id"
              @select="select(c)"
              @add="(top) => addLeg(c, top)"
            />
          </div>
        </div>
        <RouteBar v-if="route" :route="route" @remove="removeLeg" @clear="clearRoute" @ride="emit('start', route!)" />
        <p v-else class="note">Use + Route on the cards to string circuits together, in order, into one lap. + To the top takes only the climb: at the summit you are put back at the start of the route.</p>
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
    </div>
    <div class="group">
      <section>
        <h2>Pacemaker</h2>
        <PacerEditor />
      </section>
    </div>
    <!-- signed-in riders find these under the user icon instead -->
    <div v-if="account.status !== 'in'" class="group">
      <section>
        <h2>Your rider</h2>
        <RiderEditor />
      </section>
      <section>
        <h2>Setup</h2>
        <SetupFields />
      </section>
    </div>
    <p v-else class="note">Your weight, FTP and your rider’s look are on your account page: the user icon at the top.</p>
    <label class="check">
      <input type="checkbox" :checked="settingsR.warmup" @change="setWarmup(($event.target as HTMLInputElement).checked)" />
      Warm up first: spin on a flat road for as long as you like, then press Start the ride. The warm-up is in the ride file and the totals, but sets no times.
    </label>
    <p class="note">Shift with the Click, the on-screen buttons or the up / down arrow keys.</p>
    <div class="start-row">
      <button class="btn btn-primary btn-start" @click="emit('start', selected)">
        {{ trainerOn ? 'Ride' : 'Ride with simulated power' }}
      </button>
      <button class="btn btn-start btn-surprise" title="Ride a random circuit" @click="emit('start', circuits[Math.floor(Math.random() * circuits.length)])">
        Surprise me
      </button>
    </div>
    <p v-if="!trainerOn" class="note">
      Simulated power lets you try the game without a trainer. Simulated rides don’t count: no best laps or segment bests are kept, and they are not saved to your account.
    </p>
    <footer class="footer">
      bikeboi is free software under the AGPL-3.0, built on bluetooth code from
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
