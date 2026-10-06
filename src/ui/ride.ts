// Ride screen: owns the frame loop and ties the sim, trainer, ghost, recorder and HUD together.

import { devices } from '../ble/devices.ts';
import { DEFAULT_SIM_LIMITS } from '../ble/sim-sender.ts';
import { Renderer, gradeColor } from '../game/renderer.ts';
import { bindKeyboard } from '../input.ts';
import type { Circuit } from '../ride/circuit.ts';
import {
  GEAR_COUNT, REFERENCE_GEAR, cadenceFor, clampGear, gearFactor, gearedSimGrade, offsetSimGrade,
} from '../ride/gears.ts';
import { TraceRecorder, gapSeconds, ghostLapDistance, loadGhost, saveGhost } from '../ride/ghost.ts';
import { Recorder } from '../ride/recorder.ts';
import type { FinishedRide } from '../ride/recorder.ts';
import { RideSim } from '../ride/sim.ts';
import type { LapResult } from '../ride/sim.ts';
import { bus, live, settings, totalMass } from '../state.ts';
import { kcalFromJoules } from '../ride/energy.ts';
import { CRR, CW } from '../types.ts';
import { clamp, fmtClock, fmtKm, fmtLap, h, setText } from './dom.ts';

export interface RideOutcome {
  circuit: Circuit;
  laps: LapResult[];
  finished: FinishedRide | null;
  /** Why there is no file, when there is none. */
  error: string | null;
}

const OFFSET_STEP = 0.005; // gradient per gear in the offset rule
const SIM_PUSH_MS = 500;

function metric(label: string, unit: string, cls = '') {
  const value = h('span', { class: 'metric-value' }, '0');
  const el = h('div', { class: `metric ${cls}` },
    h('span', { class: 'metric-label' }, label),
    value,
    h('span', { class: 'metric-unit' }, unit),
  );
  return { el, value };
}

export function startRide(root: HTMLElement, circuit: Circuit, onEnd: (o: RideOutcome) => void): () => void {
  const simulated = devices.info('trainer').status !== 'connected';
  // dev aid: ?timescale=20 fast-forwards simulated rides
  const timeScale = simulated
    ? clamp(Math.round(Number(new URLSearchParams(location.search).get('timescale')) || 1), 1, 60)
    : 1;
  const recorder = new Recorder();
  const trace = new TraceRecorder();
  let ghost = loadGhost(circuit.id);

  let gear = REFERENCE_GEAR;
  let paused = false;
  let started = false;
  let ended = false;
  let nextSample = 1;
  let lastSampleTs = 0;
  let lapStartWall = 0;
  let simPower = 0;
  let simPowerNow = 0;
  let lastPush = 0;
  let lastSent = NaN;
  let saturated: -1 | 0 | 1 = 0;
  let wakeLock: WakeLockSentinel | null = null;
  // wall clock, except when fast-forwarding, where it runs at the same multiple as the ride
  let virtualNow = Date.now();
  const nowMs = () => (timeScale === 1 ? Date.now() : Math.round(virtualNow));

  // --- DOM ---------------------------------------------------------------
  const canvas = h('canvas', { class: 'stage-canvas' });
  const banner = h('div', { class: 'banner' }, simulated ? 'Raise the power to start' : 'Start pedalling');
  const toast = h('div', { class: 'toast' });
  const stage = h('div', { class: 'stage' }, canvas, banner, toast);

  const power = metric('Power', 'W', 'metric-big');
  const cadence = metric('Cadence', 'rpm');
  const heart = metric('Heart', 'bpm');
  const speed = metric('Speed', 'km/h', 'metric-big');
  const grade = metric('Grade', '%');
  const dist = metric('Dist', 'km');
  const energy = metric('Burned', 'kcal');
  const climb = metric('Climbed', 'm');
  const hudLeft = h('div', { class: 'hud hud-left' }, power.el, cadence.el, heart.el, energy.el);
  const hudRight = h('div', { class: 'hud hud-right' }, speed.el, grade.el, dist.el, climb.el);

  const lapNo = h('span', { class: 'lap-no' }, 'Lap 1');
  const lapTime = h('span', { class: 'lap-time' }, '0:00.0');
  const lapGap = h('span', { class: 'lap-gap' });
  const lapBest = h('span', { class: 'lap-best' });
  const elapsed = h('span', { class: 'lap-elapsed' }, '0:00');
  const lapBox = h('div', { class: 'lapbox' },
    h('div', { class: 'lap-row' }, lapNo, lapTime, lapGap),
    h('div', { class: 'lap-row lap-row-sub' }, lapBest, elapsed),
  );

  const gearNo = h('span', { class: 'gear-no' }, String(gear + 1));
  const gearFlag = h('span', { class: 'gear-flag' });
  const pips = Array.from({ length: GEAR_COUNT }, () => h('i', { class: 'pip' }));
  const gearBox = h('div', { class: 'gearbox' },
    h('div', { class: 'gear-head' }, h('span', { class: 'gear-label' }, 'Gear'), gearNo, gearFlag),
    h('div', { class: 'pips' }, ...pips),
  );

  const shiftDown = h('button', { class: 'shift shift-down', 'aria-label': 'Easier gear' }, '−');
  const shiftUp = h('button', { class: 'shift shift-up', 'aria-label': 'Harder gear' }, '+');
  const pauseBtn = h('button', { class: 'icon-btn pause-btn', 'aria-label': 'Pause' }, '❚❚');
  const fullBtn = h('button', { class: 'icon-btn full-btn', 'aria-label': 'Fullscreen' }, '⛶');

  const simValue = h('span', { class: 'sim-value' }, '0 W');
  const simSlider = h('input', { type: 'range', min: 0, max: 600, step: 5, value: 0, class: 'sim-slider', 'aria-label': 'Simulated power' });
  const simBox = h('div', { class: 'simbox' }, h('span', { class: 'sim-label' }, 'Sim power'), simSlider, simValue);

  const controls = h('div', { class: 'controls' }, pauseBtn, gearBox, fullBtn);

  const pauseTitle = h('h2', null, 'Paused');
  const resumeBtn = h('button', { class: 'btn btn-primary' }, 'Resume');
  const endBtn = h('button', { class: 'btn btn-danger' }, 'End ride');
  const overlay = h('div', { class: 'overlay', hidden: true },
    h('div', { class: 'overlay-card' }, pauseTitle, resumeBtn, endBtn),
  );

  const screen = h('div', { class: `ride ${simulated ? 'is-sim' : ''}` },
    stage, hudLeft, hudRight, lapBox, controls, simulated ? simBox : null, shiftDown, shiftUp, overlay,
  );
  root.replaceChildren(screen);

  // --- ride state ----------------------------------------------------------
  const sim = new RideSim(circuit, totalMass(), onLap);
  const renderer = new Renderer(canvas, circuit, settings.scene === 'auto' ? circuit.scene : settings.scene, settings.rider);

  let toastTimer = 0;
  function showToast(text: string) {
    toast.textContent = text;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove('show'), 4000);
  }

  function onLap(lap: LapResult) {
    const wall = nowMs();
    recorder.addLap({ startTime: lapStartWall, endTime: wall });
    lapStartWall = wall;
    const finishedTrace = trace.finish(lap.time, circuit.length);
    trace.reset();
    const best = !ghost || lap.time < ghost.lapTime;
    if (best) {
      ghost = finishedTrace;
      saveGhost(circuit.id, finishedTrace);
    }
    showToast(`Lap ${lap.number}  ${fmtLap(lap.time)}${best ? '  ★ best' : ''}`);
  }

  function pushSim(force: boolean) {
    const limits = DEFAULT_SIM_LIMITS;
    const target = settings.gearMode === 'offset'
      ? offsetSimGrade({
        courseGrade: sim.grade, gearIndex: gear, neutralIndex: REFERENCE_GEAR, stepGrade: OFFSET_STEP,
        difficulty: settings.difficulty, ...limits,
      })
      : gearedSimGrade({
        courseGrade: sim.grade, k: gearFactor(gear), gameSpeed: sim.speed, mass: totalMass(),
        crr: CRR, cw: CW, difficulty: settings.difficulty, ...limits,
      });
    saturated = target.saturated;
    const now = performance.now();
    const due = now - lastPush >= SIM_PUSH_MS && Math.abs(target.grade - lastSent) >= 0.001;
    if (force || due || now - lastPush >= 3000 || Number.isNaN(lastSent)) {
      devices.setSim({ grade: target.grade, crr: CRR, cw: CW });
      lastSent = target.grade;
      lastPush = now;
    }
  }

  function renderGear() {
    setText(gearNo, String(gear + 1));
    pips.forEach((pip, i) => pip.classList.toggle('on', i <= gear));
    setText(gearFlag, saturated > 0 ? 'max' : saturated < 0 ? 'min' : '');
  }

  function updateHud() {
    setText(power.value, String(Math.round(live.power)));
    setText(cadence.value, String(Math.round(live.cadence)));
    setText(heart.value, live.heartRate > 0 ? String(Math.round(live.heartRate)) : '--');
    setText(speed.value, (sim.speed * 3.6).toFixed(1));
    const g = sim.grade;
    setText(grade.value, (g * 100).toFixed(1));
    grade.value.style.color = gradeColor(g);
    setText(dist.value, fmtKm(sim.distance));
    setText(energy.value, String(Math.round(kcalFromJoules(sim.work))));
    setText(climb.value, String(Math.round(sim.ascent)));
    setText(lapNo, `Lap ${sim.lapIndex + 1}`);
    setText(lapTime, fmtLap(sim.lapTime));
    setText(elapsed, fmtClock(sim.time));
    if (ghost) {
      setText(lapBest, `Best ${fmtLap(ghost.lapTime)}`);
      const gap = gapSeconds(ghost, sim.lapTime, sim.lapDistance);
      setText(lapGap, `${gap >= 0 ? '+' : '−'}${Math.abs(gap).toFixed(1)}`);
      lapGap.classList.toggle('behind', gap > 0);
      lapGap.classList.toggle('ahead', gap <= 0);
    } else {
      setText(lapBest, 'No best lap yet');
      setText(lapGap, '');
    }
    renderGear();
  }

  function sample() {
    let ts = Math.round(nowMs() / 1000) * 1000;
    if (ts <= lastSampleTs) ts = lastSampleTs + 1000;
    lastSampleTs = ts;
    recorder.addSample({
      timestamp: ts,
      power: Math.round(live.power),
      cadence: Math.round(live.cadence),
      speed: sim.speed,
      heartRate: Math.round(live.heartRate),
      distance: sim.distance,
      altitude: sim.altitude,
      grade: sim.grade * 100,
    });
    trace.sample(sim.lapTime, sim.lapDistance);
  }

  function afterSteps() {
    if (sim.moving && !started) {
      started = true;
      const t = nowMs();
      lapStartWall = t;
      recorder.begin({ circuitId: circuit.id, circuitName: circuit.name, startedAt: t });
      banner.classList.add('gone');
    }
    if (started) {
      if (sim.moving) recorder.resume(nowMs());
      else recorder.pause(nowMs());
    }
    while (sim.time >= nextSample) {
      sample();
      nextSample += 1;
    }
    pushSim(false);
    updateHud();
  }

  // --- loop ------------------------------------------------------------------
  let raf = 0;
  let last = performance.now();
  function frame(now: number) {
    const dt = clamp((now - last) / 1000, 0, 0.5);
    last = now;
    if (!paused) {
      virtualNow += dt * 1000 * timeScale;
      if (simulated) {
        simPowerNow += (simPower - simPowerNow) * Math.min(1, dt * 4);
        live.power = simPowerNow < 1 ? 0 : Math.round(simPowerNow);
        live.cadence = live.power > 0 ? clamp(cadenceFor(sim.speed, gear), 0, 150) : 0;
      }
      for (let i = 0; i < timeScale; i++) {
        if (sim.advance(dt, live.power) > 0) afterSteps();
      }
    }
    const ghostDistance = ghost
      ? sim.lapIndex * circuit.length + ghostLapDistance(ghost, sim.renderLapTime)
      : null;
    renderer.draw({
      distance: sim.renderDistance,
      speed: paused ? 0 : sim.speed,
      cadence: paused ? 0 : live.cadence,
      ghostDistance,
      dt: paused ? 0 : dt,
    });
    raf = requestAnimationFrame(frame);
  }

  // --- controls ----------------------------------------------------------------
  function setPaused(value: boolean) {
    if (ended || paused === value) return;
    paused = value;
    overlay.hidden = !value;
    if (value) {
      if (started) recorder.pause(nowMs());
      setText(pauseTitle, started ? `Paused at ${fmtClock(sim.time)}` : 'Paused');
    } else {
      last = performance.now();
      void acquireWakeLock();
    }
  }

  async function acquireWakeLock() {
    try {
      if (!wakeLock || wakeLock.released) wakeLock = (await navigator.wakeLock?.request('screen')) ?? null;
    } catch {
      // wake lock is a nicety; the ride works without it
    }
  }

  function setSimPower(value: number) {
    simPower = clamp(Math.round(value / 5) * 5, 0, 600);
    simSlider.value = String(simPower);
    setText(simValue, `${simPower} W`);
  }

  const press = (dir: 1 | -1) => (e: Event) => {
    e.preventDefault();
    bus.emit('shift', dir);
  };
  shiftUp.addEventListener('pointerdown', press(1));
  shiftDown.addEventListener('pointerdown', press(-1));
  simSlider.addEventListener('input', () => setSimPower(Number(simSlider.value)));
  pauseBtn.addEventListener('click', () => setPaused(true));
  resumeBtn.addEventListener('click', () => setPaused(false));
  endBtn.addEventListener('click', () => void end());
  fullBtn.addEventListener('click', () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.().catch(() => {});
  });

  const offShift = bus.on('shift', (dir) => {
    if (paused) return;
    const next = clampGear(gear + dir);
    if (next === gear) return;
    gear = next;
    navigator.vibrate?.(8);
    pushSim(true);
    renderGear();
  });

  const offKeys = bindKeyboard({
    togglePause: () => setPaused(!paused),
    nudgePower: (delta) => {
      if (simulated) setSimPower(simPower + delta);
    },
  });

  const onVisibility = () => {
    if (document.visibilityState === 'hidden') setPaused(true);
    else void acquireWakeLock();
  };
  const onPop = () => {
    // the back gesture pauses instead of leaving the ride
    history.pushState({ ride: true }, '');
    setPaused(true);
  };
  const onBeforeUnload = (e: BeforeUnloadEvent) => {
    if (started && !ended) e.preventDefault();
  };
  document.addEventListener('visibilitychange', onVisibility);
  history.pushState({ ride: true }, '');
  window.addEventListener('popstate', onPop);
  window.addEventListener('beforeunload', onBeforeUnload);

  function cleanup() {
    cancelAnimationFrame(raf);
    clearTimeout(toastTimer);
    offShift();
    offKeys();
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('popstate', onPop);
    window.removeEventListener('beforeunload', onBeforeUnload);
    renderer.destroy();
    void wakeLock?.release().catch(() => {});
    live.power = simulated ? 0 : live.power;
    if (simulated) live.cadence = 0;
  }

  async function end() {
    if (ended) return;
    ended = true;
    endBtn.disabled = true;
    resumeBtn.disabled = true;
    devices.setSim({ grade: 0, crr: CRR, cw: CW });
    let finished: FinishedRide | null = null;
    let error: string | null = null;
    if (started) {
      try {
        finished = await recorder.finish(nowMs(), settings.ftp);
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
        await recorder.discard().catch(() => {});
      }
    } else {
      error = 'The ride never started, so there is nothing to save.';
    }
    cleanup();
    onEnd({ circuit, laps: sim.laps.slice(), finished, error });
  }

  devices.setRiderMass(settings.riderMass, settings.bikeMass);
  pushSim(true);
  updateHud();
  void acquireWakeLock();
  raf = requestAnimationFrame(frame);

  return () => {
    if (!ended) {
      ended = true;
      cleanup();
    }
  };
}
