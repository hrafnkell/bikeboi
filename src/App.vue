<script setup lang="ts">
// Screens and the tiny hash router: '' is the start screen, '#about' the About page.
// The ride and the summary are app state, not addresses; while one is up, the address
// bar does not drive the screen (the ride traps the back gesture itself).
import { onMounted, onUnmounted, shallowRef } from 'vue';
import type { Circuit } from './ride/circuit.ts';
import type { RideOutcome } from './ride/outcome.ts';
import type { SavedRide } from './ride/ride-store.ts';
import AboutScreen from './ui/AboutScreen.vue';
import HomeScreen from './ui/HomeScreen.vue';
import RideScreen from './ui/RideScreen.vue';
import SummaryScreen from './ui/SummaryScreen.vue';

type Screen =
  | { kind: 'home' }
  | { kind: 'about' }
  | { kind: 'ride'; circuit: Circuit; resume: SavedRide | null; id: number }
  | { kind: 'summary'; outcome: RideOutcome };

const screen = shallowRef<Screen>({ kind: 'home' });
let rides = 0;

function busy(): boolean {
  return screen.value.kind === 'ride' || screen.value.kind === 'summary';
}

function route() {
  if (busy()) return;
  screen.value = location.hash === '#about' ? { kind: 'about' } : { kind: 'home' };
}

function ride(circuit: Circuit, resume: SavedRide | null = null) {
  screen.value = { kind: 'ride', circuit, resume, id: ++rides };
}

function leaveAbout() {
  // drop the hash without leaving a bare "#" in the address
  history.pushState(null, '', location.pathname + location.search);
  route();
}

function rideEnded(outcome: RideOutcome) {
  screen.value = { kind: 'summary', outcome };
}

function home() {
  screen.value = { kind: 'home' };
  route();
}

onMounted(() => {
  window.addEventListener('hashchange', route);
  window.addEventListener('popstate', route);
  route();
});
onUnmounted(() => {
  window.removeEventListener('hashchange', route);
  window.removeEventListener('popstate', route);
});
</script>

<template>
  <HomeScreen v-if="screen.kind === 'home'" @start="ride($event)" @resume="(c, r) => ride(c, r)" />
  <AboutScreen v-else-if="screen.kind === 'about'" @back="leaveAbout" />
  <RideScreen
    v-else-if="screen.kind === 'ride'"
    :key="screen.id"
    :circuit="screen.circuit"
    :resume="screen.resume"
    @end="rideEnded"
  />
  <SummaryScreen v-else :outcome="screen.outcome" @done="home" />
</template>
