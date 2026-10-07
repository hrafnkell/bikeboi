<script setup lang="ts">
// The three device rows: trainer, heart-rate strap, Zwift Click.
import { devices } from '../ble/devices.ts';
import type { DeviceInfo, DeviceKind } from '../types.ts';
import { useDevices } from './useDevices.ts';

const labels: Record<DeviceKind, string> = { trainer: 'Trainer', hrm: 'Heart rate', click: 'Zwift Click' };
const kinds: DeviceKind[] = ['trainer', 'hrm', 'click'];
const infos = useDevices();
const supported = devices.supported();

function describe(info: DeviceInfo): string {
  if (info.status === 'connecting') return info.name ? `Connecting to ${info.name}…` : 'Connecting…';
  if (info.status === 'disconnected') return 'Not connected';
  const battery = info.battery !== null ? ` · ${info.battery}%` : '';
  if (info.kind === 'trainer' && !info.controllable) {
    return `${info.name || 'Connected'} · power only, no resistance control${battery}`;
  }
  return `${info.name || 'Connected'}${battery}`;
}

function buttonText(info: DeviceInfo): string {
  return info.status === 'connected' ? 'Disconnect' : info.status === 'connecting' ? 'Cancel' : 'Connect';
}

function toggle(kind: DeviceKind) {
  if (devices.info(kind).status === 'disconnected') void devices.connect(kind);
  else void devices.disconnect(kind);
}
</script>

<template>
  <p v-if="!supported" class="note">
    This browser has no Web Bluetooth, so devices cannot connect. Use Chrome or Edge on Android or desktop. You can still ride with simulated power.
  </p>
  <div class="device-list">
    <div v-for="kind in kinds" :key="kind" class="device">
      <div class="device-text">
        <strong>{{ labels[kind] }}</strong>
        <span class="device-status" :class="{ ok: infos[kind].status === 'connected' }">{{ describe(infos[kind]) }}</span>
      </div>
      <button class="btn" :disabled="!supported" @click="toggle(kind)">{{ buttonText(infos[kind]) }}</button>
    </div>
  </div>
</template>
