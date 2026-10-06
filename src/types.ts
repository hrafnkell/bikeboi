// Contracts shared between the ride loop, the device layer and the recorder.

/** Road model constants shared by the game physics and the trainer. */
export const CRR = 0.004;
export const RHO = 1.275; // kg/m^3
export const CDA = 0.32; // m^2
export const CW = 0.5 * RHO * CDA; // kg/m, aero force = CW * v^2
export const G0 = 9.80665;

/** What the trainer is told in simulation mode. */
export interface SimParams {
  grade: number; // fraction, 0.05 = 5 %
  crr: number;
  cw: number; // kg/m
}

export type DeviceKind = 'trainer' | 'hrm' | 'click';
export type DeviceStatus = 'disconnected' | 'connecting' | 'connected';

export interface DeviceInfo {
  kind: DeviceKind;
  status: DeviceStatus;
  name: string; // '' when unknown
  battery: number | null; // percent
  /** Trainer only: true once a control service (FTMS, FE-C, Wahoo) is set up. */
  controllable: boolean;
}

/** One sample per second while the ride timer runs. */
export interface RideSample {
  timestamp: number; // ms since epoch
  power: number; // W
  cadence: number; // rpm
  speed: number; // m/s
  heartRate: number; // bpm
  distance: number; // m, cumulative
  altitude: number; // m
  grade: number; // percent
}

export interface RideLap {
  startTime: number; // ms since epoch
  endTime: number; // ms since epoch
}

export interface RideMeta {
  circuitId: string;
  circuitName: string;
  startedAt: number; // ms since epoch
}
