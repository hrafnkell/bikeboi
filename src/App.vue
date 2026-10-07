<script setup lang="ts">
// Screens and the tiny hash router: '' is the start screen, '#about' the About page,
// '#rides' the account's ride history, '#user' the account page.
// The ride and the summary are app state, not addresses; while one is up, the address
// bar does not drive the screen (the ride traps the back gesture itself).
import { onMounted, onUnmounted, shallowRef } from 'vue';
import RidesScreen from './account/RidesScreen.vue';
import UserScreen from './account/UserScreen.vue';
import { account, refresh } from './account/session.ts';
import { startSync } from './sync/index.ts';
import { enqueue, flushUploads } from './sync/upload-queue.ts';
import type { Circuit } from './ride/circuit.ts';
import type { RideOutcome } from './ride/outcome.ts';
import type { SavedRide } from './ride/ride-store.ts';
import { devices } from './ble/devices.ts';
import { peakPowers } from './ride/peaks.ts';
import AboutScreen from './ui/AboutScreen.vue';
import HomeScreen from './ui/HomeScreen.vue';
import RideScreen from './ui/RideScreen.vue';
import SummaryScreen from './ui/SummaryScreen.vue';

type Screen =
  | { kind: 'home' }
  | { kind: 'about' }
  | { kind: 'rides' }
  | { kind: 'user' }
  | { kind: 'ride'; circuit: Circuit; resume: SavedRide | null; id: number }
  | { kind: 'summary'; outcome: RideOutcome };

const screen = shallowRef<Screen>({ kind: 'home' });
let rides = 0;

function busy(): boolean {
  return screen.value.kind === 'ride' || screen.value.kind === 'summary';
}

function route() {
  if (busy()) return;
  if (location.hash === '#about') screen.value = { kind: 'about' };
  else if (location.hash === '#rides' && account.status === 'in') screen.value = { kind: 'rides' };
  else if (location.hash === '#user' && account.status === 'in') screen.value = { kind: 'user' };
  else screen.value = { kind: 'home' };
}

function ride(circuit: Circuit, resume: SavedRide | null = null) {
  screen.value = { kind: 'ride', circuit, resume, id: ++rides };
}

function leaveSub() {
  // drop the hash without leaving a bare "#" in the address
  history.pushState(null, '', location.pathname + location.search);
  route();
}

function rideEnded(outcome: RideOutcome) {
  screen.value = { kind: 'summary', outcome };
  // simulated rides are for trying the game: they are never saved to the account
  if (outcome.finished && !outcome.simulated && account.status === 'in') {
    void enqueue(outcome.finished, {
      pacer: outcome.pacer?.power ?? null,
      workout: outcome.workout?.name ?? null,
      laps: outcome.laps.length,
      trainer: devices.info('trainer').name,
      peaks: peakPowers(outcome.finished.ride.samples.map((s) => s.power)),
    }).then(() => flushUploads());
  }
}

function home() {
  screen.value = { kind: 'home' };
  route();
}

onMounted(() => {
  window.addEventListener('hashchange', route);
  window.addEventListener('popstate', route);
  route();
  void refresh().then(() => {
    startSync();
    // a #rides link opened before we knew who was signed in
    if (location.hash === '#rides' || location.hash === '#user') route();
  });
});
onUnmounted(() => {
  window.removeEventListener('hashchange', route);
  window.removeEventListener('popstate', route);
});
</script>

<template>
  <HomeScreen v-if="screen.kind === 'home'" @start="ride($event)" @resume="(c, r) => ride(c, r)" />
  <AboutScreen v-else-if="screen.kind === 'about'" @back="leaveSub" />
  <RidesScreen v-else-if="screen.kind === 'rides'" @back="leaveSub" />
  <UserScreen v-else-if="screen.kind === 'user'" @back="leaveSub" />
  <RideScreen
    v-else-if="screen.kind === 'ride'"
    :key="screen.id"
    :circuit="screen.circuit"
    :resume="screen.resume"
    @end="rideEnded"
  />
  <SummaryScreen v-else :outcome="screen.outcome" @done="home" />
</template>
