<script setup lang="ts">
// A small line chart over ride time with a crosshair tooltip. One series on the left axis,
// and optionally a second one on its own right-hand axis.
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef } from 'vue';
import { CHART_HEIGHT, layoutLine } from '../charts/line-math.ts';
import { fmtClock } from '../format.ts';

export interface ChartSeries {
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

const props = defineProps<ChartSeries & { secondary?: ChartSeries | null }>();

const plot = useTemplateRef<HTMLElement>('plot');
const svg = useTemplateRef<SVGSVGElement>('svg');
const width = ref(0);
const duration = computed(() => Math.max(props.values.length, props.secondary?.values.length ?? 0) - 1);
const opts = computed(() => ({ rightAxis: !!props.secondary, duration: duration.value }));
const layout = computed(() => (width.value > 0 ? layoutLine(props.values, width.value, props.zeroBased, opts.value) : null));
const layout2 = computed(() => (
  width.value > 0 && props.secondary ? layoutLine(props.secondary.values, width.value, props.secondary.zeroBased, opts.value) : null
));
const label = computed(() => [props.title, props.secondary?.title].filter(Boolean).join(' and '));

// hover: second of ride time, or null
const hovered = ref<number | null>(null);
function nearest(points: Array<{ t: number; x: number; y: number; v: number }>, t: number) {
  if (points.length === 0) return null;
  let best = points[0];
  for (const p of points) if (Math.abs(p.t - t) < Math.abs(best.t - t)) best = p;
  return best;
}
const hoverPoint = computed(() => (layout.value && hovered.value !== null ? nearest(layout.value.points, hovered.value) : null));
const hoverPoint2 = computed(() => (layout2.value && hovered.value !== null ? nearest(layout2.value.points, hovered.value) : null));
const hoverX = computed(() => hoverPoint.value?.x ?? hoverPoint2.value?.x ?? 0);
const tipStyle = computed(() => {
  if (hovered.value === null) return {};
  const x = hoverX.value;
  return x > width.value * 0.6 ? { right: `${width.value - x + 10}px` } : { left: `${x + 10}px` };
});

function show(e: PointerEvent) {
  const l = layout.value ?? layout2.value;
  if (!l || !svg.value) return;
  const px = e.clientX - svg.value.getBoundingClientRect().left;
  hovered.value = Math.round(((px - l.plotX) / l.plotWidth) * duration.value);
}
function hide() {
  hovered.value = null;
}

let observer: ResizeObserver | null = null;
onMounted(() => {
  if (typeof ResizeObserver !== 'undefined' && plot.value) {
    observer = new ResizeObserver(() => {
      const w = Math.floor(plot.value?.clientWidth ?? 0);
      if (w > 0 && w !== width.value) width.value = w;
    });
    observer.observe(plot.value);
  } else {
    width.value = 600;
  }
});
onBeforeUnmount(() => {
  observer?.disconnect();
  observer = null;
});
</script>

<template>
  <figure class="chart">
    <figcaption>
      <span class="chart-series">
        <i class="chart-key" :style="{ background: color }"></i>
        <strong>{{ title }}</strong>
        <span class="chart-sub">{{ summary }}</span>
      </span>
      <span v-if="secondary" class="chart-series">
        <i class="chart-key" :style="{ background: secondary.color }"></i>
        <strong>{{ secondary.title }}</strong>
        <span class="chart-sub">{{ secondary.summary }}</span>
      </span>
    </figcaption>
    <div ref="plot" class="chart-plot">
      <svg
        ref="svg"
        class="chart-svg"
        :height="CHART_HEIGHT"
        :width="width"
        :viewBox="`0 0 ${width} ${CHART_HEIGHT}`"
        role="img"
        :aria-label="`${label} over the ride: ${summary}${secondary ? `; ${secondary.summary}` : ''}`"
      >
        <template v-if="layout">
          <template v-for="tick in layout.valueTicks" :key="tick.value">
            <line :x1="layout.plotX" :x2="layout.plotX + layout.plotWidth" :y1="tick.y" :y2="tick.y" :class="tick.axis ? 'chart-axis' : 'chart-grid'" />
            <text :x="layout.plotX - 6" :y="tick.y + 3.5" class="chart-tick" text-anchor="end">{{ tick.value }}</text>
          </template>
          <text v-for="tick in layout.timeTicks" :key="tick.t" :x="tick.x" :y="CHART_HEIGHT - 6" class="chart-tick" :text-anchor="tick.anchor">{{ fmtClock(tick.t) }}</text>
          <path v-if="zeroBased" :d="layout.areaPath" :fill="color" fill-opacity="0.1" />
          <path :d="layout.linePath" fill="none" :stroke="color" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
          <circle :cx="layout.peak.x" :cy="layout.peak.y" r="4" :fill="color" class="chart-dot" />
          <text :x="layout.peakLabel.x" :y="layout.peakLabel.y" class="chart-label" :text-anchor="layout.peakLabel.anchor">{{ layout.peakLabel.text }}</text>
        </template>
        <template v-if="layout2 && secondary">
          <!-- the right axis: labels only, the grid belongs to the left series -->
          <text v-for="tick in layout2.valueTicks" :key="tick.value" :x="layout2.plotX + layout2.plotWidth + 6" :y="tick.y + 3.5" class="chart-tick chart-tick-right" text-anchor="start">{{ tick.value }}</text>
          <path :d="layout2.linePath" fill="none" :stroke="secondary.color" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
          <circle :cx="layout2.peak.x" :cy="layout2.peak.y" r="4" :fill="secondary.color" class="chart-dot" />
        </template>
        <template v-if="layout || layout2">
          <line :x1="hoverX" :x2="hoverX" :y1="(layout ?? layout2)!.plotY" :y2="(layout ?? layout2)!.plotY + (layout ?? layout2)!.plotHeight" class="chart-hair" :visibility="hovered !== null ? 'visible' : 'hidden'" />
          <circle :cx="hoverPoint?.x ?? 0" :cy="hoverPoint?.y ?? 0" r="4" :fill="color" class="chart-dot" :visibility="hoverPoint ? 'visible' : 'hidden'" />
          <circle v-if="secondary" :cx="hoverPoint2?.x ?? 0" :cy="hoverPoint2?.y ?? 0" r="4" :fill="secondary.color" class="chart-dot" :visibility="hoverPoint2 ? 'visible' : 'hidden'" />
          <rect :x="(layout ?? layout2)!.plotX" y="0" :width="(layout ?? layout2)!.plotWidth" :height="CHART_HEIGHT" fill="transparent" @pointermove="show" @pointerdown="show" @pointerleave="hide" @pointercancel="hide" />
        </template>
      </svg>
      <div class="chart-tip" :hidden="hovered === null" :style="tipStyle">
        <span class="chart-tip-time">{{ hovered !== null ? fmtClock(Math.max(0, hovered)) : '' }}</span>
        <span v-if="hoverPoint" class="chart-series">
          <i class="chart-key" :style="{ background: color }"></i>
          <strong>{{ Math.round(hoverPoint.v) }} {{ unit }}</strong>
        </span>
        <span v-if="secondary && hoverPoint2" class="chart-series">
          <i class="chart-key" :style="{ background: secondary.color }"></i>
          <strong>{{ Math.round(hoverPoint2.v) }} {{ secondary.unit }}</strong>
        </span>
      </div>
    </div>
  </figure>
</template>
