// Pacemaker settings: off, steady watts, or a structured workout (built-in or your own).

import { WorkoutPlan, parseWorkout } from '../ride/workout.ts';
import type { ParsedWorkout } from '../ride/workout.ts';
import { deleteWorkout, findWorkout, listWorkouts, saveWorkout } from '../ride/workouts.ts';
import { saveSettings, settings } from '../state.ts';
import type { PacerMode } from '../state.ts';
import { clamp, fmtClock, h } from './dom.ts';

const NS = 'http://www.w3.org/2000/svg';
const EXAMPLE = `Warmup
- 10m ramp 50-75%

Main Set 3x
- 10m 240w
- 2m 180w

Cooldown
- 8m 55%`;

/** Power-over-time thumbnail of a workout, with a line at FTP. */
function thumbnail(workout: ParsedWorkout, ftp: number): SVGSVGElement {
  const W = 300;
  const H = 56;
  const plan = new WorkoutPlan(workout, ftp);
  const top = Math.max(ftp * 1.3, ...plan.steps.map((s) => Math.max(s.from, s.to))) * 1.05;
  const y = (w: number) => H - (w / top) * H;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('class', 'workout-thumb');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `Workout shape: ${plan.steps.length} steps over ${fmtClock(plan.duration)}`);
  for (const s of plan.steps) {
    const x0 = (s.start / plan.duration) * W;
    const x1 = Math.max(x0 + 0.5, (s.end / plan.duration) * W - 0.6);
    const shape = document.createElementNS(NS, 'polygon');
    shape.setAttribute('points', `${x0},${H} ${x0},${y(s.from)} ${x1},${y(s.to)} ${x1},${H}`);
    shape.setAttribute('class', s.free ? 'free' : '');
    svg.append(shape);
  }
  const line = document.createElementNS(NS, 'line');
  line.setAttribute('x1', '0');
  line.setAttribute('x2', String(W));
  line.setAttribute('y1', String(y(ftp)));
  line.setAttribute('y2', String(y(ftp)));
  svg.append(line);
  return svg;
}

function describe(workout: ParsedWorkout): string {
  return `${fmtClock(workout.duration)} · ${workout.steps.length} ${workout.steps.length === 1 ? 'step' : 'steps'}`;
}

export function pacerEditor(): { el: HTMLElement; refresh(): void } {
  const p = settings.pacer;

  // --- mode and steady watts ---
  const mode = h('select', { 'aria-label': 'Pacemaker' },
    h('option', { value: 'off' }, 'Off'),
    h('option', { value: 'steady' }, 'Steady watts'),
    h('option', { value: 'workout' }, 'Workout'),
  );
  mode.value = p.mode;

  const power = h('input', { type: 'number', min: 50, max: 600, step: 5, value: p.power, inputmode: 'numeric', 'aria-label': 'Pacemaker power in watts' });
  power.addEventListener('change', () => {
    const v = Number(power.value);
    p.power = Number.isFinite(v) ? clamp(Math.round(v), 50, 600) : p.power;
    power.value = String(p.power);
    saveSettings();
  });
  const steadyField = h('label', { class: 'field' }, h('span', null, 'Power'), power, h('em', null, 'W'));

  // --- workout choice ---
  const choice = h('select', { 'aria-label': 'Workout' });
  const preview = h('div', { class: 'workout-preview' });
  const editBtn = h('button', { class: 'btn' }, 'Edit');
  const deleteBtn = h('button', { class: 'btn' }, 'Delete');
  const newBtn = h('button', { class: 'btn' }, 'Write your own');
  const workoutField = h('label', { class: 'field' }, h('span', null, 'Workout'), choice);

  function fillChoices() {
    const all = listWorkouts();
    if (!all.some((w) => w.id === p.workoutId)) p.workoutId = all[0].id;
    const group = (label: string, builtIn: boolean) => {
      const items = all.filter((w) => w.builtIn === builtIn);
      if (items.length === 0) return null;
      const g = h('optgroup', { label });
      for (const w of items) g.append(h('option', { value: w.id }, w.name));
      return g;
    };
    choice.replaceChildren(...[group('Built-in', true), group('Yours', false)].filter((g): g is HTMLOptGroupElement => g !== null));
    choice.value = p.workoutId;
  }

  function showPreview() {
    const entry = findWorkout(p.workoutId);
    editBtn.hidden = deleteBtn.hidden = !entry || entry.builtIn;
    if (!entry) return preview.replaceChildren();
    const parsed = parseWorkout(entry.text);
    if (parsed.errors.length > 0) {
      return preview.replaceChildren(h('p', { class: 'note' }, 'This workout has a problem and cannot be used. Edit it to fix it.'));
    }
    preview.replaceChildren(
      thumbnail(parsed, settings.ftp),
      h('p', { class: 'note' }, `${describe(parsed)} · percentages use your FTP of ${settings.ftp} W. The line marks FTP.`),
    );
  }

  choice.addEventListener('change', () => {
    p.workoutId = choice.value;
    saveSettings();
    showPreview();
  });

  // --- writing your own ---
  const name = h('input', { type: 'text', maxlength: 60, placeholder: 'Name', 'aria-label': 'Workout name' });
  const text = h('textarea', { rows: 10, spellcheck: 'false', placeholder: EXAMPLE, 'aria-label': 'Workout steps' });
  const check = h('div', { class: 'workout-check' });
  const saveBtn = h('button', { class: 'btn btn-primary' }, 'Save workout');
  const cancelBtn = h('button', { class: 'btn' }, 'Cancel');
  const writer = h('div', { class: 'workout-writer', hidden: true },
    name,
    text,
    check,
    h('div', { class: 'row' }, saveBtn, cancelBtn),
    h('details', { class: 'note' },
      h('summary', null, 'How to write steps'),
      h('p', null, 'This is the intervals.icu workout format, so workouts can be pasted from there. One step per line, starting with a dash: a time, then a power target.'),
      h('ul', null,
        h('li', null, 'Time: 10m, 30s, 1h, 5m30s'),
        h('li', null, 'Power: 240w, 75% (of FTP), a range such as 88-93%, or a zone such as Z2'),
        h('li', null, 'Ramp: "- 10m ramp 50-75%". Free ride: "- 5m freeride"'),
        h('li', null, 'Repeat: a line such as "3x" or "Main Set 3x" repeats the steps under it, up to the next blank line'),
        h('li', null, 'Words before the time name the step: "- Warmup 10m 60%"'),
      ),
      h('p', null, 'Distance steps and heart-rate or pace targets are not supported.'),
    ),
  );

  function validate(): ParsedWorkout {
    const parsed = parseWorkout(text.value);
    if (text.value.trim() === '') {
      check.replaceChildren();
    } else if (parsed.errors.length > 0) {
      check.replaceChildren(
        h('ul', { class: 'workout-errors' }, ...parsed.errors.slice(0, 6).map((e) => h('li', null, `Line ${e.line}: ${e.message}`))),
      );
    } else {
      check.replaceChildren(thumbnail(parsed, settings.ftp), h('p', { class: 'note' }, describe(parsed)));
    }
    saveBtn.disabled = parsed.errors.length > 0;
    return parsed;
  }
  text.addEventListener('input', validate);

  function openWriter(entryId: string | null) {
    const entry = entryId ? findWorkout(entryId) : null;
    name.value = entry?.name ?? '';
    text.value = entry?.text ?? '';
    writer.hidden = false;
    validate();
    (entry ? text : name).focus();
  }
  newBtn.addEventListener('click', () => openWriter(null));
  editBtn.addEventListener('click', () => openWriter(p.workoutId));
  cancelBtn.addEventListener('click', () => (writer.hidden = true));
  saveBtn.addEventListener('click', () => {
    if (validate().errors.length > 0) return;
    const saved = saveWorkout(name.value, text.value);
    p.workoutId = saved.id;
    saveSettings();
    writer.hidden = true;
    fillChoices();
    showPreview();
  });
  deleteBtn.addEventListener('click', () => {
    deleteWorkout(p.workoutId);
    writer.hidden = true;
    fillChoices();
    saveSettings();
    showPreview();
  });

  const workoutBox = h('div', { class: 'workout-box' },
    workoutField,
    preview,
    h('div', { class: 'row' }, newBtn, editBtn, deleteBtn),
    writer,
  );

  const hardToggle = h('input', { type: 'checkbox', 'aria-label': 'Hard mode' });
  hardToggle.checked = p.hard;
  hardToggle.addEventListener('change', () => {
    p.hard = hardToggle.checked;
    saveSettings();
    showMode();
  });
  const hardField = h('label', { class: 'field' }, h('span', null, 'Hard mode (trainer holds the power)'), hardToggle);

  const hint = h('p', { class: 'note' });
  function showMode() {
    steadyField.hidden = p.mode !== 'steady';
    workoutBox.hidden = p.mode !== 'workout';
    hardField.hidden = p.mode === 'off';
    hint.textContent = p.mode === 'off'
      ? 'A pacemaker is a rider at your weight on the same road, for you to keep up with.'
      : p.mode === 'steady'
        ? 'It holds this power for the whole ride. It rides only while your clock runs, so it waits when you stop.'
        : 'It follows the workout step by step, and the ride screen shows each target and how long is left.';
    if (p.mode !== 'off') {
      hint.textContent += p.hard
        ? ' In hard mode the trainer sets the resistance so that you hold the pacemaker\u2019s power whatever your cadence, and hills no longer change the effort. The + and \u2212 buttons make it 5% harder or easier instead of changing gear.'
        : ' The trainer still simulates the road; nothing forces your power.';
    }
  }
  mode.addEventListener('change', () => {
    p.mode = mode.value as PacerMode;
    saveSettings();
    showMode();
  });

  fillChoices();
  showPreview();
  showMode();

  const el = h('div', { class: 'pacer-editor' },
    h('div', { class: 'settings' }, h('label', { class: 'field' }, h('span', null, 'Pacemaker'), mode), steadyField, hardField),
    workoutBox,
    hint,
  );
  return { el, refresh: showPreview };
}
