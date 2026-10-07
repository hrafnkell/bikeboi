<script setup lang="ts">
// Pacemaker settings: off, steady watts, or a structured workout (built-in or your own).
import { computed, nextTick, ref, useTemplateRef } from 'vue';
import { clamp, fmtClock } from '../format.ts';
import { parseWorkout } from '../ride/workout.ts';
import type { ParsedWorkout } from '../ride/workout.ts';
import { deleteWorkout, listWorkouts, saveWorkout } from '../ride/workouts.ts';
import { saveSettings } from '../state.ts';
import type { PacerMode } from '../state.ts';
import { settingsR } from './store.ts';
import WorkoutThumb from './WorkoutThumb.vue';

const EXAMPLE = `Warmup
- 10m ramp 50-75%

Main Set 3x
- 10m 240w
- 2m 180w

Cooldown
- 8m 55%`;

const p = settingsR.pacer;

function describe(workout: ParsedWorkout): string {
  return `${fmtClock(workout.duration)} · ${workout.steps.length} ${workout.steps.length === 1 ? 'step' : 'steps'}`;
}

// --- mode and steady watts ---
function setMode(e: Event) {
  p.mode = (e.target as HTMLSelectElement).value as PacerMode;
  saveSettings();
}

function setPower(e: Event) {
  const input = e.target as HTMLInputElement;
  const v = Number(input.value);
  p.power = Number.isFinite(v) ? clamp(Math.round(v), 50, 600) : p.power;
  input.value = String(p.power);
  saveSettings();
}

function setHard(e: Event) {
  p.hard = (e.target as HTMLInputElement).checked;
  saveSettings();
}

// --- workout choice ---
const workouts = ref(listWorkouts());
function ensureChoice() {
  if (!workouts.value.some((w) => w.id === p.workoutId)) p.workoutId = workouts.value[0].id;
}
ensureChoice();
const builtIns = computed(() => workouts.value.filter((w) => w.builtIn));
const custom = computed(() => workouts.value.filter((w) => !w.builtIn));
const entry = computed(() => workouts.value.find((w) => w.id === p.workoutId) ?? null);
const parsed = computed(() => (entry.value ? parseWorkout(entry.value.text) : null));
const ownSelected = computed(() => !!entry.value && !entry.value.builtIn);

function setWorkout(e: Event) {
  p.workoutId = (e.target as HTMLSelectElement).value;
  saveSettings();
}

// --- writing your own ---
const writerOpen = ref(false);
const name = ref('');
const text = ref('');
const nameInput = useTemplateRef<HTMLInputElement>('nameInput');
const textInput = useTemplateRef<HTMLTextAreaElement>('textInput');
const draft = computed(() => parseWorkout(text.value));
const draftEmpty = computed(() => text.value.trim() === '');

async function openWriter(entryId: string | null) {
  const existing = entryId ? workouts.value.find((w) => w.id === entryId) ?? null : null;
  name.value = existing?.name ?? '';
  text.value = existing?.text ?? '';
  writerOpen.value = true;
  await nextTick();
  (existing ? textInput.value : nameInput.value)?.focus();
}

function save() {
  if (draft.value.errors.length > 0) return;
  const saved = saveWorkout(name.value, text.value);
  p.workoutId = saved.id;
  saveSettings();
  writerOpen.value = false;
  workouts.value = listWorkouts();
}

function remove() {
  deleteWorkout(p.workoutId);
  writerOpen.value = false;
  workouts.value = listWorkouts();
  ensureChoice();
  saveSettings();
}

const hint = computed(() => {
  let s = p.mode === 'off'
    ? 'A pacemaker is a rider at your weight on the same road, for you to keep up with.'
    : p.mode === 'steady'
      ? 'It holds this power for the whole ride. It rides only while your clock runs, so it waits when you stop.'
      : 'It follows the workout step by step, and the ride screen shows each target and how long is left.';
  if (p.mode !== 'off') {
    s += p.hard
      ? ' In hard mode the trainer sets the resistance so that you hold the pacemaker’s power whatever your cadence, and hills no longer change the effort. The + and − buttons make it 5% harder or easier instead of changing gear.'
      : ' The trainer still simulates the road; nothing forces your power.';
  }
  return s;
});
</script>

<template>
  <div class="pacer-editor">
    <div class="settings">
      <label class="field">
        <span>Pacemaker</span>
        <select aria-label="Pacemaker" :value="p.mode" @change="setMode">
          <option value="off">Off</option>
          <option value="steady">Steady watts</option>
          <option value="workout">Workout</option>
        </select>
      </label>
      <label class="field" :hidden="p.mode !== 'steady'">
        <span>Power</span>
        <input type="number" min="50" max="600" step="5" :value="p.power" inputmode="numeric" aria-label="Pacemaker power in watts" @change="setPower" />
        <em>W</em>
      </label>
      <label class="field" :hidden="p.mode === 'off'">
        <span>Hard mode (trainer holds the power)</span>
        <input type="checkbox" aria-label="Hard mode" :checked="p.hard" @change="setHard" />
      </label>
    </div>
    <div class="workout-box" :hidden="p.mode !== 'workout'">
      <label class="field">
        <span>Workout</span>
        <select aria-label="Workout" :value="p.workoutId" @change="setWorkout">
          <optgroup v-if="builtIns.length > 0" label="Built-in">
            <option v-for="w in builtIns" :key="w.id" :value="w.id">{{ w.name }}</option>
          </optgroup>
          <optgroup v-if="custom.length > 0" label="Yours">
            <option v-for="w in custom" :key="w.id" :value="w.id">{{ w.name }}</option>
          </optgroup>
        </select>
      </label>
      <div class="workout-preview">
        <template v-if="entry && parsed">
          <p v-if="parsed.errors.length > 0" class="note">This workout has a problem and cannot be used. Edit it to fix it.</p>
          <template v-else>
            <WorkoutThumb :workout="parsed" :ftp="settingsR.ftp" />
            <p class="note">{{ describe(parsed) }} &middot; percentages use your FTP of {{ settingsR.ftp }} W. The line marks FTP.</p>
          </template>
        </template>
      </div>
      <div class="row">
        <button class="btn" @click="openWriter(null)">Write your own</button>
        <button class="btn" :hidden="!ownSelected" @click="openWriter(p.workoutId)">Edit</button>
        <button class="btn" :hidden="!ownSelected" @click="remove">Delete</button>
      </div>
      <div class="workout-writer" :hidden="!writerOpen">
        <input ref="nameInput" v-model="name" type="text" maxlength="60" placeholder="Name" aria-label="Workout name" />
        <textarea ref="textInput" v-model="text" rows="10" spellcheck="false" :placeholder="EXAMPLE" aria-label="Workout steps"></textarea>
        <div class="workout-check">
          <template v-if="!draftEmpty">
            <ul v-if="draft.errors.length > 0" class="workout-errors">
              <li v-for="e in draft.errors.slice(0, 6)" :key="`${e.line}:${e.message}`">Line {{ e.line }}: {{ e.message }}</li>
            </ul>
            <template v-else>
              <WorkoutThumb :workout="draft" :ftp="settingsR.ftp" />
              <p class="note">{{ describe(draft) }}</p>
            </template>
          </template>
        </div>
        <div class="row">
          <button class="btn btn-primary" :disabled="draft.errors.length > 0" @click="save">Save workout</button>
          <button class="btn" @click="writerOpen = false">Cancel</button>
        </div>
        <details class="note">
          <summary>How to write steps</summary>
          <p>This is the intervals.icu workout format, so workouts can be pasted from there. One step per line, starting with a dash: a time, then a power target.</p>
          <ul>
            <li>Time: 10m, 30s, 1h, 5m30s</li>
            <li>Power: 240w, 75% (of FTP), a range such as 88-93%, or a zone such as Z2</li>
            <li>Ramp: "- 10m ramp 50-75%". Free ride: "- 5m freeride"</li>
            <li>Repeat: a line such as "3x" or "Main Set 3x" repeats the steps under it, up to the next blank line</li>
            <li>Words before the time name the step: "- Warmup 10m 60%"</li>
          </ul>
          <p>Distance steps and heart-rate or pace targets are not supported.</p>
        </details>
      </div>
    </div>
    <p class="note">{{ hint }}</p>
  </div>
</template>
