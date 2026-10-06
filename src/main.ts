import { renderHome } from './ui/home.ts';
import { startRide } from './ui/ride.ts';
import { renderSummary } from './ui/summary.ts';
import type { Circuit } from './ride/circuit.ts';

// The manifest and its icons are served as plain files (see public/), outside the bundle.
const manifest = document.createElement('link');
manifest.rel = 'manifest';
manifest.href = '/manifest.webmanifest';
document.head.append(manifest);

const root = document.getElementById('app')!;
let cleanup: () => void = () => {};

function show(next: () => () => void) {
  cleanup();
  cleanup = next();
}

function home() {
  show(() => renderHome(root, { onStart: ride }));
}

function ride(circuit: Circuit) {
  show(() => startRide(root, circuit, (outcome) => show(() => renderSummary(root, outcome, home))));
}

home();
