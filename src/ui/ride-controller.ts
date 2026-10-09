// The ride itself: frame loop, simulation, trainer control, ghost, pacemaker, segments and
// recording. It publishes everything the HUD shows into a small reactive view-model; the
// RideScreen component only renders that. Engine objects are never made reactive.

import { markRaw, shallowReactive } from 'vue';
import { devices } from '../ble/devices.ts';
import { DEFAULT_SIM_LIMITS, MAX_CW } from '../ble/sim-sender.ts';
import { Renderer, gradeColor, segmentColors } from '../game/renderer.ts';
import type { OtherRider } from '../game/renderer.ts';
import { clamp, fmtClock, fmtLap } from '../format.ts';
import { altValue, distValue, fmtShort, imperial, speedValue } from './units.ts';
import { bindKeyboard } from '../input.ts';
import type { Circuit } from '../ride/circuit.ts';
import { devCountSimulated, devTimeScale } from '../dev.ts';
import { kcalFromJoules } from '../ride/energy.ts';
import {
  GEAR_COUNT, REFERENCE_GEAR, cadenceFor, clampGear, gearFactor, gearedSimGrade, offsetSimGrade, trainerSpeedFor,
} from '../ride/gears.ts';
import { TraceRecorder, gapSeconds, ghostLapDistance, loadGhost, saveGhost } from '../ride/ghost.ts';
import { powerZone } from '../ride/zones.ts';
import { createTicker } from './background-ticker.ts';
import type { RideOutcome } from '../ride/outcome.ts';
import { Pacer, Track } from '../ride/pacer.ts';
import { Recorder } from '../ride/recorder.ts';
import type { FinishedRide } from '../ride/recorder.ts';
import { resumeState } from '../ride/resume.ts';
import type { SavedRide } from '../ride/ride-store.ts';
import { SegmentTracker, describeSegment } from '../ride/segments.ts';
import type { SegmentEffort } from '../ride/segments.ts';
import { RideSim, projectTime } from '../ride/sim.ts';
import { warmupRoad } from '../ride/circuits/index.ts';
import type { LapResult } from '../ride/sim.ts';
import { WorkoutPlan, describeTarget, parseWorkout } from '../ride/workout.ts';
import { findWorkout } from '../ride/workouts.ts';
import { StanceSelector } from '../game/stance.ts';
import { bus, live, settings, totalMass } from '../state.ts';
import { CRR, CW } from '../types.ts';

const OFFSET_STEP = 0.005; // gradient per gear in the offset rule
const POWER_WINDOW_MS = 3000; // the power card averages this long
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
  /** True on the warm-up road, before the circuit. */
  warmingUp: boolean;
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
  /** End the warm-up and start the circuit. */
  startRide(): void;
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
  const timeScale = simulated ? devTimeScale() : 1;
  // a simulated ride proves nothing, so it sets no bests and is not saved; on localhost
  // ?count=1 lifts that, so the real-ride paths can be tested without a trainer
  const counts = !simulated || devCountSimulated();
  const recorder = new Recorder();
  const trace = new TraceRecorder();
  let ghost = loadGhost(circuit.id);

  let gear = REFERENCE_GEAR;
  let paused = false;
  let started = false;
  // a warm-up is a flat ride before the circuit: recorded as part of the ride, but no laps,
  // segments or bests come from it
  let warmingUp = settings.warmup && !resume;
  // how much of the ride the warm-up took; added to the circuit's clock and distance
  const warmOffset = { seconds: 0, metres: 0 };
  let canvasEl: HTMLCanvasElement | null = null;
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
  // the power card shows a three-second average; raw trainer readings jump around too much to read
  const powerWindow: Array<{ at: number; watts: number }> = [];
  let shownPower = 0;
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
  // pacemaker gap trend, for the time-to-catch estimate and the occasional nudge
  let gapRate = 0; // metres per second the pacer is getting away (negative: you are closing)
  let gapPrev: { metres: number; at: number } | null = null;
  let nudgedAt = 0; // metres behind at which the last nudge was given
  let wasBehind = false;

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
    paused: false, pauseTitle: 'Paused', ending: false, warmingUp,
    simPower: 0, simDisabled: false,
  });

  // --- ride state ----------------------------------------------------------
  // a route's segments keep their bests under the circuit they came from
  const segmentKey = (id: string) => circuit.segments.find((s) => s.id === id)?.key ?? `${circuit.id}:${id}`;
  const segments = new SegmentTracker(
    circuit.segments,
    circuit.length,
    {
      load: (id) => loadGhost(segmentKey(id)),
      // a simulated ride proves nothing: its efforts are shown but never kept
      save: (id, trace) => {
        if (counts) saveGhost(segmentKey(id), trace);
      },
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
  const warmSim = new RideSim(warmupRoad, totalMass());
  /** The simulation being ridden right now. */
  const cur = () => (warmingUp ? warmSim : sim);
  /** Ride time and distance including the warm-up. */
  const totalTime = () => (warmingUp ? warmSim.time : warmOffset.seconds + sim.time);
  const totalDistance = () => (warmingUp ? warmSim.distance : warmOffset.metres + sim.distance);
  const totalWork = () => warmSim.work + sim.work;
  let renderer: Renderer | null = null;

  let toastTimer = 0;
  function showToast(text: string) {
    vm.toastText = text;
    vm.toastShow = true;
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => (vm.toastShow = false), 4000);
  }

  function onLap(lap: LapResult) {
    // an open route's lap line is a jump back to the start: cut to black for a moment
    if (circuit.open) renderer?.cut();
    const wall = nowMs();
    recorder.addLap({ startTime: lapStartWall, endTime: wall });
    lapStartWall = wall;
    const finishedTrace = trace.finish(lap.time, circuit.length);
    trace.reset();
    const best = !ghost || lap.time < ghost.lapTime;
    if (best) {
      // beating a time you already had is worth confetti; a first lap is just a lap
      if (ghost && counts) renderer?.celebrate();
      ghost = finishedTrace; // chased for the rest of this ride either way
      if (counts) saveGhost(circuit.id, finishedTrace);
    }
    showToast(`Lap ${lap.number}  ${fmtLap(lap.time)}${best ? '  ★ best' : ''}`);
  }

  function renderWorkout() {
    if (!plan) {
      // steady pacemaker: only hard mode has a target to show
      if (hard) {
        const watts = Math.round(settings.pacer.power * intensity);
        vm.target = `target ${watts}`;
        vm.targetOn = Math.abs(shownPower - watts) <= watts * 0.05;
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
    vm.targetOn = now.step.free || (shownPower >= low - slack && shownPower <= high + slack);
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
    if (isBest && previousBest !== null && counts) renderer?.celebrate();
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
    const metres = (m: number) => fmtShort(m, 5);
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
      vm.segTime = describeSegment(segment, fmtShort);
      vm.segInfo = upcoming.best !== null ? `best ${fmtLap(upcoming.best)}` : 'no best yet';
      vm.segGap = '';
      vm.segGapSide = '';
    }
  }

  function pushSim(force: boolean) {
    const limits = DEFAULT_SIM_LIMITS;
    const target = settings.gearMode === 'offset'
      ? offsetSimGrade({
        courseGrade: cur().grade, gearIndex: gear, neutralIndex: REFERENCE_GEAR, stepGrade: OFFSET_STEP,
        crr: CRR, cw: CW, difficulty: settings.difficulty, ...limits,
      })
      : gearedSimGrade({
        courseGrade: cur().grade, k: gearFactor(gear), trainerSpeed: trainerSpeedFor(live.cadence), mass: totalMass(),
        crr: CRR, cw: CW, maxCw: MAX_CW, difficulty: settings.difficulty, ...limits,
      });
    saturated = target.saturated;
    const now = performance.now();
    const due = now - lastPush >= SIM_PUSH_MS && Math.abs(target.grade - lastSent) >= 0.001;
    if (force || due || now - lastPush >= 3000 || Number.isNaN(lastSent)) {
      devices.setSim({ grade: target.grade, crr: target.crr, cw: target.cw });
      lastSent = target.grade;
      lastPush = now;
    }
  }

  /** Watts the trainer should hold right now, or null when it should simulate the road. */
  function ergTarget(): number | null {
    if (!hard || warmingUp) return null;
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

  /** Mean of the power readings over the last three seconds, like a head unit's 3 s power. */
  function smoothPower(now: number): number {
    powerWindow.push({ at: now, watts: live.power });
    while (powerWindow.length > 1 && now - powerWindow[0].at > POWER_WINDOW_MS) powerWindow.shift();
    return powerWindow.reduce((sum, p) => sum + p.watts, 0) / powerWindow.length;
  }

  function updateHud() {
    shownPower = smoothPower(performance.now());
    // shown in 5 W steps so the last digit stops flickering; the recording keeps the raw readings
    vm.power = String(Math.round(shownPower / 5) * 5);
    vm.cadence = String(Math.round(live.cadence));
    vm.heart = live.heartRate > 0 ? String(Math.round(live.heartRate)) : '--';
    vm.powerMax = `max ${peak.power > 0 ? Math.round(peak.power) : '--'}`;
    vm.cadenceMax = `max ${peak.cadence > 0 ? Math.round(peak.cadence) : '--'}`;
    vm.heartMax = `max ${peak.heartRate > 0 ? Math.round(peak.heartRate) : '--'}`;
    if (warmingUp) {
      vm.speed = speedValue(warmSim.speed).toFixed(1);
      vm.grade = '0.0';
      vm.gradeColor = gradeColor(0);
      vm.dist = distValue(warmSim.distance).toFixed(2);
      vm.kcal = String(Math.round(kcalFromJoules(warmSim.work)));
      vm.climb = '0';
      vm.lapNo = 'Warm-up';
      vm.lapTime = fmtClock(warmSim.time);
      vm.elapsed = '';
      vm.lapBest = 'Counts, but sets no bests';
      vm.lapGap = '';
      vm.lapGapSide = '';
      vm.segVisible = false;
      renderGear();
      return;
    }
    vm.speed = speedValue(sim.speed).toFixed(1);
    const g = sim.grade;
    vm.grade = (g * 100).toFixed(1);
    vm.gradeColor = gradeColor(g);
    vm.dist = distValue(totalDistance()).toFixed(2);
    vm.kcal = String(Math.round(kcalFromJoules(totalWork())));
    vm.climb = String(Math.round(altValue(sim.ascent)));
    vm.lapNo = `Lap ${sim.lapIndex + 1}`;
    vm.lapTime = fmtLap(sim.lapTime);
    vm.elapsed = fmtClock(totalTime());
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
      if (gapPrev && sim.time > gapPrev.at) {
        const rate = (gap.metres - gapPrev.metres) / (sim.time - gapPrev.at);
        gapRate += (rate - gapRate) * 0.15;
      }
      gapPrev = { metres: gap.metres, at: sim.time };
      const behind = gap.metres > 0;
      let catching = '';
      if (behind && gapRate < -0.2) catching = ` \u00B7 catch in ${fmtClock(Math.ceil(gap.metres / -gapRate))}`;
      else if (!behind && gapRate > 0.2) catching = ` \u00B7 caught in ${fmtClock(Math.ceil(metres / gapRate))}`;
      vm.pacerMetres = `${fmtShort(metres)} ${behind ? 'ahead of you' : 'behind you'}${catching}`;
      if (started) {
        if (behind && gap.metres >= nudgedAt + 100 && gapRate > 0) {
          nudgedAt = Math.floor(gap.metres / 100) * 100;
          showToast(`Pacer is ${fmtShort(nudgedAt)} up the road \u2014 time to dig in`);
        }
        if (!behind) nudgedAt = 0;
      }
      // the side only counts once you are clearly past, so a photo finish does not flicker
      if (Math.abs(gap.metres) > 2) {
        if (started && wasBehind && !behind) showToast('Caught the pacer!');
        wasBehind = behind;
      }
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
      speed: cur().speed,
      heartRate: Math.round(live.heartRate),
      distance: totalDistance(),
      // the warm-up road is drawn flat at the circuit's start height
      altitude: warmingUp ? circuit.altitudeAt(0) : sim.altitude,
      grade: warmingUp ? 0 : sim.grade * 100,
      gear: gear + 1,
      wheelSpeed: live.wheelSpeed,
      sentGrade: trainerMode === 'erg' || Number.isNaN(lastSent) ? undefined : lastSent * 100,
      target: trainerMode === 'erg' ? lastErg : undefined,
      ...(warmingUp ? { warmup: true } : {}),
    });
    if (!warmingUp) trace.sample(sim.lapTime, sim.lapDistance);
  }

  function afterSteps() {
    const moving = cur().moving;
    if (moving && !started) {
      started = true;
      const t = nowMs();
      lapStartWall = t;
      recorder.begin({ circuitId: circuit.id, circuitName: circuit.name, startedAt: t });
      vm.bannerGone = true;
    }
    if (moving) vm.bannerGone = true;
    if (started) {
      if (moving) recorder.resume(nowMs());
      else recorder.pause(nowMs());
      steadyPower += (live.power - steadyPower) * 0.05;
      recentPower += (live.power - recentPower) * 0.3;
      peak.power = Math.max(peak.power, live.power);
      peak.cadence = Math.max(peak.cadence, live.cadence);
      peak.heartRate = Math.max(peak.heartRate, live.heartRate);
    }
    while (totalTime() >= nextSample) {
      sample();
      nextSample += 1;
    }
    pushControl(false);
    updateHud();
  }

  // --- loop ------------------------------------------------------------------
  let raf = 0;
  let last = performance.now();
  // while the page is hidden (a call, another app) a worker keeps the ride ticking without drawing
  let hidden = false;
  let hiddenRideStart = 0;
  const ticker = createTicker(() => {
    if (hidden) advance(performance.now());
  });

  /** Move the ride on to `now`: power in, physics, recording, trainer control, HUD. */
  function advance(now: number): number {
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
        live.cadence = live.power > 0 ? clamp(cadenceFor(cur().speed, gear), 0, 150) : 0;
      }
      for (let i = 0; i < timeScale; i++) {
        if (cur().advance(dt, live.power) > 0) afterSteps();
      }
    }
    return dt;
  }

  function frame(now: number) {
    if (hidden) {
      // the worker is advancing the ride; drawing resumes with the next visible frame
      raf = requestAnimationFrame(frame);
      return;
    }
    const dt = advance(now);
    const others: OtherRider[] = [];
    if (warmingUp) {
      // alone on the flat: no ghost, pacemaker or segments yet
    } else if (ghost) {
      others.push({
        kind: 'ghost', label: 'best lap',
        distance: sim.lapIndex * circuit.length + ghostLapDistance(ghost, sim.renderLapTime),
      });
    }
    if (pacer && !warmingUp) others.push({ kind: 'pacer', label: `${pacer.power} W`, distance: pacer.renderDistance(sim.alpha) });
    if (!warmingUp) {
      for (const g of segments.ghosts(sim.renderDistance, sim.renderTime)) {
        others.push({ kind: 'segment', label: `best ${g.segment.type}`, distance: g.distance, color: segmentColors[g.segment.type] });
      }
    }
    const posture = paused
      ? stance.current
      : stance.update(dt, { power: started ? recentPower : live.power, ftp: settings.ftp, speed: cur().speed, grade: cur().grade });
    renderer?.draw({
      distance: cur().renderDistance,
      speed: paused ? 0 : cur().speed,
      cadence: paused ? 0 : live.cadence,
      others,
      stance: posture,
      zone: started && !paused ? powerZone(shownPower, settings.ftp) : 0,
      dt: paused ? 0 : dt,
    });
    raf = requestAnimationFrame(frame);
  }

  // --- controls ----------------------------------------------------------------
  /** Leave the warm-up road for the circuit, carrying the current speed across the line. */
  function startRide() {
    if (!warmingUp || ended) return;
    warmingUp = false;
    vm.warmingUp = false;
    warmOffset.seconds = warmSim.time;
    warmOffset.metres = warmSim.distance;
    if (started) {
      // the warm-up is its own lap in the file
      const wall = nowMs();
      recorder.addLap({ startTime: lapStartWall, endTime: wall, warmup: true });
      lapStartWall = wall;
    }
    sim.speed = warmSim.speed;
    if (canvasEl) {
      renderer?.destroy();
      renderer = new Renderer(canvasEl, circuit, settings.scene === 'auto' ? circuit.scene : settings.scene, settings.rider);
      renderer.imperial = imperial();
    }
    vm.bannerGone = false;
    pushControl(true);
    updateHud();
    showToast(warmSim.speed > 0 ? 'Go!' : 'Start pedalling');
  }

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
    if (document.visibilityState === 'hidden') {
      if (ended) return;
      hidden = true;
      hiddenRideStart = cur().time;
      last = performance.now();
      ticker.start();
    } else {
      ticker.stop();
      hidden = false;
      last = performance.now();
      const rode = cur().time - hiddenRideStart;
      if (rode >= 5) showToast(`Kept riding while you were away: ${fmtClock(rode)}`);
      void acquireWakeLock();
    }
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
    ticker.dispose();
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
      circuit, simulated: !counts, laps: sim.laps.slice(), efforts: segments.efforts.slice(), finished, error,
      pacer: pacer && started ? { power: pacer.power, gap: pacer.gap(sim.distance, riderTrack, sim.time) } : null,
      workout: plan && started
        ? { name: workoutEntry!.name, ridden: Math.min(sim.time, plan.duration), duration: plan.duration }
        : null,
      warmup: warmSim.time > 0 ? { seconds: warmingUp ? warmSim.time : warmOffset.seconds, metres: warmingUp ? warmSim.distance : warmOffset.metres } : null,
    });
  }

  if (resume) {
    const state = resumeState(resume, circuit);
    recorder.resumeFrom(resume);
    sim.restore(state);
    warmOffset.seconds = state.warmup.seconds;
    warmOffset.metres = state.warmup.metres;
    started = true;
    nextSample = state.warmup.seconds + state.time + 1;
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
    canvasEl = canvas;
    const road = warmingUp ? warmupRoad : circuit;
    renderer = new Renderer(canvas, road, settings.scene === 'auto' ? circuit.scene : settings.scene, settings.rider);
    renderer.strip = !warmingUp;
    renderer.imperial = imperial();

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
    banner: (resume
      ? (simulated ? 'Raise the power to carry on' : 'Start pedalling to carry on')
      : warmingUp
        ? (simulated ? 'Warm up on the flat, then press Start the ride' : 'Warm up, then press Start the ride')
        : (simulated ? 'Raise the power to start' : 'Start pedalling'))
      + (simulated && counts ? ' (test ride: counts)' : ''),
    attach,
    setPaused,
    startRide,
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
