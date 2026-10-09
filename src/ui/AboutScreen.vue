<script setup lang="ts">
// About page: what bikeboi is, what you need, and how a ride behaves.
import { onMounted } from 'vue';
import connectShot from '../../img/connect.png';
import pacemakerShot from '../../img/pacemaker.png';
import rideShot from '../../img/preview.png';
import resultsShot from '../../img/results.png';
import riderShot from '../../img/rider_setup.png';
import setupShot from '../../img/settings.png';

const SOURCE_URL = 'https://github.com/hrafnkell/bikeboi';

const emit = defineEmits<{ back: [] }>();

onMounted(() => window.scrollTo(0, 0));
</script>

<template>
  <main class="screen about">
    <div class="row"><button class="btn" @click="emit('back')">← Back to start</button></div>
    <h1>About bikeboi</h1>
    <p class="lead">
      bikeboi turns an indoor trainer session into a side-scrolling game. You ride laps of a circuit, chase a ghost of your own best lap, shift virtual gears, and take a ride file home at the end. It runs in the browser: nothing to install, no account.
    </p>
    <div class="shots shots-hero">
      <figure class="shot">
        <img :src="rideShot" alt="A ride in the Tron scene on a phone: the game on top, power, speed, gear and shift buttons below" loading="lazy" />
        <figcaption>A ride on a phone, in the Tron scene.</figcaption>
      </figure>
      <figure class="shot">
        <img :src="connectShot" alt="The start screen with device connection and the circuits" loading="lazy" />
        <figcaption>The start screen: devices and circuits.</figcaption>
      </figure>
    </div>

    <section>
      <h2>Why I made it</h2>
      <p>
        Zwift is expensive if you only ride casually. I wanted a simple app for trainer sessions that still simulates a real ride, with gears to shift and a road that goes up and down.
      </p>
      <p>
        Structured workouts weren’t working for me. I push myself harder when there is terrain to get over, so that is what bikeboi gives you.
      </p>
    </section>

    <section>
      <h2>What you need</h2>
      <ul>
        <li>A smart trainer that speaks Bluetooth (FTMS, Tacx FE-C or Wahoo). A plain power meter works too, without resistance control.</li>
        <li>Chrome or Edge on Android, Windows, macOS, Linux or ChromeOS. Safari and Firefox, and every browser on iPhone and iPad, cannot connect to Bluetooth devices from a web page.</li>
        <li>Optional: a heart-rate strap, and a Zwift Click (the original single-puck one) for shifting.</li>
        <li>No trainer? You can still try everything with simulated power.</li>
      </ul>
    </section>

    <section>
      <h2>Getting started</h2>
      <ol>
        <li>Wake your trainer and tap Connect next to Trainer. The browser shows a list; pick your trainer. Do the same for a heart-rate strap or Click if you have them. Each device needs its own tap, and you pair again on each visit.</li>
        <li>Pick a circuit, from a flat 2 km loop to a 20 km ride over two climbs, and a scene if you want something other than the circuit’s own. Circuits loop, so you can pick a short one and do however many laps you like.</li>
        <li>Enter your weight, your bike’s weight and your FTP under Setup (on your account page once you sign in). Weight decides how fast you climb.</li>
        <li>Dress your rider if you like, then press Ride and start pedalling.</li>
      </ol>
      <div class="shots">
        <figure class="shot shot-wide">
          <img :src="setupShot" alt="Rider weight, bike weight, FTP, gear feel and hill difficulty settings" loading="lazy" />
          <figcaption>Weights, FTP, gear feel and hill difficulty.</figcaption>
        </figure>
        <figure class="shot shot-wide">
          <img :src="riderShot" alt="The rider editor with a live preview and colour pickers" loading="lazy" />
          <figcaption>Helmet, kit, frame, tyres and wheels are yours to choose.</figcaption>
        </figure>
      </div>
    </section>

    <section>
      <h2>How a ride behaves</h2>
      <ul>
        <li>Your speed comes from your power, the gradient and your weight, the same way it would outside. More watts or less weight means faster.</li>
        <li>The trainer gets harder on climbs and easier on descents. Hill difficulty scales how much of the gradient you feel; it never changes your speed.</li>
        <li>Gears change how hard the pedals feel at a given cadence, not how fast you go for a given power. There are 27, from lighter than any cassette to a 55/10, and every ride starts in gear 15. Gear 15 matches a real ratio of about 2.4 (50/21, 36/15 or 34/14), so put your bike in a gear like that and leave it there: the virtual gears are measured from it.</li>
        <li>The physical gear scales every virtual gear: a smaller one (say 34/19) makes the whole range lighter, a bigger one heavier. Trainers also cannot go below their own minimum resistance, which rises with wheel speed, so if the low gears still feel too hard on a climb at a high cadence, drop the bike a physical gear rather than spinning faster.</li>
          <li>Circuits can be strung together into a route with the + Route buttons: one lap is then the whole chain, in order, and the route's profile is shown as you build it. + To the top adds only a circuit's climb; at the summit the road ends and you are put back at the start of the next leg (or of the route), so hill repeats are just the same climb added twice. Routes keep their own best lap, but segment bests are shared with the circuits they came from.</li>
        <li>Tick "Warm up first" on the start screen and the ride begins on a flat road instead: spin there for as long as you like, with gears but no clock, ghost or pacemaker, then press Start the ride to roll onto the circuit at the speed you are doing. The warm-up is recorded as its own lap in the ride file and counts towards time, distance and calories, but sets no lap or segment times.</li>
        <li>The clock runs only while you are moving. Stop pedalling and roll to a halt, and the ride waits for you.</li>
        <li>Each time you cross the line a lap is timed. Your best lap on each circuit is kept in this browser and rides beside you as a translucent ghost, with the gap shown in seconds.</li>
        <li>Climbs, descents and sprints are timed as segments. As you approach one, a panel shows what is coming; on it, you see how much is left, an estimated finishing time and how you compare with your best. Your best on each segment is kept in this browser, and rides the segment beside you as a ghost in the segment's colour: it waits on the line as you approach and sets off when you cross it.</li>
        <li>The lap strip at the top is painted as you ride it, in the colour of the power zone you are in (grey recovery, blue endurance, green tempo, yellow threshold, orange VO2max, red anaerobic, purple sprint, from your FTP). Each lap paints over the last. The power graph after the ride is coloured the same way, with the time spent in each zone underneath.</li>
        <li>The cards show live power, cadence and heart rate with their highest values so far, plus speed, gradient, distance, metres climbed and an estimate of calories burned.</li>
        <li>Answering a call or switching to another app does not stop the ride: as long as the trainer keeps sending power the clock, the recording and the gradient carry on in the background, and the game catches up when you return. If the phone kills the tab anyway, the start screen offers to resume the ride from its autosave. The screen is kept awake while you ride.</li>
      </ul>
      <dl class="keys">
        <dt>Harder / easier gear</dt>
        <dd>Zwift Click, the + and − buttons, or the up / down arrow keys</dd>
        <dt>Pause</dt>
        <dd>The pause button or Space</dd>
        <dt>Simulated power</dt>
        <dd>The slider, or the left / right arrow keys (only without a trainer)</dd>
      </dl>
    </section>

    <section>
      <h2>The pacemaker</h2>
      <p>
        The pacemaker is a robot rider that shares the road with you, so there is always someone to keep up with. It weighs what you weigh, so the hills cost it exactly what they cost you. Switch it on under Pacemaker on the start screen.
      </p>
      <div class="shots">
        <figure class="shot">
          <img :src="pacemakerShot" alt="A ride with the robot pacemaker a few metres ahead, and the workout step, time left and gap shown under the lap timer" loading="lazy" />
          <figcaption>The robot five metres up the road, early in a workout.</figcaption>
        </figure>
      </div>
      <h3>Steady watts</h3>
      <p>
        The robot holds one power for the whole ride, for example 200 W. Stay with it and you are riding at 200 W yourself, whatever the road does.
      </p>
      <h3>Workouts</h3>
      <p>
        The robot follows a structured session: warm-up, intervals, recoveries, cool-down. A few are built in, and you can write your own or paste one from intervals.icu, which uses the same format:
      </p>
      <pre class="code">Warmup
- 10m ramp 50-75%

Main Set 3x
- 10m 240w
- 2m 180w

- Cooldown 8m 55%</pre>
      <ul>
        <li>One step per line, starting with a dash: a time (10m, 30s, 1h, 5m30s), then a power target.</li>
        <li>Power can be watts (240w), a percentage of your FTP (75%), a range (88-93%) or a zone (Z1 to Z7). The zones are the standard seven, as percentages of the FTP you entered.</li>
        <li>"ramp" slides between two powers over the step, and "freeride" leaves a step open.</li>
        <li>A line such as "3x" or "Main Set 3x" repeats the steps under it, up to the next blank line.</li>
        <li>Words before the time name the step. Distance steps and heart-rate or pace targets are not supported; the editor tells you which line it cannot read.</li>
      </ul>
      <h3>What you see while riding</h3>
      <ul>
        <li>The robot on the road with its current power above it. When it is out of view, an arrow at the edge of the screen shows which way it went.</li>
        <li>A line under the lap timer with how far ahead or behind it is, in metres and in seconds. Red with a plus means you are behind; green with a minus means you are ahead.</li>
        <li>With a workout: the name of the step, the time left in it and what comes next. The power card shows the target and turns it green while you are on it. A banner and a short buzz mark each change of step.</li>
        <li>The robot rides only while your clock runs. Stop, and it waits for you.</li>
      </ul>
      <h3>Hard mode</h3>
      <p>
        Normally the pacemaker is only something to chase: the trainer keeps simulating the road and your power is up to you. In hard mode the trainer takes over and sets its resistance so that you put out the pacemaker’s power at any cadence. This is what other apps call ERG mode.
      </p>
      <ul>
        <li>Hills stop changing the effort. They still change your speed, because speed comes from your power and the gradient.</li>
        <li>The + and − buttons no longer change gear. They make the whole session 5% harder or easier, from 50% to 150%, and the robot follows.</li>
        <li>During a free-ride step, and once the workout is over, the trainer goes back to the road and the buttons go back to gears.</li>
        <li>If you let your cadence drop very low the trainer has to push back harder to hold the power, which can grind you to a halt. Keep the pedals turning, or ease the intensity.</li>
        <li>Hard mode needs a trainer that can hold a power target, which most smart trainers can. It has been tried with simulated power only so far, not yet on a real trainer.</li>
      </ul>
    </section>

    <section>
      <h2>After the ride</h2>
      <p>
        End the ride from the pause menu. The summary shows your totals, lap times and graphs of power and heart rate, and a button to download the ride as a FIT file. Upload that file to Strava, Garmin Connect or intervals.icu like any other activity.
      </p>
      <div class="shots">
        <figure class="shot">
          <img :src="resultsShot" alt="The summary screen with time, distance, power, speed, climbing and calories, and a Download FIT file button" loading="lazy" />
          <figcaption>The summary, with the FIT download.</figcaption>
        </figure>
      </div>
      <p>
        If the browser closes mid-ride, nothing is lost. The next time you open bikeboi, the start screen offers to resume the ride where it stopped, or to save what was recorded.
      </p>
    </section>

    <section>
      <h2>Your account and data</h2>
      <p>
        Without an account everything stays in this browser: settings, best laps, workouts and rides never leave your device.
      </p>
      <p>
        An account is optional. With one, bikeboi stores your email address, a password hash (never the password), your settings and rider look, your best laps and segment bests, your own workouts, and your rides (the summary, the FIT file, and a per-second log of the gear, the trainer’s wheel speed and what the trainer was told, shown as graphs under each ride) on a server in Iceland run by hlekkir.is. The site sits behind Cloudflare, which sees traffic in transit. Nothing is shared with anyone else, and there are no analytics.
      </p>
      <p>
        If you connect intervals.icu, your API key for it is stored encrypted and used only to send rides there when you ask, or automatically if you switch that on; disconnecting forgets the key. The only cookie is the session cookie that keeps you signed in; it is strictly necessary, so there is no cookie banner. You can download every ride, and delete the whole account from your account page (the user icon at the top) at any time; the server copy goes immediately and backups expire within 14 days. Questions or requests: <a href="mailto:hrafnkell@gmail.com">hrafnkell@gmail.com</a>.
      </p>
    </section>

    <section>
      <h2>Good to know</h2>
      <ul>
        <li>Calories are estimated from the work you did at the pedals, assuming typical cycling efficiency. Heart rate is not used.</li>
        <li>bikeboi is new. It has been tested far more with simulated power than on real trainers, so gear feel in particular may need tuning. The "Simple" gear feel is there as a fallback.</li>
        <li>
          <span>
            It is free software under the AGPL-3.0, built on Bluetooth, physics and FIT code from
            <a href="https://github.com/dvmarinoff/Auuki" target="_blank" rel="noopener">Auuki</a>. The source is on
            <a :href="SOURCE_URL" target="_blank" rel="noopener">GitHub</a>.
          </span>
        </li>
      </ul>
    </section>

    <div class="row"><button class="btn" @click="emit('back')">← Back to start</button></div>
    <footer class="footer">
      A <a href="https://www.hlekkir.is" target="_blank" rel="noopener">hlekkir.is</a> project.
    </footer>
  </main>
</template>
