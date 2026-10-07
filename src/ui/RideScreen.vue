<script setup lang="ts">
// The ride screen. All behaviour lives in the controller; this file is the HUD markup.
import { onBeforeUnmount, onMounted, useTemplateRef } from 'vue';
import { GEAR_COUNT } from '../ride/gears.ts';
import type { Circuit } from '../ride/circuit.ts';
import type { RideOutcome } from '../ride/outcome.ts';
import type { SavedRide } from '../ride/ride-store.ts';
import MetricCard from './MetricCard.vue';
import { createRideController } from './ride-controller.ts';

const props = defineProps<{ circuit: Circuit; resume: SavedRide | null }>();
const emit = defineEmits<{ end: [outcome: RideOutcome] }>();

const ctrl = createRideController(props.circuit, props.resume, (outcome) => emit('end', outcome));
const vm = ctrl.vm;
const canvas = useTemplateRef<HTMLCanvasElement>('canvas');

onMounted(() => ctrl.attach(canvas.value!));
onBeforeUnmount(() => ctrl.dispose());
</script>

<template>
  <div class="ride" :class="{ 'is-sim': ctrl.simulated, 'has-pacer': ctrl.hasPacer, 'has-workout': ctrl.hasWorkout }">
    <div class="stage">
      <canvas ref="canvas" class="stage-canvas"></canvas>
      <div class="banner" :class="{ gone: vm.bannerGone }">{{ ctrl.banner }}</div>
      <div class="toast" :class="{ show: vm.toastShow }">{{ vm.toastText }}</div>
    </div>

    <div class="hud hud-left">
      <MetricCard label="Power" unit="W" :value="vm.power" :max="vm.powerMax" :target="vm.target" :target-on="vm.targetOn" big />
      <MetricCard label="Cadence" unit="rpm" :value="vm.cadence" :max="vm.cadenceMax" />
      <MetricCard label="Heart" unit="bpm" :value="vm.heart" :max="vm.heartMax" />
      <MetricCard label="Burned" unit="kcal" :value="vm.kcal" />
    </div>
    <div class="hud hud-right">
      <MetricCard label="Speed" unit="km/h" :value="vm.speed" big />
      <MetricCard label="Grade" unit="%" :value="vm.grade" :color="vm.gradeColor" />
      <MetricCard label="Dist" unit="km" :value="vm.dist" />
      <MetricCard label="Climbed" unit="m" :value="vm.climb" />
    </div>

    <div class="lapbox">
      <div class="lap-row">
        <span class="lap-no">{{ vm.lapNo }}</span>
        <span class="lap-time">{{ vm.lapTime }}</span>
        <span class="lap-gap" :class="vm.lapGapSide">{{ vm.lapGap }}</span>
      </div>
      <div class="lap-row lap-row-sub">
        <span class="lap-best">{{ vm.lapBest }}</span>
        <span class="lap-elapsed">{{ vm.elapsed }}</span>
      </div>
      <div v-if="ctrl.hasWorkout" class="lap-row lap-row-sub pacer-row">
        <span class="pacer-label">{{ vm.workStep }}</span>
        <span class="work-left">{{ vm.workLeft }}</span>
        <span class="work-next">{{ vm.workNext }}</span>
      </div>
      <div v-if="ctrl.hasPacer" class="lap-row lap-row-sub pacer-row">
        <span class="pacer-label">{{ vm.pacerLabel }}</span>
        <span class="pacer-metres">{{ vm.pacerMetres }}</span>
        <span class="lap-gap" :class="vm.pacerGapSide">{{ vm.pacerGap }}</span>
      </div>
    </div>

    <div class="segbox" :hidden="!vm.segVisible" :style="{ '--seg': vm.segColor }">
      <div class="seg-row">
        <span class="seg-name">{{ vm.segName }}</span>
        <span class="seg-left">{{ vm.segLeft }}</span>
      </div>
      <div class="seg-bar"><i class="seg-fill" :style="{ width: vm.segFill }"></i></div>
      <div class="seg-row seg-row-sub">
        <span class="seg-time">{{ vm.segTime }}</span>
        <span class="seg-info">{{ vm.segInfo }}</span>
        <span class="lap-gap" :class="vm.segGapSide">{{ vm.segGap }}</span>
      </div>
    </div>

    <div class="controls">
      <button class="icon-btn pause-btn" aria-label="Pause" @click="ctrl.setPaused(true)">&#x275A;&#x275A;</button>
      <div class="gearbox">
        <div class="gear-head">
          <span class="gear-label">{{ vm.gearLabel }}</span>
          <span class="gear-no">{{ vm.gearNo }}</span>
          <span class="gear-flag">{{ vm.gearFlag }}</span>
        </div>
        <div class="pips">
          <i v-for="i in GEAR_COUNT" :key="i" class="pip" :class="{ on: i - 1 <= vm.pipsLit }"></i>
        </div>
      </div>
      <button class="icon-btn full-btn" aria-label="Fullscreen" @click="ctrl.toggleFullscreen()">&#x26F6;</button>
    </div>

    <div v-if="ctrl.simulated" class="simbox">
      <span class="sim-label">Sim power</span>
      <input
        type="range" min="0" max="600" step="5" class="sim-slider" aria-label="Simulated power"
        :value="vm.simPower" :disabled="vm.simDisabled"
        @input="ctrl.setSimPower(Number(($event.target as HTMLInputElement).value))"
      />
      <span class="sim-value">{{ vm.simPower }} W</span>
    </div>

    <button class="shift shift-down" aria-label="Easier gear" @pointerdown.prevent="ctrl.shift(-1)">&minus;</button>
    <button class="shift shift-up" aria-label="Harder gear" @pointerdown.prevent="ctrl.shift(1)">+</button>

    <div class="overlay" :hidden="!vm.paused">
      <div class="overlay-card">
        <h2>{{ vm.pauseTitle }}</h2>
        <button class="btn btn-primary" :disabled="vm.ending" @click="ctrl.setPaused(false)">Resume</button>
        <button class="btn btn-danger" :disabled="vm.ending" @click="ctrl.end()">End ride</button>
      </div>
    </div>
  </div>
</template>
