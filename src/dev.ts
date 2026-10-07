// Development switches, read from the address. They only work on a local host, so a
// visitor to the public site cannot turn them on.

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export function isLocalHost(hostname: string = location.hostname): boolean {
  return LOCAL_HOSTS.has(hostname);
}

function flag(name: string): string | null {
  if (!isLocalHost()) return null;
  return new URLSearchParams(location.search).get(name);
}

/** ?timescale=20 fast-forwards simulated rides. 1 when off. */
export function devTimeScale(): number {
  const n = Math.round(Number(flag('timescale')) || 1);
  return Math.min(60, Math.max(1, n));
}

/** ?count=1 makes a simulated ride count like a real one (bests kept, saved to the account). */
export function devCountSimulated(): boolean {
  return flag('count') === '1';
}
