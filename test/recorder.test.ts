import { describe, expect, test } from 'bun:test';
import { Recorder, encodeFit, fitFilename, recoverRide, repairEvents, summarize } from '../src/ride/recorder.ts';
import { createMemoryRideStore } from '../src/ride/ride-store.ts';
import type { SavedRide } from '../src/ride/ride-store.ts';
import type { RideMeta, RideSample } from '../src/types.ts';
// @ts-ignore vendored JS without types
import { FITjs } from '../src/vendor/auuki/fit/fitjs.js';

const T0 = Date.UTC(2026, 9, 6, 18, 30, 0);
const meta: RideMeta = { circuitId: 'rollers', circuitName: 'Rollers', startedAt: T0 };

function sample(i: number, over: Partial<RideSample> = {}): RideSample {
  return {
    timestamp: T0 + (i + 1) * 1000,
    power: 200,
    cadence: 90,
    speed: 8,
    heartRate: 140,
    distance: (i + 1) * 8,
    altitude: 100 + i * 0.5,
    grade: 1.5,
    ...over,
  };
}

function samples(n: number, over: (i: number) => Partial<RideSample> = () => ({})): RideSample[] {
  return Array.from({ length: n }, (_, i) => sample(i, over(i)));
}

// FIT CRC-16, written independently of the vendored encoder
function fitCrc(bytes: Uint8Array, end: number): number {
  const table = [
    0x0000, 0xcc01, 0xd801, 0x1400, 0xf001, 0x3c00, 0x2800, 0xe401, 0xa001, 0x6c00, 0x7800, 0xb401, 0x5000, 0x9c01,
    0x8801, 0x4400,
  ];
  let crc = 0;
  for (let i = 0; i < end; i += 1) {
    const byte = bytes[i];
    let tmp = table[crc & 0xf];
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ table[byte & 0xf];
    tmp = table[crc & 0xf];
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ table[(byte >> 4) & 0xf];
  }
  return crc;
}

function expectValidFit(fit: Uint8Array): void {
  const view = new DataView(fit.buffer, fit.byteOffset, fit.byteLength);
  const headerSize = fit[0];
  expect([12, 14]).toContain(headerSize);
  expect(String.fromCharCode(...fit.slice(8, 12))).toBe('.FIT');
  expect(view.getUint32(4, true)).toBe(fit.byteLength - headerSize - 2);
  expect(view.getUint16(fit.byteLength - 2, true)).toBe(fitCrc(fit, fit.byteLength - 2));
}

function decode(fit: Uint8Array): { name: string; fields: Record<string, number> }[] {
  const log = console.log;
  console.log = () => {};
  try {
    const view = new DataView(fit.buffer, fit.byteOffset, fit.byteLength);
    return (FITjs.decode(view) as any[]).filter((r) => r.type === 'data');
  } finally {
    console.log = log;
  }
}

describe('summarize', () => {
  test('totals and averages', () => {
    const ride: SavedRide = {
      meta,
      samples: [
        sample(0, { power: 100, cadence: 0, heartRate: 0, altitude: 10 }),
        sample(1, { power: 200, cadence: 80, heartRate: 120, altitude: 12 }),
        sample(2, { power: 300, cadence: 100, heartRate: 160, altitude: 11 }),
        sample(3, { power: 0, cadence: 90, heartRate: 140, altitude: 14, distance: 40 }),
      ],
      laps: [{ startTime: T0, endTime: T0 + 2000 }],
      events: [
        { timestamp: T0, type: 'start' },
        { timestamp: T0 + 4000, type: 'stop' },
      ],
    };
    const s = summarize(ride);
    expect(s.durationS).toBe(4);
    expect(s.distanceM).toBe(40);
    expect(s.avgPower).toBe(150);
    expect(s.maxPower).toBe(300);
    expect(s.avgHeartRate).toBe(140);
    expect(s.avgCadence).toBe(90);
    expect(s.avgSpeed).toBe(10);
    expect(s.ascentM).toBe(5);
    expect(s.laps).toBe(1);
  });

  test('pauses are excluded from the duration', () => {
    const ride: SavedRide = {
      meta,
      samples: samples(4),
      laps: [],
      events: [
        { timestamp: T0, type: 'start' },
        { timestamp: T0 + 2000, type: 'stop' },
        { timestamp: T0 + 60_000, type: 'start' },
        { timestamp: T0 + 62_000, type: 'stop' },
      ],
    };
    expect(summarize(ride).durationS).toBe(4);
  });

  test('empty ride', () => {
    const s = summarize({ meta, samples: [], laps: [], events: [] });
    expect(s).toEqual({
      durationS: 0,
      distanceM: 0,
      avgPower: 0,
      maxPower: 0,
      avgHeartRate: 0,
      avgCadence: 0,
      avgSpeed: 0,
      ascentM: 0,
      calories: 0,
      laps: 0,
    });
  });
});

describe('repairEvents', () => {
  test('closes an open ride at the last sample', () => {
    const events = repairEvents({ meta, samples: samples(5), laps: [], events: [{ timestamp: T0, type: 'start' }] });
    expect(events).toEqual([
      { timestamp: T0, type: 'start' },
      { timestamp: T0 + 5000, type: 'stop' },
    ]);
  });

  test('drops duplicates and adds a missing leading start', () => {
    const events = repairEvents({
      meta,
      samples: samples(5),
      laps: [],
      events: [
        { timestamp: T0 + 2000, type: 'stop' },
        { timestamp: T0 + 2500, type: 'stop' },
        { timestamp: T0 + 3000, type: 'start' },
        { timestamp: T0 + 3500, type: 'start' },
      ],
    });
    expect(events.map((e) => e.type)).toEqual(['start', 'stop', 'start', 'stop']);
    expect(events[0].timestamp).toBe(T0 + 1000);
    expect(events[3].timestamp).toBe(T0 + 5000);
  });

  test('no events at all', () => {
    const events = repairEvents({ meta, samples: samples(3), laps: [], events: [] });
    expect(events).toEqual([
      { timestamp: T0, type: 'start' },
      { timestamp: T0 + 3000, type: 'stop' },
    ]);
  });
});

describe('Recorder', () => {
  test('ignores samples while paused and keeps events balanced', async () => {
    const store = createMemoryRideStore();
    const rec = new Recorder(store);
    expect(rec.active).toBe(false);
    rec.addSample(sample(0)); // not active: ignored
    rec.begin(meta);
    expect(rec.active).toBe(true);
    rec.addSample(sample(0));
    rec.addSample(sample(1));
    rec.pause(T0 + 2500);
    rec.pause(T0 + 2600); // idempotent
    rec.addSample(sample(2)); // paused: ignored
    rec.resume(T0 + 10_000);
    rec.resume(T0 + 10_100); // idempotent
    rec.addSample(sample(10));
    const done = await rec.finish(T0 + 12_000);

    expect(rec.active).toBe(false);
    expect(done.ride.samples.map((s) => s.timestamp)).toEqual([T0 + 1000, T0 + 2000, T0 + 11_000]);
    expect(done.ride.events).toEqual([
      { timestamp: T0, type: 'start' },
      { timestamp: T0 + 2500, type: 'stop' },
      { timestamp: T0 + 10_000, type: 'start' },
      { timestamp: T0 + 12_000, type: 'stop' },
    ]);
    expect(done.summary.durationS).toBe(4.5);
    expect(await store.load()).toBeNull(); // cleared after finish
  });

  test('finish while paused does not add a second stop', async () => {
    const rec = new Recorder(createMemoryRideStore());
    rec.begin(meta);
    rec.addSample(sample(0));
    rec.addSample(sample(1));
    rec.pause(T0 + 2000);
    const done = await rec.finish(T0 + 600_000);
    expect(done.ride.events).toEqual([
      { timestamp: T0, type: 'start' },
      { timestamp: T0 + 2000, type: 'stop' },
    ]);
  });

  test('finish produces a valid FIT that round-trips', async () => {
    const rec = new Recorder(createMemoryRideStore());
    rec.begin(meta);
    for (const s of samples(120)) rec.addSample(s);
    rec.addLap({ startTime: T0, endTime: T0 + 50_000 });
    rec.addLap({ startTime: T0 + 50_000, endTime: T0 + 100_000 });
    const done = await rec.finish(T0 + 120_000, 250);

    expect(done.filename).toBe(fitFilename(meta));
    expect(done.summary.laps).toBe(2);
    expectValidFit(done.fit);

    const msgs = decode(done.fit);
    const records = msgs.filter((m) => m.name === 'record');
    expect(records).toHaveLength(120);
    expect(records[0].fields.timestamp).toBe(T0 + 1000);
    expect(records[0].fields.power).toBe(200);
    expect(records[0].fields.cadence).toBe(90);
    expect(records[0].fields.heart_rate).toBe(140);
    expect(records[0].fields.speed).toBeCloseTo(8, 2);
    expect(records[119].fields.distance).toBeCloseTo(960, 1);
    expect(records[10].fields.altitude).toBeCloseTo(105, 1);
    expect(records[10].fields.grade).toBeCloseTo(1.5, 2);

    // two completed laps plus the unfinished third
    const laps = msgs.filter((m) => m.name === 'lap');
    expect(laps).toHaveLength(3);
    expect(laps[0].fields.total_timer_time).toBeCloseTo(50, 1);
    expect(laps[2].fields.start_time).toBe(T0 + 100_000);
    expect(laps[2].fields.timestamp).toBe(T0 + 120_000);
    expect(laps[2].fields.total_elapsed_time).toBeCloseTo(20, 1);

    const events = msgs.filter((m) => m.name === 'event');
    expect(events).toHaveLength(2);

    const sessions = msgs.filter((m) => m.name === 'session');
    expect(sessions).toHaveLength(1);
    const session = sessions[0].fields;
    expect(session.start_time).toBe(T0);
    expect(session.timestamp).toBe(T0 + 120_000);
    expect(session.total_timer_time).toBeCloseTo(120, 1);
    expect(session.total_elapsed_time).toBeCloseTo(120, 1);
    expect(session.total_distance).toBeCloseTo(960, 1);
    expect(session.avg_power).toBe(200);
    expect(session.max_power).toBe(200);
    expect(session.avg_heart_rate).toBe(140);
    expect(session.max_heart_rate).toBe(140);
    expect(session.avg_cadence).toBe(90);
    expect(session.avg_speed).toBeCloseTo(8, 2);
    expect(session.total_calories).toBe(24);
    expect(session.num_laps).toBe(3);
    expect(session.threshold_power).toBe(250);

    expect(msgs.filter((m) => m.name === 'activity')).toHaveLength(1);
  });

  test('a ride without laps gets one spanning the whole ride', async () => {
    const rec = new Recorder(createMemoryRideStore());
    rec.begin(meta);
    for (const s of samples(30)) rec.addSample(s);
    const done = await rec.finish(T0 + 30_000);
    expect(done.summary.laps).toBe(0);
    expectValidFit(done.fit);
    const laps = decode(done.fit).filter((m) => m.name === 'lap');
    expect(laps).toHaveLength(1);
    expect(laps[0].fields.start_time).toBe(T0);
    expect(laps[0].fields.timestamp).toBe(T0 + 30_000);
    expect(laps[0].fields.total_timer_time).toBeCloseTo(30, 1);
  });

  test('missing heart rate is written as invalid, not 0 bpm', async () => {
    const rec = new Recorder(createMemoryRideStore());
    rec.begin(meta);
    for (const s of samples(20, () => ({ heartRate: 0 }))) rec.addSample(s);
    const done = await rec.finish(T0 + 20_000);
    expectValidFit(done.fit);
    const msgs = decode(done.fit);
    expect(msgs.find((m) => m.name === 'record')!.fields.heart_rate).toBe(255);
    const session = msgs.find((m) => m.name === 'session')!.fields;
    expect(session.avg_heart_rate).toBe(255);
    expect(session.max_heart_rate).toBe(255);
    expect(done.summary.avgHeartRate).toBe(0);
  });

  test('pauses shorten timer time but not elapsed time', async () => {
    const rec = new Recorder(createMemoryRideStore());
    rec.begin(meta);
    for (let i = 0; i < 10; i += 1) rec.addSample(sample(i));
    rec.pause(T0 + 10_000);
    rec.resume(T0 + 70_000);
    for (let i = 70; i < 80; i += 1) rec.addSample(sample(i, { distance: (i - 59) * 8 }));
    const done = await rec.finish(T0 + 80_000);
    const session = decode(done.fit).find((m) => m.name === 'session')!.fields;
    expect(session.total_timer_time).toBeCloseTo(20, 1);
    expect(session.total_elapsed_time).toBeCloseTo(80, 1);
    const lap = decode(done.fit).find((m) => m.name === 'lap')!.fields;
    expect(lap.total_timer_time).toBeCloseTo(20, 1);
  });

  test('samples that land in the same second are written once', async () => {
    const ride: SavedRide = {
      meta,
      samples: [sample(0), sample(1, { timestamp: T0 + 1300 }), sample(2), sample(3)],
      laps: [],
      events: [{ timestamp: T0, type: 'start' }],
    };
    const fit = await encodeFit(ride);
    expectValidFit(fit);
    expect(decode(fit).filter((m) => m.name === 'record')).toHaveLength(3);
  });

  test('finish with zero samples throws and keeps the ride active', async () => {
    const rec = new Recorder(createMemoryRideStore());
    await expect(rec.finish(T0)).rejects.toThrow('No ride in progress');
    rec.begin(meta);
    await expect(rec.finish(T0 + 1000)).rejects.toThrow('Nothing has been recorded');
    expect(rec.active).toBe(true);
    await rec.discard();
    expect(rec.active).toBe(false);
  });

  test('a failing store never throws into the ride loop', async () => {
    const failing = createMemoryRideStore();
    failing.appendSample = async () => {
      throw new Error('quota exceeded');
    };
    const warn = console.warn;
    console.warn = () => {};
    try {
      const rec = new Recorder(failing);
      rec.begin(meta);
      for (const s of samples(5)) rec.addSample(s);
      const done = await rec.finish(T0 + 5000);
      expect(done.ride.samples).toHaveLength(5);
      expectValidFit(done.fit);
    } finally {
      console.warn = warn;
    }
  });
});

describe('recovery', () => {
  test('recoverRide returns the stored ride and closes its events', async () => {
    const store = createMemoryRideStore();
    const rec = new Recorder(store);
    rec.begin(meta);
    for (const s of samples(40)) rec.addSample(s);
    rec.addLap({ startTime: T0, endTime: T0 + 25_000 });
    await rec.flush();
    // the tab dies here: no finish()

    const ride = await recoverRide(store);
    expect(ride).not.toBeNull();
    expect(ride!.meta).toEqual(meta);
    expect(ride!.samples).toHaveLength(40);
    expect(ride!.laps).toHaveLength(1);
    expect(ride!.events).toEqual([
      { timestamp: T0, type: 'start' },
      { timestamp: T0 + 40_000, type: 'stop' },
    ]);

    const fit = await encodeFit(ride!);
    expectValidFit(fit);
    const msgs = decode(fit);
    expect(msgs.filter((m) => m.name === 'record')).toHaveLength(40);
    expect(msgs.filter((m) => m.name === 'lap')).toHaveLength(2);
    expect(msgs.find((m) => m.name === 'session')!.fields.total_timer_time).toBeCloseTo(40, 1);
  });

  test('nothing stored, or nothing with samples, recovers as null', async () => {
    const store = createMemoryRideStore();
    expect(await recoverRide(store)).toBeNull();
    const rec = new Recorder(store);
    rec.begin(meta);
    await rec.flush();
    expect(await recoverRide(store)).toBeNull();
  });

  test('begin clears a previous unfinished ride', async () => {
    const store = createMemoryRideStore();
    const rec = new Recorder(store);
    rec.begin(meta);
    for (const s of samples(10)) rec.addSample(s);
    rec.begin({ ...meta, startedAt: T0 + 100_000 });
    rec.addSample(sample(100));
    await rec.flush();
    const ride = await store.load();
    expect(ride!.samples).toHaveLength(1);
    expect(ride!.meta.startedAt).toBe(T0 + 100_000);
  });
});

test('fitFilename', () => {
  const d = new Date(2026, 9, 6, 18, 30);
  expect(fitFilename({ circuitId: 'Big Climb!', circuitName: 'Big Climb', startedAt: d.getTime() })).toBe(
    'bikeboi-big-climb-2026-10-06-1830.fit',
  );
});
