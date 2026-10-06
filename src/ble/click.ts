// Zwift Click v1 (the single two-button puck): message decoding and a Web Bluetooth driver.
//
// The Click speaks plaintext once it has been sent the ASCII bytes "RideOn". Button state
// then arrives as notifications: a type byte followed by a small protobuf message.

import type { DeviceStatus } from '../types.ts';

export const CLICK_SERVICE = '00000001-19ca-4651-86e5-fa29dcdd09d1';
export const CLICK_SERVICE_SHORT = 0xfc82; // newer firmware
const CLICK_MEASUREMENT = '00000002-19ca-4651-86e5-fa29dcdd09d1'; // notify
const CLICK_CONTROL = '00000003-19ca-4651-86e5-fa29dcdd09d1'; // write
const CLICK_RESPONSE = '00000004-19ca-4651-86e5-fa29dcdd09d1'; // indicate

const ZWIFT_COMPANY_ID = 0x094a;
const CLICK_V1_DEVICE_TYPE = 0x09;

const TYPE_BUTTONS = 0x37;
const TYPE_IDLE = 0x15;
const TYPE_BATTERY = 0x19;

// button enum on the wire: 0 = pressed, 1 = released
const PRESSED = 0;

export type ClickMessage =
  | { type: 'buttons'; plus: boolean; minus: boolean }
  | { type: 'battery'; level: number }
  | { type: 'idle' }
  | { type: 'unknown' };

export interface ClickButtons {
  plus: boolean;
  minus: boolean;
}

export type ClickPress = 'plus' | 'minus';

const UNKNOWN: ClickMessage = { type: 'unknown' };

/** Reads a protobuf varint at `pos`; returns null when it runs off the end. */
function readVarint(bytes: Uint8Array, pos: number): { value: number; next: number } | null {
  let value = 0;
  let shift = 0;
  while (pos < bytes.length) {
    const byte = bytes[pos++]!;
    // button values and tags fit easily in 32 bits; higher bits are skipped, not decoded
    if (shift < 32) value = (value | ((byte & 0x7f) << shift)) >>> 0;
    if ((byte & 0x80) === 0) return { value, next: pos };
    shift += 7;
    if (shift > 63) return null;
  }
  return null;
}

/** Field 1 = plus, field 2 = minus, both varints where 0 means pressed. A missing field counts as released. */
function decodeButtons(bytes: Uint8Array): ClickMessage {
  let plus = false;
  let minus = false;
  let pos = 1;

  while (pos < bytes.length) {
    const tag = readVarint(bytes, pos);
    if (tag === null) return UNKNOWN;
    pos = tag.next;
    const field = tag.value >>> 3;
    const wireType = tag.value & 0x07;

    if (wireType === 0) {
      const v = readVarint(bytes, pos);
      if (v === null) return UNKNOWN;
      pos = v.next;
      if (field === 1) plus = v.value === PRESSED;
      if (field === 2) minus = v.value === PRESSED;
    } else if (wireType === 2) {
      const len = readVarint(bytes, pos);
      if (len === null || len.next + len.value > bytes.length) return UNKNOWN;
      pos = len.next + len.value;
    } else if (wireType === 5) {
      pos += 4;
      if (pos > bytes.length) return UNKNOWN;
    } else if (wireType === 1) {
      pos += 8;
      if (pos > bytes.length) return UNKNOWN;
    } else {
      return UNKNOWN;
    }
  }

  return { type: 'buttons', plus, minus };
}

export function decodeClickMessage(bytes: Uint8Array): ClickMessage {
  if (bytes.length === 0) return UNKNOWN;

  switch (bytes[0]) {
    case TYPE_BUTTONS:
      return decodeButtons(bytes);
    case TYPE_IDLE:
      return { type: 'idle' };
    case TYPE_BATTERY:
      // type, protobuf tag, level
      if (bytes.length < 3) return UNKNOWN;
      return { type: 'battery', level: bytes[2]! };
    default:
      return UNKNOWN;
  }
}

/**
 * The Click repeats its button state while a button is held. The returned function maps
 * successive states to press events, firing once per press.
 */
export function createEdgeDetector(): (state: ClickButtons) => ClickPress[] {
  let last: ClickButtons = { plus: false, minus: false };
  return (state) => {
    const presses: ClickPress[] = [];
    if (state.plus && !last.plus) presses.push('plus');
    if (state.minus && !last.minus) presses.push('minus');
    last = { plus: state.plus, minus: state.minus };
    return presses;
  };
}

export function clickRequestOptions(): RequestDeviceOptions {
  return {
    filters: [
      { services: [CLICK_SERVICE] },
      { services: [CLICK_SERVICE_SHORT] },
      { namePrefix: 'Zwift Click' },
      {
        manufacturerData: [
          { companyIdentifier: ZWIFT_COMPANY_ID, dataPrefix: new Uint8Array([CLICK_V1_DEVICE_TYPE]) },
        ],
      },
    ],
    optionalServices: [CLICK_SERVICE, CLICK_SERVICE_SHORT, 'battery_service'],
  };
}

export interface ClickHandlers {
  onStatus?(status: DeviceStatus): void;
  onName?(name: string): void;
  onBattery?(level: number): void;
  onPress?(press: ClickPress): void;
}

const RETRY_START_MS = 2000;
const RETRY_MAX_MS = 15000;

function toBytes(view: DataView | undefined): Uint8Array {
  if (!view) return new Uint8Array(0);
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
}

export class ClickDevice {
  private handlers: ClickHandlers;
  private device: BluetoothDevice | null = null;
  private status: DeviceStatus = 'disconnected';
  private requesting = false;
  private wanted = false;
  /** Bumped on every user connect / disconnect so late async work from an older attempt is ignored. */
  private gen = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryDelay = RETRY_START_MS;
  private detect = createEdgeDetector();

  constructor(handlers: ClickHandlers = {}) {
    this.handlers = handlers;
  }

  getStatus(): DeviceStatus {
    return this.status;
  }

  /** Opens the browser's device chooser, so it must be called from a user gesture. Never throws. */
  async connect(): Promise<void> {
    if (this.status === 'connected' || this.requesting) return;
    if (typeof navigator === 'undefined' || !navigator.bluetooth) return;

    this.cancelRetry();
    this.device?.gatt?.disconnect();
    const gen = ++this.gen;
    this.setStatus('connecting');

    let device: BluetoothDevice;
    this.requesting = true;
    try {
      device = await navigator.bluetooth.requestDevice(clickRequestOptions());
    } catch {
      // chooser dismissed
      if (gen === this.gen) {
        this.wanted = false;
        this.setStatus('disconnected');
      }
      return;
    } finally {
      this.requesting = false;
    }
    if (gen !== this.gen) return;

    this.device = device;
    this.wanted = true;
    this.retryDelay = RETRY_START_MS;
    this.handlers.onName?.(device.name ?? '');
    device.addEventListener('gattserverdisconnected', this.onGattDisconnected);

    await this.open(gen);
  }

  disconnect(): void {
    this.wanted = false;
    this.gen += 1;
    this.cancelRetry();
    this.detect = createEdgeDetector();
    this.device?.removeEventListener('gattserverdisconnected', this.onGattDisconnected);
    try {
      this.device?.gatt?.disconnect();
    } catch {
      // already gone
    }
    this.setStatus('disconnected');
  }

  private setStatus(status: DeviceStatus): void {
    if (status === this.status) return;
    this.status = status;
    this.handlers.onStatus?.(status);
  }

  private cancelRetry(): void {
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  private scheduleRetry(gen: number): void {
    if (this.retryTimer !== null || gen !== this.gen || !this.wanted) return;
    const delay = this.retryDelay;
    this.retryDelay = Math.min(this.retryDelay * 2, RETRY_MAX_MS);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (gen !== this.gen || !this.wanted) return;
      void this.open(gen);
    }, delay);
  }

  private onGattDisconnected = (): void => {
    this.detect = createEdgeDetector();
    if (!this.wanted) return;
    this.setStatus('connecting');
    this.scheduleRetry(this.gen);
  };

  private onMeasurement = (e: Event): void => {
    const bytes = toBytes((e.target as BluetoothRemoteGATTCharacteristic).value);
    const msg = decodeClickMessage(bytes);
    if (msg.type === 'buttons') {
      for (const press of this.detect(msg)) this.handlers.onPress?.(press);
    } else if (msg.type === 'battery') {
      this.handlers.onBattery?.(msg.level);
    }
  };

  private onBatteryLevel = (e: Event): void => {
    const value = (e.target as BluetoothRemoteGATTCharacteristic).value;
    if (value && value.byteLength > 0) this.handlers.onBattery?.(value.getUint8(0));
  };

  // the reply to the handshake carries nothing we need
  private onResponse = (): void => {};

  private async open(gen: number): Promise<void> {
    const device = this.device;
    if (!device?.gatt) return;

    try {
      const server = await device.gatt.connect();
      if (gen !== this.gen) return;
      await this.setup(server);
      if (gen !== this.gen) {
        device.gatt.disconnect();
        return;
      }
      this.retryDelay = RETRY_START_MS;
      this.setStatus('connected');
    } catch (e) {
      if (gen !== this.gen) return;
      console.warn('click: connect failed', e);
      this.setStatus('connecting');
      try {
        device.gatt.disconnect();
      } catch {
        // already gone
      }
      this.scheduleRetry(gen);
    }
  }

  private async setup(server: BluetoothRemoteGATTServer): Promise<void> {
    let service: BluetoothRemoteGATTService;
    try {
      service = await server.getPrimaryService(CLICK_SERVICE);
    } catch {
      service = await server.getPrimaryService(CLICK_SERVICE_SHORT);
    }

    const measurement = await service.getCharacteristic(CLICK_MEASUREMENT);
    measurement.addEventListener('characteristicvaluechanged', this.onMeasurement);
    await measurement.startNotifications();

    try {
      const response = await service.getCharacteristic(CLICK_RESPONSE);
      response.addEventListener('characteristicvaluechanged', this.onResponse);
      await response.startNotifications();
    } catch {
      // not present on every firmware; buttons still arrive on the measurement characteristic
    }

    const control = await service.getCharacteristic(CLICK_CONTROL);
    const rideOn = new TextEncoder().encode('RideOn');
    try {
      await control.writeValueWithoutResponse(rideOn);
    } catch {
      await control.writeValueWithResponse(rideOn);
    }

    void this.setupBattery(server);
  }

  /** Standard battery service, when the Click exposes it. The Click also reports battery in-band. */
  private async setupBattery(server: BluetoothRemoteGATTServer): Promise<void> {
    try {
      const service = await server.getPrimaryService('battery_service');
      const level = await service.getCharacteristic('battery_level');
      level.addEventListener('characteristicvaluechanged', this.onBatteryLevel);
      const value = await level.readValue();
      if (value.byteLength > 0) this.handlers.onBattery?.(value.getUint8(0));
      await level.startNotifications();
    } catch {
      // optional
    }
  }
}
