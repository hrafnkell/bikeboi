// Tiny DOM helpers and formatters.

type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, unknown>;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Attrs | null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (key === 'class') {
      el.className = String(value);
    } else if (value === true) {
      el.setAttribute(key, '');
    } else {
      el.setAttribute(key, String(value));
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}

export function setText(el: Element, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

/** 4:32.1 */
export function fmtLap(seconds: number): string {
  const s = Math.max(0, seconds);
  const tenths = Math.floor(s * 10 + 1e-6);
  const m = Math.floor(tenths / 600);
  const rest = tenths - m * 600;
  return `${m}:${String(Math.floor(rest / 10)).padStart(2, '0')}.${rest % 10}`;
}

/** 1:04:09 or 4:09 */
export function fmtClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const hrs = Math.floor(s / 3600);
  const min = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return hrs > 0 ? `${hrs}:${String(min).padStart(2, '0')}:${sec}` : `${min}:${sec}`;
}

export function fmtKm(metres: number, digits = 2): string {
  return (metres / 1000).toFixed(digits);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
