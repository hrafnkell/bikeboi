<script setup lang="ts">
// A small single-series line chart over ride time, with a crosshair tooltip.
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef } from 'vue';
import { CHART_HEIGHT, layoutLine } from '../charts/line-math.ts';
import { fmtClock } from '../format.ts';

const props = defineProps<{
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
}>();

const plot = useTemplateRef<HTMLElement>('plot');
const svg = useTemplateRef<SVGSVGElement>('svg');
const width = ref(0);
const layout = computed(() => (width.value > 0 ? layoutLine(props.values, width.value, props.zeroBased) : null));

// hover: index into layout.points, or null
const hovered = ref<number | null>(null);
const hoverPoint = computed(() => (layout.value && hovered.value !== null ? layout.value.points[hovered.value] : null));
const tipFlip = computed(() => hoverPoint.value !== null && hoverPoint.value.x > width.value * 0.6);
const tipStyle = computed(() => {
  const p = hoverPoint.value;
  if (!p) return {};
  return tipFlip.value ? { right: `${width.value - p.x + 10}px` } : { left: `${p.x + 10}px` };
});

function show(e: PointerEvent) {
  const l = layout.value;
  if (!l || !svg.value) return;
  const px = e.clientX - svg.value.getBoundingClientRect().left;
  let best = 0;
  l.points.forEach((p, i) => {
    if (Math.abs(p.x - px) < Math.abs(l.points[best].x - px)) best = i;
  });
  hovered.value = best;
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
      <i class="chart-key" :style="{ background: color }"></i>
      <strong>{{ title }}</strong>
      <span class="chart-sub">{{ summary }}</span>
    </figcaption>
    <div ref="plot" class="chart-plot">
      <svg
        ref="svg"
        class="chart-svg"
        :height="CHART_HEIGHT"
        :width="width"
        :viewBox="`0 0 ${width} ${CHART_HEIGHT}`"
        role="img"
        :aria-label="`${title} over the ride: ${summary}`"
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
          <line :x1="hoverPoint?.x ?? 0" :x2="hoverPoint?.x ?? 0" :y1="layout.plotY" :y2="layout.plotY + layout.plotHeight" class="chart-hair" :visibility="hoverPoint ? 'visible' : 'hidden'" />
          <circle :cx="hoverPoint?.x ?? 0" :cy="hoverPoint?.y ?? 0" r="4" :fill="color" class="chart-dot" :visibility="hoverPoint ? 'visible' : 'hidden'" />
          <rect :x="layout.plotX" y="0" :width="layout.plotWidth" :height="CHART_HEIGHT" fill="transparent" @pointermove="show" @pointerdown="show" @pointerleave="hide" @pointercancel="hide" />
        </template>
      </svg>
      <div class="chart-tip" :hidden="!hoverPoint" :style="tipStyle">
        <i class="chart-key" :style="{ background: color }"></i>
        <strong>{{ hoverPoint ? `${Math.round(hoverPoint.v)} ${unit}` : '' }}</strong>
        <span class="chart-tip-time">{{ hoverPoint ? fmtClock(hoverPoint.t) : '' }}</span>
      </div>
    </div>
  </figure>
</template>
