import { renderAbout } from './ui/about.ts';
import { renderHome } from './ui/home.ts';
import { startRide } from './ui/ride.ts';
import { renderSummary } from './ui/summary.ts';
import type { Circuit } from './ride/circuit.ts';
import type { SavedRide } from './ride/ride-store.ts';

// The manifest and its icons are served as plain files (see public/), outside the bundle.
const manifest = document.createElement('link');
manifest.rel = 'manifest';
manifest.href = '/manifest.webmanifest';
document.head.append(manifest);

const root = document.getElementById('app')!;
let cleanup: () => void = () => {};
/** While riding or reading the summary, the address bar does not drive the screen. */
let busy = false;

function show(next: () => () => void) {
  cleanup();
  cleanup = next();
}

/** Start screen or About, whichever the address says. */
function route() {
  if (busy) return;
  if (location.hash === '#about') {
    show(() =>
      renderAbout(root, () => {
        // drop the hash without leaving a bare "#" in the address
        history.pushState(null, '', location.pathname + location.search);
        route();
      }),
    );
  } else {
    show(() => renderHome(root, { onStart: (circuit) => ride(circuit), onResume: ride }));
  }
}

function ride(circuit: Circuit, resume: SavedRide | null = null) {
  busy = true;
  const done = () => {
    busy = false;
    route();
  };
  show(() => startRide(root, circuit, (outcome) => show(() => renderSummary(root, outcome, done)), resume));
}

window.addEventListener('hashchange', route);
window.addEventListener('popstate', route);
route();
