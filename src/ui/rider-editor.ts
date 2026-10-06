// Rider customisation with a live pedalling preview.

import {
  defaultRiderLook, drawRiderFigure, paintFor, spokeStyles,
} from '../game/rider.ts';
import type { RiderLook } from '../game/rider.ts';
import { saveSettings, settings } from '../state.ts';
import { h } from './dom.ts';

type ColorKey = 'helmetColor' | 'hairColor' | 'skinColor' | 'jerseyColor' | 'pantsColor' | 'frameColor' | 'tyreColor';

export function riderEditor(): { el: HTMLElement; dispose(): void } {
  const look = settings.rider;
  let paint = paintFor(look);
  const refreshers: Array<() => void> = [];

  function changed() {
    paint = paintFor(look);
    saveSettings();
  }

  function colorInput(key: ColorKey): HTMLInputElement {
    const input = h('input', { type: 'color', value: look[key], 'aria-label': key });
    input.addEventListener('input', () => {
      look[key] = input.value;
      changed();
    });
    refreshers.push(() => (input.value = look[key]));
    return input;
  }

  function choice<K extends 'sleeves' | 'pants' | 'spokes'>(
    key: K, options: Array<{ id: RiderLook[K]; name: string }>,
  ): HTMLSelectElement {
    const select = h('select', { 'aria-label': key },
      ...options.map((o) => h('option', { value: o.id }, o.name)),
    );
    select.value = look[key];
    select.addEventListener('change', () => {
      look[key] = select.value as RiderLook[K];
      changed();
    });
    refreshers.push(() => (select.value = look[key]));
    return select;
  }

  const helmetToggle = h('input', { type: 'checkbox', 'aria-label': 'Wear a helmet' });
  helmetToggle.checked = look.helmet;
  helmetToggle.addEventListener('change', () => {
    look.helmet = helmetToggle.checked;
    changed();
  });
  refreshers.push(() => (helmetToggle.checked = look.helmet));

  const field = (label: string, ...controls: HTMLElement[]) =>
    h('label', { class: 'field' }, h('span', null, label), ...controls);

  const reset = h('button', { class: 'btn' }, 'Reset look');
  reset.addEventListener('click', () => {
    Object.assign(look, defaultRiderLook);
    refreshers.forEach((fn) => fn());
    changed();
  });

  const controls = h('div', { class: 'rider-controls' },
    field('Jersey', choice('sleeves', [{ id: 'short', name: 'Short sleeves' }, { id: 'long', name: 'Long sleeves' }]), colorInput('jerseyColor')),
    field('Pants', choice('pants', [{ id: 'shorts', name: 'Shorts' }, { id: 'tights', name: 'Tights' }]), colorInput('pantsColor')),
    field('Helmet', helmetToggle, colorInput('helmetColor')),
    field('Hair', colorInput('hairColor')),
    field('Skin', colorInput('skinColor')),
    field('Frame', colorInput('frameColor')),
    field('Tyres', colorInput('tyreColor')),
    field('Wheels', choice('spokes', spokeStyles)),
    reset,
  );

  // --- preview -----------------------------------------------------------------
  const canvas = h('canvas', { class: 'rider-preview' });
  const ctx = canvas.getContext('2d');
  let raf = 0;
  let last = performance.now();
  let crank = 0;
  let wheel = 0;

  function frame(now: number) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    crank += (80 / 60) * Math.PI * 2 * dt;
    wheel += 9 * dt;
    const w = canvas.clientWidth;
    const hgt = canvas.clientHeight;
    if (ctx && w > 0 && hgt > 0) {
      const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(hgt * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(hgt * dpr);
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
      drawRiderFigure(ctx, paint, { crank, wheel, headlight: false });
      ctx.restore();
    }
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  const el = h('div', { class: 'rider-editor' },
    h('div', { class: 'rider-preview-wrap' },
      canvas,
      h('p', { class: 'note' }, 'The Tron scene swaps in neon colours; shapes still apply.'),
    ),
    controls,
  );

  return { el, dispose: () => cancelAnimationFrame(raf) };
}
