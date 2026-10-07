<script setup lang="ts">
// Weight, FTP, gear feel and hill difficulty.
import { devices } from '../ble/devices.ts';
import { clamp } from '../format.ts';
import { saveSettings } from '../state.ts';
import type { GearMode } from '../state.ts';
import { settingsR } from './store.ts';

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
</script>

<template>
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
</template>
