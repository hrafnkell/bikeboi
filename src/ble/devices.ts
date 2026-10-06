// Device layer: trainer, heart-rate strap and Zwift Click.
//
// Trainer and strap go through Auuki's Connectable, which picks FTMS, FE-C over BLE or
// Wahoo's protocol per trainer. This file replaces Auuki's reactive-connectable.js glue:
// it feeds `live`, reports device state, keeps retrying after dropouts and pushes
// simulation parameters to the trainer through the coalescing sender.

import Connectable from '../vendor/auuki/ble/connectable.js';
import { webBle } from '../vendor/auuki/ble/web-ble.js';
import { userData } from '../vendor/auuki/ble/userData.js';
import { bus, live } from '../state.ts';
import type { Unsubscribe } from '../state.ts';
import { CW } from '../types.ts';
import type { DeviceInfo, DeviceKind, SimParams } from '../types.ts';
import { ClickDevice } from './click.ts';
import { createSimSender } from './sim-sender.ts';

// Minimal shapes of the borrowed JS this file relies on.
interface VendorControlPoint {
  isReady(): boolean;
}

interface VendorTrainerService {
  isStarted(): boolean;
  characteristics?: { control?: VendorControlPoint };
  /** grade in percent, windSpeed in m/s, windResistance in kg/m */
  setSimulation(args: { grade: number; windSpeed: number; crr: number; windResistance: number }): unknown;
  /** FE-C only */
  setUserData?: unknown;
  setWindResistance?(args?: { windResistance?: number }): unknown;
}

interface VendorConnectable {
  connect(args?: { requesting?: boolean; watching?: boolean }): Promise<void>;
  disconnect(): Promise<void>;
  getStatus(): 'disconnected' | 'connected' | 'connecting' | 'disconnecting';
  isConnected(): boolean;
  getName(): string;
  services: { trainer?: VendorTrainerService };
}

type VendorKind = 'trainer' | 'hrm';

interface Slot {
  kind: VendorKind;
  c: VendorConnectable | null;
  device: BluetoothDevice | null;
  /** Bumped on every user connect / disconnect; callbacks from older attempts are ignored. */
  gen: number;
  /** The user wants this device connected, so dropouts are retried. */
  wanted: boolean;
  requesting: boolean;
  retryTimer: ReturnType<typeof setTimeout> | null;
  retryDelay: number;
}

const RETRY_START_MS = 2000;
const RETRY_MAX_MS = 15000;
const POWER_TIMEOUT_MS = 3000;

function emptyInfo(kind: DeviceKind): DeviceInfo {
  return { kind, status: 'disconnected', name: '', battery: null, controllable: false };
}

function emptySlot(kind: VendorKind): Slot {
  return {
    kind,
    c: null,
    device: null,
    gen: 0,
    wanted: false,
    requesting: false,
    retryTimer: null,
    retryDelay: RETRY_START_MS,
  };
}

const infos: Record<DeviceKind, DeviceInfo> = {
  trainer: emptyInfo('trainer'),
  hrm: emptyInfo('hrm'),
  click: emptyInfo('click'),
};

const slots: Record<VendorKind, Slot> = {
  trainer: emptySlot('trainer'),
  hrm: emptySlot('hrm'),
};

const listeners = new Set<(info: DeviceInfo) => void>();

function update(kind: DeviceKind, patch: Partial<DeviceInfo>): void {
  const info = infos[kind];
  let changed = false;
  for (const key of Object.keys(patch) as (keyof DeviceInfo)[]) {
    if (info[key] !== patch[key]) {
      (info as unknown as Record<string, unknown>)[key] = patch[key];
      changed = true;
    }
  }
  if (!changed) return;
  const snapshot = { ...info };
  listeners.forEach((fn) => fn(snapshot));
}

function supported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.bluetooth;
}

function isNumber(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

//
// Trainer control
//

/** The trainer's control service, or null unless it is connected and set up. Never cached: it is recreated on reconnect. */
function trainerService(): VendorTrainerService | null {
  const c = slots.trainer.c;
  if (!c || c.getStatus() !== 'connected') return null;
  const trainer = c.services.trainer;
  return trainer && trainer.isStarted() ? trainer : null;
}

let lastSim: SimParams | null = null;

const simSender = createSimSender({
  isReady() {
    const trainer = trainerService();
    if (!trainer) return false;
    return trainer.characteristics?.control?.isReady() ?? true;
  },
  write(p) {
    const trainer = trainerService();
    if (!trainer) return false;
    return trainer.setSimulation({
      grade: p.grade * 100,
      windSpeed: 0,
      crr: p.crr,
      windResistance: p.cw,
    });
  },
});

//
// Live metrics
//

let lastPowerAt = 0;
let watchdog: ReturnType<typeof setInterval> | null = null;

function startWatchdog(): void {
  stopWatchdog();
  lastPowerAt = Date.now();
  watchdog = setInterval(() => {
    if (Date.now() - lastPowerAt > POWER_TIMEOUT_MS) {
      live.power = 0;
      live.cadence = 0;
    }
  }, 1000);
}

function stopWatchdog(): void {
  if (watchdog !== null) {
    clearInterval(watchdog);
    watchdog = null;
  }
}

function zeroMetrics(kind: VendorKind): void {
  if (kind === 'trainer') {
    live.power = 0;
    live.cadence = 0;
    if (infos.hrm.status !== 'connected') live.heartRate = 0;
  } else {
    live.heartRate = 0;
  }
}

/** Services hand over partial objects: only the keys present in a message are applied. */
function onData(kind: VendorKind, data: unknown): void {
  if (typeof data !== 'object' || data === null) return;
  const d = data as Record<string, unknown>;

  if (isNumber(d.batteryLevel)) update(kind, { battery: d.batteryLevel });

  if (kind === 'hrm') {
    if (isNumber(d.heartRate)) live.heartRate = d.heartRate;
    return;
  }

  if (isNumber(d.power)) {
    live.power = Math.max(0, d.power);
    lastPowerAt = Date.now();
  }
  if (isNumber(d.cadence)) live.cadence = Math.max(0, d.cadence);

  // FE-C pages carry placeholder zeros for heart rate
  const fromFec = 'dataPage' in d;
  if (!fromFec && isNumber(d.heartRate) && d.heartRate > 0 && infos.hrm.status !== 'connected') {
    live.heartRate = d.heartRate;
  }
}

//
// Connection lifecycle
//

function cancelRetry(slot: Slot): void {
  if (slot.retryTimer !== null) {
    clearTimeout(slot.retryTimer);
    slot.retryTimer = null;
  }
}

function scheduleRetry(slot: Slot, gen: number): void {
  if (slot.retryTimer !== null || gen !== slot.gen || !slot.wanted) return;
  const delay = slot.retryDelay;

  slot.retryTimer = setTimeout(async () => {
    slot.retryTimer = null;
    const c = slot.c;
    if (gen !== slot.gen || !slot.wanted || !c) return;

    const status = c.getStatus();
    if (status === 'connected') return;
    if (status !== 'disconnected') {
      // the Connectable's own reconnect attempt is still running
      scheduleRetry(slot, gen);
      return;
    }

    slot.retryDelay = Math.min(slot.retryDelay * 2, RETRY_MAX_MS);
    // reconnects to the device it already holds; reports through the callbacks and never rejects
    await c.connect();
    if (gen === slot.gen && slot.wanted && c.getStatus() !== 'connected') scheduleRetry(slot, gen);
  }, delay);
}

function onConnected(slot: Slot, gen: number, c: VendorConnectable): void {
  if (gen !== slot.gen) {
    // a superseded attempt finished late
    void c.disconnect();
    return;
  }

  cancelRetry(slot);
  slot.retryDelay = RETRY_START_MS;

  if (slot.kind === 'hrm') {
    update('hrm', { status: 'connected', name: c.getName() ?? '' });
    return;
  }

  // the connected callback also fires when service setup failed
  const trainer = trainerService();
  update('trainer', { status: 'connected', name: c.getName() ?? '', controllable: trainer !== null });
  startWatchdog();

  if (trainer) {
    const isFec = trainer.setUserData !== undefined;
    if (isFec) void trainer.setWindResistance?.({ windResistance: Math.min(lastSim?.cw ?? CW, 1.86) });
    simSender.reset();
    if (lastSim) simSender.set(lastSim);
  }
}

/** A drop the user did not ask for. */
function onDropped(slot: Slot, gen: number): void {
  if (gen !== slot.gen) return;

  zeroMetrics(slot.kind);
  if (slot.kind === 'trainer') {
    stopWatchdog();
    simSender.stop();
  }
  update(slot.kind, { status: slot.wanted ? 'connecting' : 'disconnected', controllable: false });
  scheduleRetry(slot, gen);
}

function filterFor(kind: VendorKind): RequestDeviceOptions {
  const filter = kind === 'trainer' ? webBle.filters.controllable() : webBle.filters.heartRateMonitor();
  return filter as RequestDeviceOptions;
}

async function connectVendor(kind: VendorKind): Promise<void> {
  const slot = slots[kind];
  if (!supported() || slot.requesting || infos[kind].status === 'connected') return;

  // abandon any reconnect still in progress for a previously chosen device
  cancelRetry(slot);
  slot.wanted = false;
  try {
    slot.device?.gatt?.disconnect();
  } catch {
    // already gone
  }
  const gen = ++slot.gen;
  update(kind, { status: 'connecting' });

  let device: BluetoothDevice;
  slot.requesting = true;
  try {
    device = await navigator.bluetooth.requestDevice(filterFor(kind));
  } catch {
    // chooser dismissed
    if (gen === slot.gen) update(kind, { status: 'disconnected', controllable: false });
    return;
  } finally {
    slot.requesting = false;
  }
  if (gen !== slot.gen) return;

  const c = Connectable({
    device,
    onData: (data: unknown) => {
      if (gen === slot.gen) onData(kind, data);
    },
    onConnected: () => onConnected(slot, gen, c),
    onDisconnect: () => onDropped(slot, gen),
    onConnectFail: () => onDropped(slot, gen),
  }) as unknown as VendorConnectable;

  slot.c = c;
  slot.device = device;
  slot.wanted = true;
  slot.retryDelay = RETRY_START_MS;
  update(kind, { name: device.name ?? '', battery: null });

  await c.connect();
}

async function disconnectVendor(kind: VendorKind): Promise<void> {
  const slot = slots[kind];
  const { c, device } = slot;

  slot.wanted = false;
  slot.gen += 1;
  cancelRetry(slot);
  zeroMetrics(kind);
  if (kind === 'trainer') {
    stopWatchdog();
    simSender.stop();
  }
  update(kind, { status: 'disconnected', controllable: false, battery: null });

  try {
    if (c?.isConnected()) {
      // resets the trainer and stops notifications before closing the link
      await c.disconnect();
    } else {
      device?.gatt?.disconnect();
    }
  } catch (e) {
    console.warn(`ble: ${kind}: disconnect failed`, e);
  }
  if (slot.c === c) slot.c = null;
}

//
// Zwift Click
//

const click = new ClickDevice({
  onStatus: (status) => update('click', status === 'disconnected' ? { status, battery: null } : { status }),
  onName: (name) => update('click', { name }),
  onBattery: (level) => update('click', { battery: level }),
  onPress: (press) => bus.emit('shift', press === 'plus' ? 1 : -1),
});

//
// Public API
//

export const devices = {
  /** Web Bluetooth is available in this browser. */
  supported,

  /** Opens the browser's device chooser, so it must be called from a user gesture. Never throws. */
  async connect(kind: DeviceKind): Promise<void> {
    try {
      if (kind === 'click') await click.connect();
      else await connectVendor(kind);
    } catch (e) {
      console.warn(`ble: ${kind}: connect failed`, e);
      update(kind, { status: 'disconnected', controllable: false });
    }
  },

  async disconnect(kind: DeviceKind): Promise<void> {
    if (kind === 'click') click.disconnect();
    else await disconnectVendor(kind);
  },

  info(kind: DeviceKind): DeviceInfo {
    return { ...infos[kind] };
  },

  /** Fires on any status, name, battery or controllable change. */
  onChange(fn: (info: DeviceInfo) => void): Unsubscribe {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  /** Latest value wins. Remembered and re-sent after a (re)connect; does nothing without a controllable trainer. */
  setSim(params: SimParams): void {
    lastSim = { ...params };
    if (trainerService()) simSender.set(params);
  },

  /**
   * FE-C and Wahoo trainers are told the system mass during setup, so call this before
   * connecting. FTMS simulation has no mass field.
   */
  setRiderMass(riderKg: number, bikeKg: number): void {
    if (!isNumber(riderKg) || !isNumber(bikeKg)) return;
    // only the rider weight is settable in the borrowed module; fold the bike difference into it
    const riderForTotal = riderKg + bikeKg - userData.bikeWeight();
    userData.setUserWeight(Math.max(0, riderForTotal) * 1000);
  },
};
