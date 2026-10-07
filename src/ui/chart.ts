// A small single-series line chart over ride time, with a crosshair tooltip.

import { fmtClock, h } from './dom.ts';

export { downsample, niceTicks, restorePeak, timeTicks } from '../charts/line-math.ts';
export type { ChartPoint } from '../charts/line-math.ts';
import { downsample, niceTicks, restorePeak, timeTicks } from '../charts/line-math.ts';

export interface LineChartOptions {
  title: string;
  unit: string;
  /** Series colour; text never uses it. */
  color: string;
  /** One value per second of ride time; null where there was no reading. */
  values: Array<number | null>;
  /** Start the value axis at zero and wash the area under the line. */
  zeroBased: boolean;
  /** Shown beside the title, e.g. "avg 185 W, max 412 W". */
  summary: string;
}

const NS = 'http://www.w3.org/2000/svg';
const HEIGHT = 170;
const M = { left: 38, right: 14, top: 16, bottom: 22 };

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

export function lineChart(o: LineChartOptions): HTMLElement {
  const root = svg('svg', { class: 'chart-svg', height: HEIGHT, role: 'img', 'aria-label': `${o.title} over the ride: ${o.summary}` });
  const tipValue = h('strong');
  const tipTime = h('span', { class: 'chart-tip-time' });
  const tipKey = h('i', { class: 'chart-key' });
  tipKey.style.background = o.color;
  const tip = h('div', { class: 'chart-tip', hidden: true }, tipKey, tipValue, tipTime);
  const plot = h('div', { class: 'chart-plot' });
  plot.append(root, tip);

  const key = h('i', { class: 'chart-key' });
  key.style.background = o.color;
  const el = h('figure', { class: 'chart' },
    h('figcaption', null, key, h('strong', null, o.title), h('span', { class: 'chart-sub' }, o.summary)),
    plot,
  );

  const duration = Math.max(1, o.values.length - 1);

  function render(width: number) {
    root.replaceChildren();
    root.setAttribute('width', String(width));
    root.setAttribute('viewBox', `0 0 ${width} ${HEIGHT}`);
    const pw = Math.max(10, width - M.left - M.right);
    const ph = HEIGHT - M.top - M.bottom;
    const points = downsample(o.values, Math.max(40, Math.floor(pw / 2)));
    const peakAt = restorePeak(points, o.values);
    const present = points.filter((p): p is { t: number; v: number } => p.v !== null);
    if (present.length === 0 || peakAt < 0) return;

    const lo = o.zeroBased ? 0 : Math.min(...present.map((p) => p.v));
    const hi = Math.max(...present.map((p) => p.v));
    const ticks = niceTicks(o.zeroBased ? 0 : lo - (hi - lo) * 0.1 - 1, hi + (hi - lo) * 0.05 + 1, 4);
    const y0 = ticks[0];
    const y1 = ticks[ticks.length - 1];
    const x = (t: number) => M.left + (t / duration) * pw;
    const y = (v: number) => M.top + ph - ((v - y0) / (y1 - y0)) * ph;

    // gridlines and value axis
    for (const tick of ticks) {
      root.append(svg('line', { x1: M.left, x2: M.left + pw, y1: y(tick), y2: y(tick), class: tick === y0 ? 'chart-axis' : 'chart-grid' }));
      const label = svg('text', { x: M.left - 6, y: y(tick) + 3.5, class: 'chart-tick', 'text-anchor': 'end' });
      label.textContent = String(tick);
      root.append(label);
    }
    // time axis
    for (const t of timeTicks(duration, Math.max(2, Math.floor(pw / 70)))) {
      const label = svg('text', { x: x(t), y: HEIGHT - 6, class: 'chart-tick', 'text-anchor': t === 0 ? 'start' : 'middle' });
      label.textContent = fmtClock(t);
      root.append(label);
    }

    // line (broken at gaps) and area wash
    let line = '';
    let area = '';
    let run: Array<{ t: number; v: number }> = [];
    const flush = () => {
      if (run.length === 0) return;
      const d = run.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
      line += d;
      area += `${d}L${x(run[run.length - 1].t).toFixed(1)},${y(y0).toFixed(1)}L${x(run[0].t).toFixed(1)},${y(y0).toFixed(1)}Z`;
      run = [];
    };
    for (const p of points) {
      if (p.v === null) flush();
      else run.push({ t: p.t, v: p.v });
    }
    flush();
    if (o.zeroBased) root.append(svg('path', { d: area, fill: o.color, 'fill-opacity': 0.1 }));
    root.append(svg('path', { d: line, fill: 'none', stroke: o.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));

    // the one direct label: the peak
    const peak = points[peakAt] as { t: number; v: number };
    root.append(svg('circle', { cx: x(peak.t), cy: y(peak.v), r: 4, fill: o.color, class: 'chart-dot' }));
    const peakLabel = svg('text', {
      x: Math.min(M.left + pw - 4, Math.max(M.left + 4, x(peak.t))), y: Math.max(11, y(peak.v) - 8),
      class: 'chart-label', 'text-anchor': x(peak.t) > M.left + pw - 30 ? 'end' : x(peak.t) < M.left + 30 ? 'start' : 'middle',
    });
    peakLabel.textContent = `${Math.round(peak.v)}`;
    root.append(peakLabel);

    // hover layer: the crosshair finds the nearest reading
    const hair = svg('line', { y1: M.top, y2: M.top + ph, class: 'chart-hair', visibility: 'hidden' });
    const dot = svg('circle', { r: 4, fill: o.color, class: 'chart-dot', visibility: 'hidden' });
    const hit = svg('rect', { x: M.left, y: 0, width: pw, height: HEIGHT, fill: 'transparent' });
    root.append(hair, dot, hit);

    const hide = () => {
      hair.setAttribute('visibility', 'hidden');
      dot.setAttribute('visibility', 'hidden');
      tip.hidden = true;
    };
    const show = (e: PointerEvent) => {
      const px = e.clientX - root.getBoundingClientRect().left;
      let best = present[0];
      for (const p of present) if (Math.abs(x(p.t) - px) < Math.abs(x(best.t) - px)) best = p;
      const cx = x(best.t);
      hair.setAttribute('x1', String(cx));
      hair.setAttribute('x2', String(cx));
      hair.setAttribute('visibility', 'visible');
      dot.setAttribute('cx', String(cx));
      dot.setAttribute('cy', String(y(best.v)));
      dot.setAttribute('visibility', 'visible');
      tipValue.textContent = `${Math.round(best.v)} ${o.unit}`;
      tipTime.textContent = fmtClock(best.t);
      tip.hidden = false;
      const flip = cx > width * 0.6;
      tip.style.left = flip ? '' : `${cx + 10}px`;
      tip.style.right = flip ? `${width - cx + 10}px` : '';
    };
    hit.addEventListener('pointermove', show);
    hit.addEventListener('pointerdown', show);
    hit.addEventListener('pointerleave', hide);
    hit.addEventListener('pointercancel', hide);
  }

  if (typeof ResizeObserver !== 'undefined') {
    let lastWidth = 0;
    new ResizeObserver(() => {
      const width = Math.floor(plot.clientWidth);
      if (width > 0 && width !== lastWidth) {
        lastWidth = width;
        render(width);
      }
    }).observe(plot);
  } else {
    render(600);
  }
  return el;
}
