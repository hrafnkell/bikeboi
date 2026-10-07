// The ride itself: frame loop, simulation, trainer control, ghost, pacemaker, segments and
// recording. It publishes everything the HUD shows into a small reactive view-model; the
// RideScreen component only renders that. Engine objects are never made reactive.

import { markRaw, shallowReactive } from 'vue';
import { devices } from '../ble/devices.ts';
import { DEFAULT_SIM_LIMITS } from '../ble/sim-sender.ts';
import { Renderer, gradeColor, segmentColors } from '../game/renderer.ts';
import type { OtherRider } from '../game/renderer.ts';
import { clamp, fmtClock, fmtKm, fmtLap } from '../format.ts';
import { bindKeyboard } from '../input.ts';
import type { Circuit } from '../ride/circuit.ts';
import { kcalFromJoules } from '../ride/energy.ts';
import {
  GEAR_COUNT, REFERENCE_GEAR, cadenceFor, clampGear, gearFactor, gearedSimGrade, offsetSimGrade,
} from '../ride/gears.ts';
import { TraceRecorder, gapSeconds, ghostLapDistance, loadGhost, saveGhost } from '../ride/ghost.ts';
import type { RideOutcome } from '../ride/outcome.ts';
import { Pacer, Track } from '../ride/pacer.ts';
import { Recorder } from '../ride/recorder.ts';
import type { FinishedRide } from '../ride/recorder.ts';
import { resumeState } from '../ride/resume.ts';
import type { SavedRide } from '../ride/ride-store.ts';
import { SegmentTracker, describeSegment } from '../ride/segments.ts';
import type { SegmentEffort } from '../ride/segments.ts';
import { RideSim, projectTime } from '../ride/sim.ts';
import type { LapResult } from '../ride/sim.ts';
import { WorkoutPlan, describeTarget, parseWorkout } from '../ride/workout.ts';
import { findWorkout } from '../ride/workouts.ts';
import { StanceSelector } from '../game/stance.ts';
import { bus, live, settings, totalMass } from '../state.ts';
import { CRR, CW } from '../types.ts';

const OFFSET_STEP = 0.005; // gradient per gear in the offset rule
const SIM_PUSH_MS = 500;

export type GapSide = '' | 'ahead' | 'behind';

/** Everything the ride screen displays. Plain values only; written at the 5 Hz step cadence. */
export interface RideVM {
  power: string;
  cadence: string;
  heart: string;
  powerMax: string;
  cadenceMax: string;
  heartMax: string;
  target: string;
  targetOn: boolean;
  speed: string;
  grade: string;
  gradeColor: string;
  dist: string;
  kcal: string;
  climb: string;
  lapNo: string;
  lapTime: string;
  elapsed: string;
  lapBest: string;
  lapGap: string;
  lapGapSide: GapSide;
  pacerLabel: string;
  pacerMetres: string;
  pacerGap: string;
  pacerGapSide: GapSide;
  workStep: string;
  workLeft: string;
  workNext: string;
  gearLabel: string;
  gearNo: string;
  gearFlag: string;
  /** Index of the last lit pip. */
  pipsLit: number;
  segVisible: boolean;
  segName: string;
  segColor: string;
  segLeft: string;
  segFill: string;
  segTime: string;
  segInfo: string;
  segGap: string;
  segGapSide: GapSide;
  bannerGone: boolean;
  toastText: string;
  toastShow: boolean;
  paused: boolean;
  pauseTitle: string;
  ending: boolean;
  simPower: number;
  simDisabled: boolean;
}

export interface RideController {
  readonly vm: RideVM;
  readonly simulated: boolean;
  readonly hasPacer: boolean;
  readonly hasWorkout: boolean;
  readonly banner: string;
  /** Start the ride on this canvas; call once the canvas is in the document. */
  attach(canvas: HTMLCanvasElement): void;
  setPaused(value: boolean): void;
  setSimPower(watts: number): void;
  shift(dir: 1 | -1): void;
  toggleFullscreen(): void;
  end(): Promise<void>;
  /** Stop everything; safe to call more than once. */
  dispose(): void;
}

export function createRideController(
  circuit: Circuit,
  resume: SavedRide | null,
  onEnd: (o: RideOutcome) => void,
): RideController {
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
  // the stance reacts to a shorter power average than the finish estimate does
  let recentPower = 0;
  const stance = new StanceSelector();
  let wakeLock: WakeLockSentinel | null = null;
  // wall clock, except when fast-forwarding, where it runs at the same multiple as the ride
  let virtualNow = Date.now();
  // added to the clock so a resumed ride never stamps anything earlier than what it already holds
  let clockOffset = 0;
  const nowMs = () => (timeScale === 1 ? Date.now() + clockOffset : Math.round(virtualNow));

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

  const vm = shallowReactive<RideVM>({
    power: '0', cadence: '0', heart: '--', powerMax: 'max --', cadenceMax: 'max --', heartMax: 'max --',
    target: '', targetOn: false,
    speed: '0.0', grade: '0.0', gradeColor: gradeColor(0), dist: '0.00', kcal: '0', climb: '0',
    lapNo: 'Lap 1', lapTime: '0:00.0', elapsed: '0:00', lapBest: '', lapGap: '', lapGapSide: '',
    pacerLabel: '', pacerMetres: '', pacerGap: '', pacerGapSide: '',
    workStep: '', workLeft: '', workNext: '',
    gearLabel: 'Gear', gearNo: String(gear + 1), gearFlag: '', pipsLit: gear,
    segVisible: false, segName: '', segColor: segmentColors.climb, segLeft: '', segFill: '0%',
    segTime: '', segInfo: '', segGap: '', segGapSide: '',
    bannerGone: false, toastText: '', toastShow: false,
    paused: false, pauseTitle: 'Paused', ending: false,
    simPower: 0, simDisabled: false,
  });

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
  let renderer: Renderer | null = null;

  let toastTimer = 0;
  function showToast(text: string) {
    vm.toastText = text;
    vm.toastShow = true;
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => (vm.toastShow = false), 4000);
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
        vm.target = `target ${watts}`;
        vm.targetOn = Math.abs(live.power - watts) <= watts * 0.05;
      }
      return;
    }
    const now = plan.at(sim.time);
    if (now.done) {
      vm.workStep = workoutEntry!.name;
      vm.workLeft = 'complete';
      vm.workNext = '';
      vm.target = '';
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
    vm.workStep = now.step.label;
    vm.workLeft = `${fmtClock(Math.ceil(now.remaining))} left`;
    vm.workNext = now.next
      ? `then ${describeTarget((now.next.ramp ? now.next.from : now.next.low) * k, (now.next.ramp ? now.next.from : now.next.high) * k, now.next.free)}`
      : 'last step';
    vm.target = `target ${target.replace(' W', '')}`;
    // within the band, or within 5% of a single target, counts as on target
    const slack = low === high ? low * 0.05 : 0;
    vm.targetOn = now.step.free || (live.power >= low - slack && live.power <= high + slack);
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
        ? `  ★ best by ${(previousBest - time).toFixed(1)} s`
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
    vm.segVisible = !!segment;
    if (!segment) return;
    vm.segColor = segmentColors[segment.type];
    vm.segName = segment.name;
    const metres = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.max(0, Math.round(m / 5) * 5)} m`);
    if (active) {
      vm.segLeft = `${metres(active.remaining)} to go · ${Math.round(active.fraction * 100)}%`;
      vm.segFill = `${(active.fraction * 100).toFixed(1)}%`;
      vm.segTime = fmtLap(active.elapsed);
      vm.segInfo = `est ${Number.isFinite(active.estimate) ? fmtLap(active.estimate) : '--'}${active.best !== null ? ` · best ${fmtLap(active.best)}` : ''}`;
      if (active.gap !== null) {
        vm.segGap = `${active.gap >= 0 ? '+' : '−'}${Math.abs(active.gap).toFixed(1)}`;
        vm.segGapSide = active.gap > 0 ? 'behind' : 'ahead';
      } else {
        vm.segGap = '';
        vm.segGapSide = '';
      }
    } else if (upcoming) {
      vm.segLeft = `starts in ${metres(upcoming.distanceTo)}`;
      vm.segFill = '0%';
      vm.segTime = describeSegment(segment);
      vm.segInfo = upcoming.best !== null ? `best ${fmtLap(upcoming.best)}` : 'no best yet';
      vm.segGap = '';
      vm.segGapSide = '';
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
      vm.gearLabel = 'Intensity';
      vm.gearNo = `${Math.round(intensity * 100)}%`;
      vm.pipsLit = Math.round((intensity - 0.5) * (GEAR_COUNT - 1));
      vm.gearFlag = '';
      return;
    }
    vm.gearLabel = 'Gear';
    vm.gearNo = String(gear + 1);
    vm.pipsLit = gear;
    vm.gearFlag = saturated > 0 ? 'max' : saturated < 0 ? 'min' : '';
  }

  function updateHud() {
    vm.power = String(Math.round(live.power));
    vm.cadence = String(Math.round(live.cadence));
    vm.heart = live.heartRate > 0 ? String(Math.round(live.heartRate)) : '--';
    vm.powerMax = `max ${peak.power > 0 ? Math.round(peak.power) : '--'}`;
    vm.cadenceMax = `max ${peak.cadence > 0 ? Math.round(peak.cadence) : '--'}`;
    vm.heartMax = `max ${peak.heartRate > 0 ? Math.round(peak.heartRate) : '--'}`;
    vm.speed = (sim.speed * 3.6).toFixed(1);
    const g = sim.grade;
    vm.grade = (g * 100).toFixed(1);
    vm.gradeColor = gradeColor(g);
    vm.dist = fmtKm(sim.distance);
    vm.kcal = String(Math.round(kcalFromJoules(sim.work)));
    vm.climb = String(Math.round(sim.ascent));
    vm.lapNo = `Lap ${sim.lapIndex + 1}`;
    vm.lapTime = fmtLap(sim.lapTime);
    vm.elapsed = fmtClock(sim.time);
    if (ghost) {
      vm.lapBest = `Best ${fmtLap(ghost.lapTime)}`;
      const gap = gapSeconds(ghost, sim.lapTime, sim.lapDistance);
      vm.lapGap = `${gap >= 0 ? '+' : '−'}${Math.abs(gap).toFixed(1)}`;
      vm.lapGapSide = gap > 0 ? 'behind' : 'ahead';
    } else {
      vm.lapBest = 'No best lap yet';
      vm.lapGap = '';
      vm.lapGapSide = '';
    }
    if (pacer) {
      const gap = pacer.gap(sim.distance, riderTrack, sim.time);
      const metres = Math.abs(gap.metres);
      vm.pacerLabel = `Pacer ${pacer.power} W`;
      renderWorkout();
      vm.pacerMetres = `${metres >= 1000 ? `${(metres / 1000).toFixed(2)} km` : `${Math.round(metres)} m`} ${gap.metres > 0 ? 'ahead of you' : 'behind you'}`;
      vm.pacerGap = `${gap.metres > 0 ? '+' : '−'}${Math.abs(gap.seconds).toFixed(1)}`;
      vm.pacerGapSide = gap.metres > 0 ? 'behind' : 'ahead';
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
      vm.bannerGone = true;
    }
    if (sim.moving) vm.bannerGone = true;
    if (started) {
      if (sim.moving) recorder.resume(nowMs());
      else recorder.pause(nowMs());
      steadyPower += (live.power - steadyPower) * 0.05;
      recentPower += (live.power - recentPower) * 0.3;
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
        vm.simDisabled = forced !== null;
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
    const posture = paused
      ? stance.current
      : stance.update(dt, { power: started ? recentPower : live.power, ftp: settings.ftp, speed: sim.speed, grade: sim.grade });
    renderer?.draw({
      distance: sim.renderDistance,
      speed: paused ? 0 : sim.speed,
      cadence: paused ? 0 : live.cadence,
      others,
      stance: posture,
      dt: paused ? 0 : dt,
    });
    raf = requestAnimationFrame(frame);
  }

  // --- controls ----------------------------------------------------------------
  function setPaused(value: boolean) {
    if (ended || paused === value) return;
    paused = value;
    vm.paused = value;
    if (value) {
      if (started) recorder.pause(nowMs());
      vm.pauseTitle = started ? `Paused at ${fmtClock(sim.time)}` : 'Paused';
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
    vm.simPower = simPower;
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.().catch(() => {});
  }

  let offShift = () => {};
  let offKeys = () => {};
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

  function cleanup() {
    cancelAnimationFrame(raf);
    clearTimeout(toastTimer);
    offShift();
    offKeys();
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('popstate', onPop);
    window.removeEventListener('beforeunload', onBeforeUnload);
    renderer?.destroy();
    void wakeLock?.release().catch(() => {});
    live.power = simulated ? 0 : live.power;
    if (simulated) live.cadence = 0;
  }

  async function end() {
    if (ended) return;
    ended = true;
    vm.ending = true;
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

  function attach(canvas: HTMLCanvasElement) {
    if (renderer || ended) return;
    renderer = new Renderer(canvas, circuit, settings.scene === 'auto' ? circuit.scene : settings.scene, settings.rider);

    offShift = bus.on('shift', (dir) => {
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
    offKeys = bindKeyboard({
      togglePause: () => setPaused(!paused),
      nudgePower: (delta) => {
        if (simulated) setSimPower(simPower + delta);
      },
    });
    document.addEventListener('visibilitychange', onVisibility);
    history.pushState({ ride: true }, '');
    window.addEventListener('popstate', onPop);
    window.addEventListener('beforeunload', onBeforeUnload);

    devices.setRiderMass(settings.riderMass, settings.bikeMass);
    pushControl(true);
    updateHud();
    void acquireWakeLock();
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }

  return markRaw({
    vm,
    simulated,
    hasPacer,
    hasWorkout: plan !== null,
    banner: resume
      ? (simulated ? 'Raise the power to carry on' : 'Start pedalling to carry on')
      : (simulated ? 'Raise the power to start' : 'Start pedalling'),
    attach,
    setPaused,
    setSimPower,
    shift: (dir) => bus.emit('shift', dir),
    toggleFullscreen,
    end,
    dispose() {
      if (!ended) {
        ended = true;
        cleanup();
      }
    },
  });
}
