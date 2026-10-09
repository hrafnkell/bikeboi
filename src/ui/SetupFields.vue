<script setup lang="ts">
// Weight, FTP, gear feel and hill difficulty.
import { devices } from '../ble/devices.ts';
import { clamp } from '../format.ts';
import { saveSettings } from '../state.ts';
import type { GearMode } from '../state.ts';
import { settingsR } from './store.ts';
import { massToKg, massValue, unitLabels } from './units.ts';

function setNumber(e: Event, key: 'riderMass' | 'bikeMass' | 'ftp', min: number, max: number) {
  const input = e.target as HTMLInputElement;
  const v = Number(input.value);
  settingsR[key] = Number.isFinite(v) ? clamp(Math.round(v), min, max) : settingsR[key];
  input.value = String(settingsR[key]);
  saveSettings();
  devices.setRiderMass(settingsR.riderMass, settingsR.bikeMass);
}
/** Weights are typed in the chosen unit and kept in kg. */
function setMass(e: Event, key: 'riderMass' | 'bikeMass', min: number, max: number) {
  const input = e.target as HTMLInputElement;
  const v = Number(input.value);
  if (Number.isFinite(v)) settingsR[key] = clamp(Math.round(massToKg(v)), min, max);
  input.value = String(Math.round(massValue(settingsR[key])));
  saveSettings();
  devices.setRiderMass(settingsR.riderMass, settingsR.bikeMass);
}
function setUnits(e: Event) {
  settingsR.units = (e.target as HTMLSelectElement).value === 'imperial' ? 'imperial' : 'metric';
  saveSettings();
}
function setGearMode(e: Event) {
  settingsR.gearMode = (e.target as HTMLSelectElement).value as GearMode;
  saveSettings();
}
function setDifficulty(e: Event) {
  settingsR.difficulty = clamp(Number((e.target as HTMLInputElement).value) / 100, 0, 1);
  saveSettings();
}
</script>

<template>
  <div class="settings">
    <label class="field">
      <span>Units</span>
      <select :value="settingsR.units" @change="setUnits">
        <option value="metric">Metric (km, m, kg)</option>
        <option value="imperial">Imperial (mi, ft, lb)</option>
      </select>
    </label>
    <label class="field">
      <span>Rider weight</span>
      <input type="number" :min="Math.round(massValue(30))" :max="Math.round(massValue(200))" step="1" :value="Math.round(massValue(settingsR.riderMass))" inputmode="numeric" @change="setMass($event, 'riderMass', 30, 200)" />
      <em>{{ unitLabels().mass }}</em>
    </label>
    <label class="field">
      <span>Bike weight</span>
      <input type="number" :min="Math.round(massValue(4))" :max="Math.round(massValue(30))" step="1" :value="Math.round(massValue(settingsR.bikeMass))" inputmode="numeric" @change="setMass($event, 'bikeMass', 4, 30)" />
      <em>{{ unitLabels().mass }}</em>
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
</template>
