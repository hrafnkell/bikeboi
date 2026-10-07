<script setup lang="ts">
// Rider customisation with a live pedalling preview.
import { computed, onBeforeUnmount, onMounted, useTemplateRef } from 'vue';
import { defaultRiderLook, drawRiderFigure, paintFor, spokeStyles } from '../game/rider.ts';
import type { RiderLook } from '../game/rider.ts';
import { saveSettings } from '../state.ts';
import { settingsR } from './store.ts';

type ColorKey = 'helmetColor' | 'hairColor' | 'skinColor' | 'jerseyColor' | 'pantsColor' | 'frameColor' | 'tyreColor';

const look = settingsR.rider;
const paint = computed(() => paintFor(look));

function setColor(key: ColorKey, e: Event) {
  look[key] = (e.target as HTMLInputElement).value;
  saveSettings();
}

function setChoice<K extends 'sleeves' | 'pants' | 'spokes'>(key: K, e: Event) {
  look[key] = (e.target as HTMLSelectElement).value as RiderLook[K];
  saveSettings();
}

function setHelmet(e: Event) {
  look.helmet = (e.target as HTMLInputElement).checked;
  saveSettings();
}

function reset() {
  Object.assign(look, defaultRiderLook);
  saveSettings();
}

// --- preview -----------------------------------------------------------------
const canvas = useTemplateRef<HTMLCanvasElement>('canvas');
let raf = 0;
let last = 0;
let crank = 0;
let wheel = 0;

function frame(now: number) {
  const el = canvas.value;
  const ctx = el?.getContext('2d');
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  crank += (80 / 60) * Math.PI * 2 * dt;
  wheel += 9 * dt;
  if (el && ctx) {
    const w = el.clientWidth;
    const hgt = el.clientHeight;
    if (w > 0 && hgt > 0) {
      const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
      if (el.width !== Math.round(w * dpr) || el.height !== Math.round(hgt * dpr)) {
        el.width = Math.round(w * dpr);
        el.height = Math.round(hgt * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const sky = ctx.createLinearGradient(0, 0, 0, hgt);
      sky.addColorStop(0, '#3a86c8');
      sky.addColorStop(1, '#cfe8f7');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, w, hgt);
      const ground = hgt * 0.86;
      ctx.fillStyle = '#44474f';
      ctx.fillRect(0, ground, w, 5);
      ctx.fillStyle = '#6a994e';
      ctx.fillRect(0, ground + 5, w, hgt);
      // road dashes scrolling past
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      const offset = (wheel * 20) % 60;
      for (let x = -offset; x < w; x += 60) ctx.fillRect(x, ground + 2, 18, 2);

      const s = Math.min(w / 2.3, (ground - 8) / 1.75);
      ctx.save();
      ctx.translate(w / 2 - 0.5 * s, ground);
      ctx.scale(s, -s);
      drawRiderFigure(ctx, paint.value, { crank, wheel, headlight: false });
      ctx.restore();
    }
  }
  raf = requestAnimationFrame(frame);
}

onMounted(() => {
  last = performance.now();
  raf = requestAnimationFrame(frame);
});
onBeforeUnmount(() => cancelAnimationFrame(raf));
</script>

<template>
  <div class="rider-editor">
    <div class="rider-preview-wrap">
      <canvas ref="canvas" class="rider-preview"></canvas>
      <p class="note">The Tron scene swaps in neon colours; shapes still apply.</p>
    </div>
    <div class="rider-controls">
      <label class="field">
        <span>Jersey</span>
        <select aria-label="sleeves" :value="look.sleeves" @change="setChoice('sleeves', $event)">
          <option value="short">Short sleeves</option>
          <option value="long">Long sleeves</option>
        </select>
        <input type="color" :value="look.jerseyColor" aria-label="jerseyColor" @input="setColor('jerseyColor', $event)" />
      </label>
      <label class="field">
        <span>Pants</span>
        <select aria-label="pants" :value="look.pants" @change="setChoice('pants', $event)">
          <option value="shorts">Shorts</option>
          <option value="tights">Tights</option>
        </select>
        <input type="color" :value="look.pantsColor" aria-label="pantsColor" @input="setColor('pantsColor', $event)" />
      </label>
      <label class="field">
        <span>Helmet</span>
        <input type="checkbox" aria-label="Wear a helmet" :checked="look.helmet" @change="setHelmet" />
        <input type="color" :value="look.helmetColor" aria-label="helmetColor" @input="setColor('helmetColor', $event)" />
      </label>
      <label class="field">
        <span>Hair</span>
        <input type="color" :value="look.hairColor" aria-label="hairColor" @input="setColor('hairColor', $event)" />
      </label>
      <label class="field">
        <span>Skin</span>
        <input type="color" :value="look.skinColor" aria-label="skinColor" @input="setColor('skinColor', $event)" />
      </label>
      <label class="field">
        <span>Frame</span>
        <input type="color" :value="look.frameColor" aria-label="frameColor" @input="setColor('frameColor', $event)" />
      </label>
      <label class="field">
        <span>Tyres</span>
        <input type="color" :value="look.tyreColor" aria-label="tyreColor" @input="setColor('tyreColor', $event)" />
      </label>
      <label class="field">
        <span>Wheels</span>
        <select aria-label="spokes" :value="look.spokes" @change="setChoice('spokes', $event)">
          <option v-for="s in spokeStyles" :key="s.id" :value="s.id">{{ s.name }}</option>
        </select>
      </label>
      <button class="btn" @click="reset">Reset look</button>
    </div>
  </div>
</template>
