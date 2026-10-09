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
import HelpTip from './HelpTip.vue';

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
      <p class="intro">
        bikeboi is a side-scrolling game for bike trainers. Connect your trainer and any accessories, pick a circuit or string a few together, and start riding.
        An account is optional, but keeps your rides and settings across devices. Works on phones, tablets and PCs; Chrome is preferred.
      </p>
    </div>
    <div class="group">
      <HelpTip title="Devices">
        <p>Devices connect over Bluetooth from the browser, which needs Web Bluetooth: Chrome or Edge on Android, Windows, macOS or Linux. Safari and iPhones cannot connect.</p>
        <ul>
          <li><strong>Trainer</strong> — needed for a real ride. It sends your power and cadence and takes the road's gradient. Any FTMS trainer should work, FE-C ones too. Without one, "Ride with simulated power" lets you try everything with a slider instead; such rides don't count.</li>
          <li><strong>Heart rate</strong> — optional, but worth it: it goes into the ride file, the graphs and intervals.icu.</li>
          <li><strong>Zwift Click</strong> — optional. Its two buttons shift the virtual gears. Without one, shift with the + and − buttons on screen or the up / down arrow keys. Other shifters are not supported.</li>
        </ul>
        <p>Keep the trainer awake and close to the phone; a dropped connection reconnects on its own when it can.</p>
      </HelpTip>
      <section>
        <h2>Devices</h2>
        <DeviceList />
      </section>
    </div>
    <div class="group">
      <HelpTip title="Circuits and routes">
        <p>Tap a circuit to select it; the Ride button rides laps of it until you stop. Each card shows its profile, length, climb and steepest gradient, an estimate at 75% of your FTP, and your best lap.</p>
        <ul>
          <li><strong>+ Route</strong> adds the whole circuit to a route. A route is several circuits ridden one after another as a single lap, in the order you add them; it gets its own profile and best lap. Ride it from the route bar.</li>
          <li><strong>+ To the top</strong> adds only the climb: the leg ends at the summit and you are put straight back at the start of the next leg. Add the same hill twice for repeats.</li>
          <li><strong>Scene</strong> changes the look of the ride (daylight, sunset, rain, midnight, Tron…); "Circuit default" uses each circuit's own.</li>
        </ul>
        <p>Climbs, descents and sprints on a circuit are timed as segments, and your best on each rides beside you as a ghost.</p>
      </HelpTip>
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
      <HelpTip title="The pacemaker">
        <p>A robot rider to chase, or to be chased by. The ride shows how far ahead or behind it is and the time to catch it; it never waits for you.</p>
        <ul>
          <li><strong>Off</strong> — ride alone, against your ghost.</li>
          <li><strong>Steady watts</strong> — the robot rides the course at one power. Pick a number near your FTP for a hard lap, below it for company.</li>
          <li><strong>Workout</strong> — the robot follows a structured workout (warm-up, intervals, cool-down) written in the intervals.icu format, scaled to your FTP; pick a built-in one or write your own. The ride shows the current step and what comes next.</li>
          <li><strong>Hard mode</strong> — instead of simulating the road, the trainer holds the pacemaker's power for you (ERG), whatever your cadence. The + and − buttons then make the whole session 5% harder or easier rather than changing gear.</li>
        </ul>
      </HelpTip>
      <section>
        <h2>Pacemaker</h2>
        <PacerEditor />
      </section>
    </div>
    <!-- signed-in riders find these under the user icon instead -->
    <div v-if="account.status !== 'in'" class="group">
      <HelpTip title="Rider and setup">
        <p>Your weight, the bike's weight and your FTP set how fast you go for a given power and what the zones and estimates mean; get FTP roughly right and the rest follows. Hill difficulty scales how much of each gradient the trainer makes you feel, without changing your speed. Gear feel picks the model behind the virtual gears. The rider's look is just for you.</p>
        <p>With an account these live on your account page instead and follow you between devices.</p>
      </HelpTip>
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
