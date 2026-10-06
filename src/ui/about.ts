// About page: what bikeboi is, what you need, and how a ride behaves.

import connectShot from '../../img/connect.png';
import pacemakerShot from '../../img/pacemaker.png';
import rideShot from '../../img/preview.png';
import resultsShot from '../../img/results.png';
import riderShot from '../../img/rider_setup.png';
import setupShot from '../../img/settings.png';
import { h } from './dom.ts';

const SOURCE_URL = 'https://github.com/hrafnkell/bikeboi';

function shot(src: string, alt: string, caption: string, cls = ''): HTMLElement {
  return h('figure', { class: `shot ${cls}` },
    h('img', { src, alt, loading: 'lazy' }),
    h('figcaption', null, caption),
  );
}

function list(...items: Array<string | Node>): HTMLElement {
  return h('ul', null, ...items.map((item) => h('li', null, item)));
}

function keys(...rows: Array<[string, string]>): HTMLElement {
  return h('dl', { class: 'keys' },
    ...rows.flatMap(([what, how]) => [h('dt', null, what), h('dd', null, how)]),
  );
}

export function renderAbout(root: HTMLElement, onBack: () => void): () => void {
  const back = () => h('button', { class: 'btn', onclick: onBack }, '← Back to start');

  root.replaceChildren(
    h('main', { class: 'screen about' },
      h('div', { class: 'row' }, back()),
      h('h1', null, 'About bikeboi'),
      h('p', { class: 'lead' },
        'bikeboi turns an indoor trainer session into a side-scrolling game. You ride laps of a circuit, chase a ghost of your own best lap, shift virtual gears, and take a ride file home at the end. It runs in the browser: nothing to install, no account.',
      ),
      h('div', { class: 'shots shots-hero' },
        shot(rideShot, 'A ride in the Tron scene on a phone: the game on top, power, speed, gear and shift buttons below', 'A ride on a phone, in the Tron scene.'),
        shot(connectShot, 'The start screen with device connection and the six circuits', 'The start screen: devices and circuits.'),
      ),

      h('section', null,
        h('h2', null, 'Why I made it'),
        h('p', null,
          'Zwift is expensive if you only ride casually. I wanted a simple app for trainer sessions that still simulates a real ride, with gears to shift and a road that goes up and down.',
        ),
        h('p', null,
          'Structured workouts weren\u2019t working for me. I push myself harder when there is terrain to get over, so that is what bikeboi gives you.',
        ),
      ),

      h('section', null,
        h('h2', null, 'What you need'),
        list(
          'A smart trainer that speaks Bluetooth (FTMS, Tacx FE-C or Wahoo). A plain power meter works too, without resistance control.',
          'Chrome or Edge on Android, Windows, macOS, Linux or ChromeOS. Safari and Firefox, and every browser on iPhone and iPad, cannot connect to Bluetooth devices from a web page.',
          'Optional: a heart-rate strap, and a Zwift Click (the original single-puck one) for shifting.',
          'No trainer? You can still try everything with simulated power.',
        ),
      ),

      h('section', null,
        h('h2', null, 'Getting started'),
        h('ol', null,
          h('li', null, 'Wake your trainer and tap Connect next to Trainer. The browser shows a list; pick your trainer. Do the same for a heart-rate strap or Click if you have them. Each device needs its own tap, and you pair again on each visit.'),
          h('li', null, 'Pick a circuit, from a flat 2 km loop to a 20 km ride over two climbs, and a scene if you want something other than the circuit’s own.'),
          h('li', null, 'Enter your weight, your bike’s weight and your FTP. Weight decides how fast you climb.'),
          h('li', null, 'Dress your rider if you like, then press Ride and start pedalling.'),
        ),
        h('div', { class: 'shots' },
          shot(setupShot, 'Rider weight, bike weight, FTP, gear feel and hill difficulty settings', 'Weights, FTP, gear feel and hill difficulty.', 'shot-wide'),
          shot(riderShot, 'The rider editor with a live preview and colour pickers', 'Helmet, kit, frame, tyres and wheels are yours to choose.', 'shot-wide'),
        ),
      ),

      h('section', null,
        h('h2', null, 'How a ride behaves'),
        list(
          'Your speed comes from your power, the gradient and your weight, the same way it would outside. More watts or less weight means faster.',
          'The trainer gets harder on climbs and easier on descents. Hill difficulty scales how much of the gradient you feel; it never changes your speed.',
          'Gears change how hard the pedals feel at a given cadence, not how fast you go for a given power. There are 24, and every ride starts in gear 12.',
          'The clock runs only while you are moving. Stop pedalling and roll to a halt, and the ride waits for you.',
          'Each time you cross the line a lap is timed. Your best lap on each circuit is kept in this browser and rides beside you as a translucent ghost, with the gap shown in seconds.',
          'Climbs, descents and sprints are timed as segments. As you approach one, a panel shows what is coming; on it, you see how much is left, an estimated finishing time and how you compare with your best. Your best on each segment is kept in this browser.',
          'The cards show live power, cadence and heart rate with their highest values so far, plus speed, gradient, distance, metres climbed and an estimate of calories burned.',
          'Switching to another app or tab pauses the ride. The screen is kept awake while you ride.',
        ),
        keys(
          ['Harder / easier gear', 'Zwift Click, the + and − buttons, or the up / down arrow keys'],
          ['Pause', 'The pause button or Space'],
          ['Simulated power', 'The slider, or the left / right arrow keys (only without a trainer)'],
        ),
      ),

      h('section', null,
        h('h2', null, 'The pacemaker'),
        h('p', null,
          'The pacemaker is a robot rider that shares the road with you, so there is always someone to keep up with. It weighs what you weigh, so the hills cost it exactly what they cost you. Switch it on under Pacemaker on the start screen.',
        ),
        h('div', { class: 'shots' },
          shot(pacemakerShot, 'A ride with the robot pacemaker a few metres ahead, and the workout step, time left and gap shown under the lap timer', 'The robot five metres up the road, early in a workout.'),
        ),
        h('h3', null, 'Steady watts'),
        h('p', null,
          'The robot holds one power for the whole ride, for example 200 W. Stay with it and you are riding at 200 W yourself, whatever the road does.',
        ),
        h('h3', null, 'Workouts'),
        h('p', null,
          'The robot follows a structured session: warm-up, intervals, recoveries, cool-down. A few are built in, and you can write your own or paste one from intervals.icu, which uses the same format:',
        ),
        h('pre', { class: 'code' }, `Warmup
- 10m ramp 50-75%

Main Set 3x
- 10m 240w
- 2m 180w

- Cooldown 8m 55%`),
        list(
          'One step per line, starting with a dash: a time (10m, 30s, 1h, 5m30s), then a power target.',
          'Power can be watts (240w), a percentage of your FTP (75%), a range (88-93%) or a zone (Z1 to Z7). The zones are the standard seven, as percentages of the FTP you entered.',
          '"ramp" slides between two powers over the step, and "freeride" leaves a step open.',
          'A line such as "3x" or "Main Set 3x" repeats the steps under it, up to the next blank line.',
          'Words before the time name the step. Distance steps and heart-rate or pace targets are not supported; the editor tells you which line it cannot read.',
        ),
        h('h3', null, 'What you see while riding'),
        list(
          'The robot on the road with its current power above it. When it is out of view, an arrow at the edge of the screen shows which way it went.',
          'A line under the lap timer with how far ahead or behind it is, in metres and in seconds. Red with a plus means you are behind; green with a minus means you are ahead.',
          'With a workout: the name of the step, the time left in it and what comes next. The power card shows the target and turns it green while you are on it. A banner and a short buzz mark each change of step.',
          'The robot rides only while your clock runs. Stop, and it waits for you.',
        ),
        h('h3', null, 'Hard mode'),
        h('p', null,
          'Normally the pacemaker is only something to chase: the trainer keeps simulating the road and your power is up to you. In hard mode the trainer takes over and sets its resistance so that you put out the pacemaker\u2019s power at any cadence. This is what other apps call ERG mode.',
        ),
        list(
          'Hills stop changing the effort. They still change your speed, because speed comes from your power and the gradient.',
          'The + and \u2212 buttons no longer change gear. They make the whole session 5% harder or easier, from 50% to 150%, and the robot follows.',
          'During a free-ride step, and once the workout is over, the trainer goes back to the road and the buttons go back to gears.',
          'If you let your cadence drop very low the trainer has to push back harder to hold the power, which can grind you to a halt. Keep the pedals turning, or ease the intensity.',
          'Hard mode needs a trainer that can hold a power target, which most smart trainers can. It has been tried with simulated power only so far, not yet on a real trainer.',
        ),
      ),

      h('section', null,
        h('h2', null, 'After the ride'),
        h('p', null,
          'End the ride from the pause menu. The summary shows your totals, lap times and graphs of power and heart rate, and a button to download the ride as a FIT file. Upload that file to Strava, Garmin Connect or intervals.icu like any other activity.',
        ),
        h('div', { class: 'shots' },
          shot(resultsShot, 'The summary screen with time, distance, power, speed, climbing and calories, and a Download FIT file button', 'The summary, with the FIT download.'),
        ),
        h('p', null,
          'If the browser closes mid-ride, nothing is lost. The next time you open bikeboi, the start screen offers to resume the ride where it stopped, or to save what was recorded.',
        ),
      ),

      h('section', null,
        h('h2', null, 'Good to know'),
        list(
          'Everything stays on your device. Settings, best laps and rides are stored in this browser; nothing is uploaded and there are no accounts.',
          'Calories are estimated from the work you did at the pedals, assuming typical cycling efficiency. Heart rate is not used.',
          'bikeboi is new. It has been tested far more with simulated power than on real trainers, so gear feel in particular may need tuning. The "Simple" gear feel is there as a fallback.',
          h('span', null,
            'It is free software under the AGPL-3.0, built on Bluetooth, physics and FIT code from ',
            h('a', { href: 'https://github.com/dvmarinoff/Auuki', target: '_blank', rel: 'noopener' }, 'Auuki'),
            '. The source is on ',
            h('a', { href: SOURCE_URL, target: '_blank', rel: 'noopener' }, 'GitHub'),
            '.',
          ),
        ),
      ),

      h('div', { class: 'row' }, back()),
      h('footer', { class: 'footer' },
        'A ',
        h('a', { href: 'https://www.hlekkir.is', target: '_blank', rel: 'noopener' }, 'hlekkir.is'),
        ' project.',
      ),
    ),
  );
  window.scrollTo(0, 0);
  return () => {};
}
