// Keyboard input. On-screen buttons and the Click emit the same 'shift' event on the bus.

import { bus } from './state.ts';
import type { Unsubscribe } from './state.ts';

export interface KeyHandlers {
  togglePause(): void;
  /** Change simulated power by this many watts. */
  nudgePower(delta: number): void;
}

export function bindKeyboard(handlers: KeyHandlers): Unsubscribe {
  const onKey = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
    const target = e.target as HTMLElement | null;
    const tag = target?.tagName;
    const isRange = tag === 'INPUT' && (target as HTMLInputElement).type === 'range';
    if ((tag === 'INPUT' && !isRange) || tag === 'SELECT' || tag === 'TEXTAREA') return;

    switch (e.code) {
      case 'ArrowUp':
      case 'Equal':
      case 'NumpadAdd':
        e.preventDefault();
        bus.emit('shift', 1);
        break;
      case 'ArrowDown':
      case 'Minus':
      case 'NumpadSubtract':
        e.preventDefault();
        bus.emit('shift', -1);
        break;
      case 'ArrowRight':
        if (isRange) return;
        e.preventDefault();
        handlers.nudgePower(10);
        break;
      case 'ArrowLeft':
        if (isRange) return;
        e.preventDefault();
        handlers.nudgePower(-10);
        break;
      case 'Space':
        if (e.repeat || tag === 'BUTTON') return;
        e.preventDefault();
        handlers.togglePause();
        break;
    }
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}
