// Reactive view of the settings for templates. It proxies the very object state.ts
// exports, so saveSettings() and engine code reading `settings` see the same values.
// Rule: engine code (ride controller, renderer, pacer) imports `settings` from state.ts;
// components use `settingsR`.

import { reactive } from 'vue';
import { settings } from '../state.ts';

export const settingsR = reactive(settings);
