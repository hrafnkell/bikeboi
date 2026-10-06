import { describe, expect, test } from 'bun:test';
import { clampSim, createSimSender } from '../src/ble/sim-sender.ts';
import { CRR, CW } from '../src/types.ts';
import type { SimParams } from '../src/types.ts';

function fakeClock() {
  let t = 0;
  let nextId = 1;
  let timers: { id: number; at: number; fn: () => void }[] = [];
  return {
    now: () => t,
    setTimer(fn: () => void, ms: number) {
      const id = nextId++;
      timers.push({ id, at: t + ms, fn });
      return id;
    },
    clearTimer(handle: unknown) {
      timers = timers.filter((timer) => timer.id !== handle);
    },
    advance(ms: number) {
      const end = t + ms;
      for (;;) {
        const due = timers.filter((timer) => timer.at <= end).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        timers = timers.filter((timer) => timer !== due);
        t = due.at;
        due.fn();
      }
      t = end;
    },
    pending: () => timers.length,
  };
}

function setup(over: { ready?: boolean; minIntervalMs?: number } = {}) {
  const clock = fakeClock();
  const state = { ready: over.ready ?? true, result: undefined as unknown };
  const writes: SimParams[] = [];
  const sender = createSimSender({
    isReady: () => state.ready,
    write: (p) => {
      writes.push(p);
      return state.result;
    },
    pollMs: 100,
    minIntervalMs: over.minIntervalMs ?? 0,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });
  return { clock, state, writes, sender };
}

const sim = (grade: number): SimParams => ({ grade, crr: CRR, cw: CW });

describe('clampSim', () => {
  test('passes values inside the limits through', () => {
    expect(clampSim({ grade: 0.05, crr: 0.004, cw: 0.2 })).toEqual({ grade: 0.05, crr: 0.004, cw: 0.2 });
  });

  test('clamps grade, crr and cw', () => {
    expect(clampSim({ grade: 4, crr: 0.03, cw: 5 })).toEqual({ grade: 0.2, crr: 0.0254, cw: 1.86 });
    expect(clampSim({ grade: -1, crr: -1, cw: -1 })).toEqual({ grade: -0.1, crr: 0, cw: 0 });
  });

  test('uses custom grade limits', () => {
    expect(clampSim(sim(0.3), { minGrade: -0.05, maxGrade: 0.12 }).grade).toBe(0.12);
    expect(clampSim(sim(-0.3), { minGrade: -0.05, maxGrade: 0.12 }).grade).toBe(-0.05);
  });

  test('replaces non-finite values with safe defaults', () => {
    expect(clampSim({ grade: NaN, crr: Infinity, cw: NaN })).toEqual({ grade: 0, crr: CRR, cw: CW });
  });
});

describe('createSimSender', () => {
  test('writes immediately when the control point is ready', () => {
    const { sender, writes } = setup();
    sender.set(sim(0.03));
    expect(writes).toEqual([sim(0.03)]);
  });

  test('clamps before writing', () => {
    const { sender, writes } = setup();
    sender.set(sim(4));
    expect(writes[0]!.grade).toBe(0.2);
  });

  test('skips a value identical on the wire to the last delivered one', () => {
    const { sender, writes, clock } = setup();
    sender.set(sim(0.03));
    sender.set(sim(0.03));
    sender.set(sim(0.03004)); // below the 0.01 % wire resolution
    clock.advance(1000);
    expect(writes.length).toBe(1);

    sender.set(sim(0.031));
    expect(writes.length).toBe(2);
  });

  test('while busy keeps only the latest value and delivers it once ready', () => {
    const { sender, writes, state, clock } = setup({ ready: false });
    sender.set(sim(0.01));
    sender.set(sim(0.02));
    sender.set(sim(0.03));
    clock.advance(500);
    expect(writes).toEqual([]);

    state.ready = true;
    clock.advance(100);
    expect(writes).toEqual([sim(0.03)]);

    clock.advance(1000);
    expect(writes.length).toBe(1);
    expect(clock.pending()).toBe(0);
  });

  test('drops the pending value when set back to what the trainer already has', () => {
    const { sender, writes, state, clock } = setup();
    sender.set(sim(0.01));
    state.ready = false;
    sender.set(sim(0.05));
    sender.set(sim(0.01));
    state.ready = true;
    clock.advance(1000);
    expect(writes).toEqual([sim(0.01)]);
  });

  test('spaces writes by the minimum interval, sending the newest value', () => {
    const { sender, writes, clock } = setup({ minIntervalMs: 250 });
    sender.set(sim(0.01));
    sender.set(sim(0.02));
    sender.set(sim(0.03));
    expect(writes).toEqual([sim(0.01)]);

    clock.advance(249);
    expect(writes.length).toBe(1);
    clock.advance(1);
    expect(writes).toEqual([sim(0.01), sim(0.03)]);
  });

  test('flush ignores the minimum interval but not a busy control point', () => {
    const { sender, writes, state } = setup({ minIntervalMs: 250 });
    sender.set(sim(0.01));
    sender.set(sim(0.02));
    state.ready = false;
    sender.flush();
    expect(writes.length).toBe(1);
    state.ready = true;
    sender.flush();
    expect(writes).toEqual([sim(0.01), sim(0.02)]);
  });

  test('retries a write that reports failure', () => {
    const { sender, writes, state, clock } = setup();
    state.result = false;
    sender.set(sim(0.04));
    expect(writes.length).toBe(1);

    state.result = true;
    clock.advance(100);
    expect(writes).toEqual([sim(0.04), sim(0.04)]);
    clock.advance(1000);
    expect(writes.length).toBe(2);
  });

  test('retries a write whose promise resolves to false, unless a newer value arrived', async () => {
    const { sender, writes, state, clock } = setup();
    state.result = Promise.resolve(false);
    sender.set(sim(0.04));
    await Promise.resolve();
    await Promise.resolve();

    state.result = Promise.resolve(true);
    sender.set(sim(0.06));
    clock.advance(1000);
    expect(writes).toEqual([sim(0.04), sim(0.06)]);
  });

  test('a throwing write is retried', () => {
    const clock = fakeClock();
    let calls = 0;
    const sender = createSimSender({
      isReady: () => true,
      write: () => {
        calls += 1;
        if (calls === 1) throw new Error('gatt busy');
      },
      pollMs: 100,
      minIntervalMs: 0,
      now: clock.now,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
    });
    sender.set(sim(0.02));
    clock.advance(100);
    expect(calls).toBe(2);
  });

  test('reset makes the same value write again', () => {
    const { sender, writes } = setup();
    sender.set(sim(0.03));
    sender.reset();
    sender.set(sim(0.03));
    expect(writes.length).toBe(2);
  });

  test('stop drops the pending value and cancels polling', () => {
    const { sender, writes, state, clock } = setup({ ready: false });
    sender.set(sim(0.03));
    sender.stop();
    state.ready = true;
    clock.advance(1000);
    expect(writes).toEqual([]);
    expect(clock.pending()).toBe(0);
  });
});
