// Home screen: devices, circuit choice, settings, ride recovery.

import { devices } from '../ble/devices.ts';
import type { Circuit } from '../ride/circuit.ts';
import { circuits, findCircuit } from '../ride/circuits/index.ts';
import type { SavedRide } from '../ride/ride-store.ts';
import { findScene, sceneList } from '../game/scenes.ts';
import { loadGhost } from '../ride/ghost.ts';
import {
  discardSavedRide, downloadFit, encodeFit, fitFilename, recoverRide, summarize,
} from '../ride/recorder.ts';
import { saveSettings, settings } from '../state.ts';
import type { GearMode } from '../state.ts';
import type { DeviceInfo, DeviceKind } from '../types.ts';
import { clamp, fmtClock, fmtKm, fmtLap, h } from './dom.ts';
import { pacerEditor } from './pacer-editor.ts';
import { riderEditor } from './rider-editor.ts';

/** Where users of a hosted copy can get the source (AGPL section 13). */
const SOURCE_URL = 'https://github.com/hrafnkell/bikeboi';

const WELCOMED_KEY = 'bikeboi:welcomed';

/** One-time card pointing new visitors at the About page. */
function welcomeCard(): HTMLDialogElement | null {
  try {
    if (localStorage.getItem(WELCOMED_KEY)) return null;
  } catch {
    return null; // no storage: don't nag on every visit
  }
  const remember = () => {
    try {
      localStorage.setItem(WELCOMED_KEY, '1');
    } catch {
      // nothing to do
    }
  };
  const dialog = h('dialog', { class: 'welcome', 'aria-labelledby': 'welcome-title' });
  const tour = h('a', { class: 'btn btn-primary', href: '#about' }, 'Show me how it works');
  const skip = h('button', { class: 'btn' }, 'Jump straight in');
  tour.addEventListener('click', () => dialog.close());
  skip.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', remember);
  dialog.addEventListener('cancel', remember); // Esc: fires before the close event
  dialog.append(
    h('h2', { id: 'welcome-title' }, 'Welcome to bikeboi'),
    h('p', null,
      'A side-scrolling game for your indoor trainer: ride laps, chase your own ghost, shift virtual gears. It needs Chrome or Edge and a Bluetooth trainer, or you can try it with simulated power.',
    ),
    h('div', { class: 'row' }, tour, skip),
  );
  return dialog;
}

const deviceLabels: Record<DeviceKind, string> = {
  trainer: 'Trainer',
  hrm: 'Heart rate',
  click: 'Zwift Click',
};

function profileSvg(circuit: Circuit): SVGSVGElement {
  const w = 200;
  const hgt = 48;
  const range = Math.max(8, circuit.maxAltitude - circuit.minAltitude);
  const pts: string[] = [`0,${hgt}`];
  for (let i = 0; i <= 100; i++) {
    const a = (circuit.altitudeAt((i / 100) * circuit.length) - circuit.minAltitude) / range;
    pts.push(`${(i / 100) * w},${(hgt - 4 - a * (hgt - 10)).toFixed(1)}`);
  }
  pts.push(`${w},${hgt}`);
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${hgt}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('class', 'profile');
  const poly = document.createElementNS(ns, 'polygon');
  poly.setAttribute('points', pts.join(' '));
  svg.append(poly);
  return svg;
}

export function renderHome(
  root: HTMLElement,
  opts: { onStart(circuit: Circuit): void; onResume(circuit: Circuit, ride: SavedRide): void },
): () => void {
  let selected = findCircuit(settings.lastCircuitId);
  let disposed = false;

  // --- devices ---------------------------------------------------------------
  const rows = new Map<DeviceKind, { status: HTMLElement; button: HTMLButtonElement }>();
  const startBtn = h('button', { class: 'btn btn-primary btn-start' }, 'Ride');
  const resumeBtn = h('button', { class: 'btn btn-primary' }, 'Resume ride');

  function describe(info: DeviceInfo): string {
    if (info.status === 'connecting') return info.name ? `Connecting to ${info.name}…` : 'Connecting…';
    if (info.status === 'disconnected') return 'Not connected';
    const battery = info.battery !== null ? ` · ${info.battery}%` : '';
    if (info.kind === 'trainer' && !info.controllable) {
      return `${info.name || 'Connected'} · power only, no resistance control${battery}`;
    }
    return `${info.name || 'Connected'}${battery}`;
  }

  function renderDevice(info: DeviceInfo) {
    const row = rows.get(info.kind);
    if (!row) return;
    row.status.textContent = describe(info);
    row.status.classList.toggle('ok', info.status === 'connected');
    row.button.textContent =
      info.status === 'connected' ? 'Disconnect' : info.status === 'connecting' ? 'Cancel' : 'Connect';
    if (info.kind === 'trainer') {
      startBtn.textContent = info.status === 'connected' ? 'Ride' : 'Ride with simulated power';
      resumeBtn.textContent = info.status === 'connected' ? 'Resume ride' : 'Resume with simulated power';
    }
  }

  const deviceList = h('div', { class: 'device-list' });
  for (const kind of ['trainer', 'hrm', 'click'] as DeviceKind[]) {
    const status = h('span', { class: 'device-status' });
    const button = h('button', { class: 'btn' }, 'Connect');
    button.disabled = !devices.supported();
    button.addEventListener('click', () => {
      if (devices.info(kind).status === 'disconnected') void devices.connect(kind);
      else void devices.disconnect(kind);
    });
    rows.set(kind, { status, button });
    deviceList.append(
      h('div', { class: 'device' },
        h('div', { class: 'device-text' }, h('strong', null, deviceLabels[kind]), status),
        button,
      ),
    );
    renderDevice(devices.info(kind));
  }
  const offDevices = devices.onChange(renderDevice);

  const noBluetooth = devices.supported()
    ? null
    : h('p', { class: 'note' },
      'This browser has no Web Bluetooth, so devices cannot connect. Use Chrome or Edge on Android or desktop. You can still ride with simulated power.',
    );

  // --- circuits --------------------------------------------------------------
  const circuitList = h('div', { class: 'circuit-list' });
  const cards = new Map<string, HTMLElement>();
  for (const circuit of circuits) {
    const ghost = loadGhost(circuit.id);
    const card = h('button', { class: 'circuit', 'aria-pressed': 'false' },
      profileSvg(circuit),
      h('strong', null, circuit.name),
      h('span', { class: 'circuit-desc' }, circuit.description),
      h('span', { class: 'circuit-stats' },
        `${fmtKm(circuit.length, 1)} km · ${Math.round(circuit.ascent)} m up · max ${(circuit.maxGrade * 100).toFixed(0)}%`,
      ),
      h('span', { class: 'circuit-stats' }, `${circuit.segments.length} ${circuit.segments.length === 1 ? 'segment' : 'segments'}`),
      h('span', { class: 'circuit-best' }, ghost ? `Best lap ${fmtLap(ghost.lapTime)}` : 'No lap yet'),
      h('span', { class: 'circuit-scene' }, findScene(circuit.scene).name),
    );
    card.addEventListener('click', () => select(circuit));
    cards.set(circuit.id, card);
    circuitList.append(card);
  }
  function select(circuit: Circuit) {
    selected = circuit;
    settings.lastCircuitId = circuit.id;
    saveSettings();
    cards.forEach((card, id) => card.setAttribute('aria-pressed', String(id === circuit.id)));
  }
  select(selected);

  // --- scene -----------------------------------------------------------------
  const sceneChips = new Map<string, HTMLElement>();
  const sceneRow = h('div', { class: 'chips' });
  const sceneOptions: Array<{ id: typeof settings.scene; name: string }> = [
    { id: 'auto', name: 'Circuit default' },
    ...sceneList.map((s) => ({ id: s.id, name: s.name })),
  ];
  function selectScene(id: typeof settings.scene) {
    settings.scene = id;
    saveSettings();
    sceneChips.forEach((chip, key) => chip.setAttribute('aria-pressed', String(key === id)));
  }
  for (const option of sceneOptions) {
    const chip = h('button', { class: 'chip', 'aria-pressed': 'false' }, option.name);
    chip.addEventListener('click', () => selectScene(option.id));
    sceneChips.set(option.id, chip);
    sceneRow.append(chip);
  }
  selectScene(sceneOptions.some((o) => o.id === settings.scene) ? settings.scene : 'auto');

  // --- settings --------------------------------------------------------------
  function numberField(label: string, unit: string, key: 'riderMass' | 'bikeMass' | 'ftp', min: number, max: number) {
    const input = h('input', { type: 'number', min, max, step: 1, value: settings[key], inputmode: 'numeric' });
    input.addEventListener('change', () => {
      const v = Number(input.value);
      settings[key] = Number.isFinite(v) ? clamp(Math.round(v), min, max) : settings[key];
      input.value = String(settings[key]);
      saveSettings();
      devices.setRiderMass(settings.riderMass, settings.bikeMass);
      if (key === 'ftp') pacer.refresh();
    });
    return h('label', { class: 'field' }, h('span', null, label), input, h('em', null, unit));
  }

  const gearSelect = h('select', null,
    h('option', { value: 'model' }, 'Realistic (speed-aware)'),
    h('option', { value: 'offset' }, 'Simple (fixed step per gear)'),
  );
  gearSelect.value = settings.gearMode;
  gearSelect.addEventListener('change', () => {
    settings.gearMode = gearSelect.value as GearMode;
    saveSettings();
  });

  const diffValue = h('em', null, `${Math.round(settings.difficulty * 100)}%`);
  const diffInput = h('input', { type: 'range', min: 0, max: 100, step: 5, value: Math.round(settings.difficulty * 100) });
  diffInput.addEventListener('input', () => {
    settings.difficulty = clamp(Number(diffInput.value) / 100, 0, 1);
    diffValue.textContent = `${Math.round(settings.difficulty * 100)}%`;
    saveSettings();
  });

  const settingsBox = h('div', { class: 'settings' },
    numberField('Rider weight', 'kg', 'riderMass', 30, 200),
    numberField('Bike weight', 'kg', 'bikeMass', 4, 30),
    numberField('FTP', 'W', 'ftp', 50, 600),
    h('label', { class: 'field' }, h('span', null, 'Gear feel'), gearSelect),
    h('label', { class: 'field' }, h('span', null, 'Hill difficulty'), diffInput, diffValue),
  );

  const pacer = pacerEditor();

  const editor = riderEditor();

  // --- recovery --------------------------------------------------------------
  const recovery = h('div', { class: 'recovery', hidden: true });
  void recoverRide().then((ride) => {
    if (disposed || !ride) return;
    const s = summarize(ride);
    const circuit = circuits.find((c) => c.id === ride.meta.circuitId);
    resumeBtn.addEventListener('click', () => circuit && opts.onResume(circuit, ride));
    const save = h('button', { class: 'btn' }, 'Save FIT file');
    const discard = h('button', { class: 'btn' }, 'Discard');
    const msg = h('p', null,
      `An unfinished ride on ${ride.meta.circuitName} was found: ${fmtClock(s.durationS)}, ${fmtKm(s.distanceM)} km. ${circuit ? 'You can pick it up where it stopped, or save what was recorded.' : 'You can save what was recorded.'} Starting a new ride replaces it.`,
    );
    save.addEventListener('click', async () => {
      try {
        downloadFit(await encodeFit(ride, settings.ftp), fitFilename(ride.meta));
      } catch (e) {
        msg.textContent = `Could not build the file: ${e instanceof Error ? e.message : String(e)}`;
      }
    });
    discard.addEventListener('click', async () => {
      await discardSavedRide();
      recovery.hidden = true;
    });
    recovery.replaceChildren(msg, h('div', { class: 'row' }, circuit ? resumeBtn : null, save, discard));
    recovery.hidden = false;
  }).catch(() => {});

  startBtn.addEventListener('click', () => opts.onStart(selected));

  const footer = h('footer', { class: 'footer' },
    'bikeboi is free software under the AGPL-3.0, built on code from ',
    h('a', { href: 'https://github.com/dvmarinoff/Auuki', target: '_blank', rel: 'noopener' }, 'Auuki'),
    '.',
    SOURCE_URL ? ' ' : null,
    SOURCE_URL ? h('a', { href: SOURCE_URL, target: '_blank', rel: 'noopener' }, 'Source code') : null,
    ' \u00B7 ',
    h('a', { href: '#about' }, 'About'),
    ' \u00B7 ',
    h('a', { href: 'https://www.hlekkir.is', target: '_blank', rel: 'noopener' }, 'hlekkir.is'),
  );

  root.replaceChildren(
    h('main', { class: 'screen home' },
      h('header', { class: 'home-head' },
        h('h1', null, 'bikeboi'),
        h('a', { class: 'btn', href: '#about' }, 'About'),
      ),
      recovery,
      h('section', null, h('h2', null, 'Devices'), noBluetooth, deviceList),
      h('section', null, h('h2', null, 'Circuit'), circuitList),
      h('section', null, h('h2', null, 'Scene'), sceneRow),
      h('section', null,
        h('h2', null, 'Pacemaker'),
        pacer.el,
      ),
      h('section', null, h('h2', null, 'Your rider'), editor.el),
      h('section', null, h('h2', null, 'Setup'), settingsBox),
      h('p', { class: 'note' }, 'Shift with the Click, the on-screen buttons or the up / down arrow keys.'),
      startBtn,
      footer,
    ),
  );

  const welcome = welcomeCard();
  if (welcome) {
    root.firstElementChild?.append(welcome);
    welcome.showModal();
  }

  return () => {
    disposed = true;
    offDevices();
    editor.dispose();
  };
}
