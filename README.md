# bikeboi

A side-scrolling circuit game for smart bike trainers, in the browser. Ride laps of a
circuit, chase a ghost of your best lap, shift virtual gears with a Zwift Click (v1), the
on-screen buttons or the arrow keys, and download a FIT file at the end.

Needs a browser with Web Bluetooth (Chrome or Edge on Android or desktop). Without a
trainer it runs with simulated power.

## Run

```sh
bun install
bun run dev        # http://localhost:3000
bun test
bun run typecheck
bun run build      # static site in dist/
```

Web Bluetooth only works on `localhost` or HTTPS. To use a phone against the dev server,
expose it over HTTPS, for example `cloudflared tunnel --url http://localhost:3000` or
`tailscale serve 3000`.

On Linux desktop Chrome, Web Bluetooth may need
`chrome://flags/#enable-experimental-web-platform-features`.

## Controls

| Action | Keys | Other |
| --- | --- | --- |
| Harder / easier gear | Up / Down, `+` / `-` | on-screen buttons, Zwift Click |
| Pause | Space | pause button, switching away from the tab |
| Simulated power | Left / Right | slider (only without a trainer) |

`?timescale=20` fast-forwards simulated rides, for testing.

## Circuits and scenes

Six circuits from 2 to 20 km (`src/ride/circuits/index.ts`), each with a default scene.
The scene can be overridden on the home screen: Day, Sunset, Alpine, Rain, Midnight, Tron
(`src/game/scenes.ts`).

The rider is customisable on the home screen (helmet, hair, skin, jersey, pants, frame,
tyres, wheel style); the look lives in `src/game/rider.ts`.

Calories are an estimate from pedalling work, assuming 24 % gross efficiency
(`src/ride/energy.ts`).

## How gears work

Road speed comes from your power, the gradient and your weight; gears never change it.
A gear only changes the gradient the trainer is told to simulate, so a harder gear means
more resistance at the same cadence. "Realistic" uses a force-balance model
(`src/ride/gears.ts`); "Simple" adds a fixed gradient step per gear.

## Layout

- `src/ride/` simulation, circuits, gears, ghost, recorder
- `src/game/` canvas renderer
- `src/ble/` trainer / heart-rate / Click device layer
- `src/ui/` screens
- `src/vendor/auuki/` Bluetooth, physics and FIT code borrowed from
  [Auuki](https://github.com/dvmarinoff/Auuki); see the README there for what was changed

## Licence

AGPL-3.0, like Auuki. If you host a modified version, you must offer its source to the
people using it; set `SOURCE_URL` in `src/ui/home.ts` to your repository.
