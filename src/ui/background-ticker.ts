// A steady tick that keeps coming when the page is hidden. Browsers stop requestAnimationFrame
// and throttle a hidden page's timers to once a second or worse, but a dedicated worker's
// timer keeps its pace, so the ride can carry on while a call is answered.

export interface Ticker {
  start(): void;
  stop(): void;
  dispose(): void;
}

const SOURCE = 'let t=null;onmessage=(e)=>{clearInterval(t);t=null;if(e.data>0)t=setInterval(()=>postMessage(0),e.data)};';

export function createTicker(onTick: () => void, intervalMs = 200): Ticker {
  let worker: Worker | null = null;
  let running = false;
  const make = (): Worker | null => {
    if (typeof Worker === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined') return null;
    try {
      const url = URL.createObjectURL(new Blob([SOURCE], { type: 'text/javascript' }));
      const w = new Worker(url);
      URL.revokeObjectURL(url);
      w.onmessage = () => {
        if (running) onTick();
      };
      return w;
    } catch {
      return null;
    }
  };
  return {
    start() {
      if (running) return;
      running = true;
      worker ??= make();
      worker?.postMessage(intervalMs);
    },
    stop() {
      if (!running) return;
      running = false;
      worker?.postMessage(0);
    },
    dispose() {
      running = false;
      worker?.terminate();
      worker = null;
    },
  };
}
