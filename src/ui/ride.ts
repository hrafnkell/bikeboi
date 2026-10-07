// Ride screen: owns the frame loop and ties the sim, trainer, ghost, recorder and HUD together.

import { devices } from '../ble/devices.ts';
import { DEFAULT_SIM_LIMITS } from '../ble/sim-sender.ts';
import { Renderer, gradeColor, segmentColors } from '../game/renderer.ts';
import type { OtherRider } from '../game/renderer.ts';
import { bindKeyboard } from '../input.ts';
import type { Circuit } from '../ride/circuit.ts';
import {
  GEAR_COUNT, REFERENCE_GEAR, cadenceFor, clampGear, gearFactor, gearedSimGrade, offsetSimGrade,
} from '../ride/gears.ts';
import { TraceRecorder, gapSeconds, ghostLapDistance, loadGhost, saveGhost } from '../ride/ghost.ts';
import { Pacer, Track } from '../ride/pacer.ts';
import { Recorder } from '../ride/recorder.ts';
import { resumeState } from '../ride/resume.ts';
import { WorkoutPlan, describeTarget, parseWorkout } from '../ride/workout.ts';
import { findWorkout } from '../ride/workouts.ts';
import type { SavedRide } from '../ride/ride-store.ts';
import type { FinishedRide } from '../ride/recorder.ts';
import { SegmentTracker, describeSegment } from '../ride/segments.ts';
import type { SegmentEffort } from '../ride/segments.ts';
import { RideSim, projectTime } from '../ride/sim.ts';
import type { LapResult } from '../ride/sim.ts';
import { bus, live, settings, totalMass } from '../state.ts';
import { kcalFromJoules } from '../ride/energy.ts';
import { CRR, CW } from '../types.ts';
import { clamp, fmtClock, fmtKm, fmtLap, h, setText } from './dom.ts';

export type { RideOutcome } from '../ride/outcome.ts';
import type { RideOutcome } from '../ride/outcome.ts';

const OFFSET_STEP = 0.005; // gradient per gear in the offset rule
const SIM_PUSH_MS = 500;

function metric(label: string, unit: string, cls = '', withMax = false) {
  const value = h('span', { class: 'metric-value' }, '0');
  const max = h('span', { class: 'metric-max' }, withMax ? 'max --' : '');
  const target = h('span', { class: 'metric-target' });
  const el = h('div', { class: `metric ${cls}` },
    h('span', { class: 'metric-label' }, label),
    value,
    h('span', { class: 'metric-unit' }, unit),
    withMax ? max : null,
    target,
  );
  return { el, value, max, target };
}

export function startRide(
  root: HTMLElement,
  circuit: Circuit,
  onEnd: (o: RideOutcome) => void,
  /** An interrupted ride on this circuit to carry on with. */
  resume: SavedRide | null = null,
): () => void {
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
  const peak = { power: 0, cadence: 0, heartRate: 0 };
  // the finish estimate uses a steadier power than the instant reading, and is refreshed once a second
  let steadyPower = 0;
  let estimate = { at: -1, value: 0 };
  let wakeLock: WakeLockSentinel | null = null;
  // wall clock, except when fast-forwarding, where it runs at the same multiple as the ride
  let virtualNow = Date.now();
  // added to the clock so a resumed ride never stamps anything earlier than what it already holds
  let clockOffset = 0;
  const nowMs = () => (timeScale === 1 ? Date.now() + clockOffset : Math.round(virtualNow));

  // --- DOM ---------------------------------------------------------------
  const canvas = h('canvas', { class: 'stage-canvas' });
  const banner = h('div', { class: 'banner' },
    resume
      ? (simulated ? 'Raise the power to carry on' : 'Start pedalling to carry on')
      : (simulated ? 'Raise the power to start' : 'Start pedalling'),
  );
  const toast = h('div', { class: 'toast' });
  const stage = h('div', { class: 'stage' }, canvas, banner, toast);

  const power = metric('Power', 'W', 'metric-big', true);
  const cadence = metric('Cadence', 'rpm', '', true);
  const heart = metric('Heart', 'bpm', '', true);
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
  const pacerLabel = h('span', { class: 'pacer-label' });
  const pacerMetres = h('span', { class: 'pacer-metres' });
  const pacerGap = h('span', { class: 'lap-gap' });
  const pacerRow = h('div', { class: 'lap-row lap-row-sub pacer-row' }, pacerLabel, pacerMetres, pacerGap);
  const workStep = h('span', { class: 'pacer-label' });
  const workLeft = h('span', { class: 'work-left' });
  const workNext = h('span', { class: 'work-next' });
  const workRow = h('div', { class: 'lap-row lap-row-sub pacer-row' }, workStep, workLeft, workNext);

  // what the pacemaker does: nothing, steady watts, or a workout resolved against FTP
  const workoutEntry = settings.pacer.mode === 'workout' ? findWorkout(settings.pacer.workoutId) : null;
  const parsedWorkout = workoutEntry ? parseWorkout(workoutEntry.text) : null;
  const plan = parsedWorkout && parsedWorkout.errors.length === 0 ? new WorkoutPlan(parsedWorkout, settings.ftp) : null;
  const hasPacer = settings.pacer.mode === 'steady' || plan !== null;
  let stepIndex = -1;
  let workoutDone = false;
  // hard mode: the trainer holds the pacemaker's power, and the shift buttons scale it
  const hard = hasPacer && settings.pacer.hard;
  let intensity = 1;
  let trainerMode: 'sim' | 'erg' = 'sim';
  let lastErg = -1;
  const lapBox = h('div', { class: 'lapbox' },
    h('div', { class: 'lap-row' }, lapNo, lapTime, lapGap),
    h('div', { class: 'lap-row lap-row-sub' }, lapBest, elapsed),
    plan ? workRow : null,
    hasPacer ? pacerRow : null,
  );

  const segName = h('span', { class: 'seg-name' });
  const segLeft = h('span', { class: 'seg-left' });
  const segFill = h('i', { class: 'seg-fill' });
  const segTime = h('span', { class: 'seg-time' });
  const segInfo = h('span', { class: 'seg-info' });
  const segGap = h('span', { class: 'lap-gap' });
  const segBox = h('div', { class: 'segbox', hidden: true },
    h('div', { class: 'seg-row' }, segName, segLeft),
    h('div', { class: 'seg-bar' }, segFill),
    h('div', { class: 'seg-row seg-row-sub' }, segTime, segInfo, segGap),
  );

  const gearNo = h('span', { class: 'gear-no' }, String(gear + 1));
  const gearFlag = h('span', { class: 'gear-flag' });
  const gearLabel = h('span', { class: 'gear-label' }, 'Gear');
  const pips = Array.from({ length: GEAR_COUNT }, () => h('i', { class: 'pip' }));
  const gearBox = h('div', { class: 'gearbox' },
    h('div', { class: 'gear-head' }, gearLabel, gearNo, gearFlag),
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

  const screen = h('div', { class: `ride ${simulated ? 'is-sim' : ''} ${hasPacer ? 'has-pacer' : ''} ${plan ? 'has-workout' : ''}` },
    stage, hudLeft, hudRight, lapBox, segBox, controls, simulated ? simBox : null, shiftDown, shiftUp, overlay,
  );
  root.replaceChildren(screen);

  // --- ride state ----------------------------------------------------------
  const segments = new SegmentTracker(
    circuit.segments,
    circuit.length,
    {
      load: (id) => loadGhost(`${circuit.id}:${id}`),
      save: (id, trace) => saveGhost(`${circuit.id}:${id}`, trace),
    },
    onEffort,
  );
  // the pacemaker rides at the rider's weight, and only while the ride clock runs
  const pacer = !hasPacer
    ? null
    : new Pacer(circuit, totalMass(), (t) => (plan ? plan.at(t).power : settings.pacer.power) * intensity);
  const riderTrack = new Track();
  const sim = new RideSim(circuit, totalMass(), onLap, (s) => {
    segments.update(s.prevDistance, s.distance, s.prevTime, s.time);
    riderTrack.add(s.time, s.distance);
    pacer?.step();
  });
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

  function renderWorkout() {
    if (!plan) {
      // steady pacemaker: only hard mode has a target to show
      if (hard) {
        const watts = Math.round(settings.pacer.power * intensity);
        setText(power.target, `target ${watts}`);
        power.target.classList.toggle('on', Math.abs(live.power - watts) <= watts * 0.05);
      }
      return;
    }
    const now = plan.at(sim.time);
    if (now.done) {
      setText(workStep, workoutEntry!.name);
      setText(workLeft, 'complete');
      setText(workNext, '');
      setText(power.target, '');
      if (!workoutDone) {
        workoutDone = true;
        showToast('Workout complete');
        navigator.vibrate?.([60, 60, 60]);
      }
      return;
    }
    const k = hard ? intensity : 1;
    const low = now.low * k;
    const high = now.high * k;
    const target = describeTarget(low, high, now.step.free);
    setText(workStep, now.step.label);
    setText(workLeft, `${fmtClock(Math.ceil(now.remaining))} left`);
    setText(workNext, now.next ? `then ${describeTarget((now.next.ramp ? now.next.from : now.next.low) * k, (now.next.ramp ? now.next.from : now.next.high) * k, now.next.free)}` : 'last step');
    setText(power.target, `target ${target.replace(' W', '')}`);
    // within the band, or within 5% of a single target, counts as on target
    const slack = low === high ? low * 0.05 : 0;
    const on = now.step.free || (live.power >= low - slack && live.power <= high + slack);
    power.target.classList.toggle('on', on);
    if (now.index !== stepIndex) {
      if (stepIndex >= 0 || started) {
        showToast(`${now.step.label}  ${target}  ${fmtClock(now.step.end - now.step.start)}`);
        navigator.vibrate?.(40);
      }
      stepIndex = now.index;
    }
  }

  function onEffort(effort: SegmentEffort) {
    const { segment, time, previousBest, isBest } = effort;
    const versus = previousBest === null
      ? '  first time'
      : isBest
        ? `  \u2605 best by ${(previousBest - time).toFixed(1)} s`
        : `  +${(time - previousBest).toFixed(1)} s`;
    showToast(`${segment.name}  ${fmtLap(time)}${versus}`);
  }

  function renderSegment() {
    const active = segments.active(sim.distance, sim.time, (from, to) => {
      const second = Math.floor(sim.time);
      if (estimate.at !== second) {
        estimate = { at: second, value: sim.time + projectTime(circuit, totalMass(), steadyPower, sim.speed, from, to) };
      }
      return estimate.value - sim.time;
    });
    const upcoming = active ? null : segments.upcoming(sim.distance);
    const segment = active?.segment ?? upcoming?.segment;
    segBox.hidden = !segment;
    if (!segment) return;
    segBox.style.setProperty('--seg', segmentColors[segment.type]);
    setText(segName, segment.name);
    const metres = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.max(0, Math.round(m / 5) * 5)} m`);
    if (active) {
      setText(segLeft, `${metres(active.remaining)} to go \u00B7 ${Math.round(active.fraction * 100)}%`);
      segFill.style.width = `${(active.fraction * 100).toFixed(1)}%`;
      setText(segTime, fmtLap(active.elapsed));
      setText(segInfo, `est ${Number.isFinite(active.estimate) ? fmtLap(active.estimate) : '--'}${active.best !== null ? ` \u00B7 best ${fmtLap(active.best)}` : ''}`);
      if (active.gap !== null) {
        setText(segGap, `${active.gap >= 0 ? '+' : '\u2212'}${Math.abs(active.gap).toFixed(1)}`);
        segGap.classList.toggle('behind', active.gap > 0);
        segGap.classList.toggle('ahead', active.gap <= 0);
      } else {
        setText(segGap, '');
      }
    } else if (upcoming) {
      setText(segLeft, `starts in ${metres(upcoming.distanceTo)}`);
      segFill.style.width = '0%';
      setText(segTime, describeSegment(segment));
      setText(segInfo, upcoming.best !== null ? `best ${fmtLap(upcoming.best)}` : 'no best yet');
      setText(segGap, '');
    }
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

  /** Watts the trainer should hold right now, or null when it should simulate the road. */
  function ergTarget(): number | null {
    if (!hard) return null;
    if (!plan) return settings.pacer.power * intensity;
    const now = plan.at(sim.time);
    return now.done || now.step.free ? null : now.power * intensity;
  }

  /** Tell the trainer what to do: hold a power in hard mode, otherwise the geared gradient. */
  function pushControl(force: boolean) {
    const target = ergTarget();
    if (target === null) {
      // leaving ERG: the gradient must be sent again even if it has not changed
      const back = trainerMode === 'erg';
      trainerMode = 'sim';
      pushSim(force || back);
      return;
    }
    const watts = Math.round(target);
    if (force || trainerMode !== 'erg' || watts !== lastErg) {
      devices.setPower(watts);
      lastErg = watts;
    }
    trainerMode = 'erg';
    saturated = 0;
  }

  function renderGear() {
    if (ergTarget() !== null) {
      setText(gearLabel, 'Intensity');
      setText(gearNo, `${Math.round(intensity * 100)}%`);
      const lit = Math.round((intensity - 0.5) * (GEAR_COUNT - 1));
      pips.forEach((pip, i) => pip.classList.toggle('on', i <= lit));
      setText(gearFlag, '');
      return;
    }
    setText(gearLabel, 'Gear');
    setText(gearNo, String(gear + 1));
    pips.forEach((pip, i) => pip.classList.toggle('on', i <= gear));
    setText(gearFlag, saturated > 0 ? 'max' : saturated < 0 ? 'min' : '');
  }

  function updateHud() {
    setText(power.value, String(Math.round(live.power)));
    setText(cadence.value, String(Math.round(live.cadence)));
    setText(heart.value, live.heartRate > 0 ? String(Math.round(live.heartRate)) : '--');
    setText(power.max, `max ${peak.power > 0 ? Math.round(peak.power) : '--'}`);
    setText(cadence.max, `max ${peak.cadence > 0 ? Math.round(peak.cadence) : '--'}`);
    setText(heart.max, `max ${peak.heartRate > 0 ? Math.round(peak.heartRate) : '--'}`);
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
    if (pacer) {
      const gap = pacer.gap(sim.distance, riderTrack, sim.time);
      const metres = Math.abs(gap.metres);
      setText(pacerLabel, `Pacer ${pacer.power} W`);
      renderWorkout();
      setText(pacerMetres, `${metres >= 1000 ? `${(metres / 1000).toFixed(2)} km` : `${Math.round(metres)} m`} ${gap.metres > 0 ? 'ahead of you' : 'behind you'}`);
      setText(pacerGap, `${gap.metres > 0 ? '+' : '\u2212'}${Math.abs(gap.seconds).toFixed(1)}`);
      pacerGap.classList.toggle('behind', gap.metres > 0);
      pacerGap.classList.toggle('ahead', gap.metres <= 0);
    }
    renderGear();
    renderSegment();
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
    if (sim.moving) banner.classList.add('gone');
    if (started) {
      if (sim.moving) recorder.resume(nowMs());
      else recorder.pause(nowMs());
      steadyPower += (live.power - steadyPower) * 0.05;
      peak.power = Math.max(peak.power, live.power);
      peak.cadence = Math.max(peak.cadence, live.cadence);
      peak.heartRate = Math.max(peak.heartRate, live.heartRate);
    }
    while (sim.time >= nextSample) {
      sample();
      nextSample += 1;
    }
    pushControl(false);
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
        // with no trainer to hold the power, the simulated rider does what ERG would force
        const forced = ergTarget();
        if (forced !== null) setSimPower(forced);
        simSlider.disabled = forced !== null;
        simPowerNow += (simPower - simPowerNow) * Math.min(1, dt * 4);
        live.power = simPowerNow < 1 ? 0 : Math.round(simPowerNow);
        live.cadence = live.power > 0 ? clamp(cadenceFor(sim.speed, gear), 0, 150) : 0;
      }
      for (let i = 0; i < timeScale; i++) {
        if (sim.advance(dt, live.power) > 0) afterSteps();
      }
    }
    const others: OtherRider[] = [];
    if (ghost) {
      others.push({
        kind: 'ghost', label: 'best lap',
        distance: sim.lapIndex * circuit.length + ghostLapDistance(ghost, sim.renderLapTime),
      });
    }
    if (pacer) others.push({ kind: 'pacer', label: `${pacer.power} W`, distance: pacer.renderDistance(sim.alpha) });
    renderer.draw({
      distance: sim.renderDistance,
      speed: paused ? 0 : sim.speed,
      cadence: paused ? 0 : live.cadence,
      others,
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
    if (ergTarget() !== null) {
      // in hard mode the buttons make the whole workout 5% harder or easier
      const next = clamp(Math.round((intensity + dir * 0.05) * 100) / 100, 0.5, 1.5);
      if (next === intensity) return;
      intensity = next;
    } else {
      const next = clampGear(gear + dir);
      if (next === gear) return;
      gear = next;
    }
    navigator.vibrate?.(8);
    pushControl(true);
    updateHud();
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
    onEnd({
      circuit, laps: sim.laps.slice(), efforts: segments.efforts.slice(), finished, error,
      pacer: pacer && started ? { power: pacer.power, gap: pacer.gap(sim.distance, riderTrack, sim.time) } : null,
      workout: plan && started
        ? { name: workoutEntry!.name, ridden: Math.min(sim.time, plan.duration), duration: plan.duration }
        : null,
    });
  }

  if (resume) {
    const state = resumeState(resume, circuit);
    recorder.resumeFrom(resume);
    sim.restore(state);
    started = true;
    nextSample = state.time + 1;
    lastSampleTs = state.lastSampleTs;
    lapStartWall = state.lapStartWall;
    clockOffset = Math.max(0, state.lastSampleTs + 1000 - Date.now());
    virtualNow = Date.now() + clockOffset;
    Object.assign(peak, state.peak);
    for (const [t, d] of state.lapTrace) trace.sample(t, d);
    // list the segments already ridden, without announcing them or touching the bests
    segments.replaying = true;
    let from: [number, number] = [0, 0];
    for (const point of state.track) {
      segments.update(from[1], point[1], from[0], point[0]);
      riderTrack.add(point[0], point[1]);
      from = point;
    }
    segments.replaying = false;
    // the pacemaker was not saved: it has been riding for as long as the ride clock has run
    pacer?.fastForward(state.time);
    if (plan) stepIndex = plan.at(state.time).index; // no announcement for the step already under way
  }

  devices.setRiderMass(settings.riderMass, settings.bikeMass);
  pushControl(true);
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
