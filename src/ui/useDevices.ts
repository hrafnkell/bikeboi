// Reactive view of the Bluetooth devices for templates, unsubscribed with the component.

import { onUnmounted, reactive } from 'vue';
import { devices } from '../ble/devices.ts';
import type { DeviceInfo, DeviceKind } from '../types.ts';

export function useDevices(): Record<DeviceKind, DeviceInfo> {
  const infos = reactive<Record<DeviceKind, DeviceInfo>>({
    trainer: devices.info('trainer'),
    hrm: devices.info('hrm'),
    click: devices.info('click'),
  });
  const off = devices.onChange((info) => {
    infos[info.kind] = info;
  });
  onUnmounted(off);
  return infos;
}
