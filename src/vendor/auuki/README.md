# Code borrowed from Auuki

Source: https://github.com/dvmarinoff/Auuki (AGPL-3.0), commit
`c0d1d4a045f0262604a8c85a4f6b088a4d6f4178`, copied 2026-10-06. Paths mirror Auuki's `src/`.

Files are unmodified except the ones below, which carry a "Modified for bikeboi" header:

- `ble/connectable.js`: removed the race controller, SmO2 and core temperature services
  (imports and setup blocks). `_onDisconnect` now clears the connected flag and aborts the
  `gattserverdisconnected` listener so reconnects don't stack handlers.
- `functions.js`: `print.log` is silent unless `globalThis.BIKEBOI_DEBUG === true`.
- `fit/local-activity.js`: file_id uses the development manufacturer id instead of a
  Garmin Edge 1030 identity.
- `fit/profiles/product-message-definitions.js`: `record` no longer carries position,
  SmO2 or core temperature fields.

Not copied: `ble/rcs`, `ble/moxy`, `ble/ct`, `ble/dis`, `ble/reactive-connectable.js`,
`fit/fit.js`, `fit/local-course.js`, views, models.
