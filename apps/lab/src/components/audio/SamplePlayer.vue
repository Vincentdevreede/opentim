<script setup lang="ts">
import type { Pcm } from "@opentim/sound";
import { colors } from "@opentim/theme";
import { computed, onBeforeUnmount, onMounted, ref, toRef, useTemplateRef, watchEffect } from "vue";
import { duration } from "../../audio.ts";
import LabButton from "../LabButton.vue";
import LabIcon from "../LabIcon.vue";
import { useSamplePlayer } from "./player.ts";

const props = defineProps<{ pcm: Pcm }>();

const { playing, position, length, loop, volume, toggle, seek } = useSamplePlayer(toRef(props, "pcm"));
const canvas = useTemplateRef<HTMLCanvasElement>("canvas");
const width = ref(0);
const progress = computed(() => (length.value ? position.value / length.value : 0));

/** The lowest and highest value of the samples under each column of the waveform, over both channels in stereo. */
const peaks = computed(() => {
  const channels = props.pcm.right ? [props.pcm.samples, props.pcm.right] : [props.pcm.samples];
  const length = props.pcm.samples.length;
  const columns = Math.max(1, Math.floor(width.value));
  const out: [number, number][] = [];
  for (let x = 0; x < columns; x++) {
    const start = Math.floor((x / columns) * length);
    const end = Math.max(start + 1, Math.floor(((x + 1) / columns) * length));
    let low = 1;
    let high = -1;
    for (const data of channels) {
      for (let i = start; i < end && i < length; i++) {
        low = Math.min(low, data[i]!);
        high = Math.max(high, data[i]!);
      }
    }
    out.push(low > high ? [0, 0] : [low, high]);
  }
  return out;
});

watchEffect(() => {
  const el = canvas.value;
  if (!el || !width.value) return;
  const ratio = window.devicePixelRatio || 1;
  const height = el.clientHeight;
  el.width = Math.round(width.value * ratio);
  el.height = Math.round(height * ratio);
  const g = el.getContext("2d");
  if (!g) return;
  g.scale(ratio, ratio);
  g.clearRect(0, 0, width.value, height);
  g.fillStyle = colors.line;
  g.fillRect(0, height / 2, width.value, 1);
  const played = progress.value * peaks.value.length;
  peaks.value.forEach(([low, high], x) => {
    const top = ((1 - high) / 2) * height;
    const bottom = ((1 - low) / 2) * height;
    g.fillStyle = x < played ? colors.accent : colors.lineStrong;
    g.fillRect(x, top, 1, Math.max(1, bottom - top));
  });
});

const resize = new ResizeObserver(([entry]) => (width.value = entry?.contentRect.width ?? 0));
onMounted(() => canvas.value && resize.observe(canvas.value));

function seekTo(e: MouseEvent) {
  const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
  seek(((e.clientX - box.left) / box.width) * length.value);
}

function onKeydown(e: KeyboardEvent) {
  if (e.key !== " " || e.ctrlKey || e.metaKey || e.altKey || !(e.target instanceof HTMLElement)) return;
  // A focused button presses itself on Space, and a disclosure's summary opens.
  if (e.target.closest("input, textarea, select, button, summary, [contenteditable]")) return;
  e.preventDefault();
  if (!e.repeat) toggle();
}
onMounted(() => window.addEventListener("keydown", onKeydown));
onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown);
  resize.disconnect();
});
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex items-center gap-3">
      <button
        type="button"
        class="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full border border-accent bg-accent text-accent-ink hover:bg-accent-hover"
        :aria-label="playing ? 'Pause' : 'Play'"
        @click="toggle"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path v-if="playing" d="M6 4h4v16H6zM14 4h4v16h-4z" />
          <path v-else d="M7 4v16l13-8z" />
        </svg>
      </button>
      <div
        class="relative h-12 min-w-0 flex-1 cursor-pointer overflow-hidden rounded-md bg-sunken"
        role="slider"
        aria-label="Position"
        :aria-valuemin="0"
        :aria-valuemax="Number(length.toFixed(2))"
        :aria-valuenow="Number(position.toFixed(2))"
        :aria-valuetext="duration(position)"
        tabindex="0"
        @click="seekTo"
        @keydown.left.prevent="seek(position - 0.1)"
        @keydown.right.prevent="seek(position + 0.1)"
      >
        <canvas ref="canvas" class="block size-full"></canvas>
      </div>
      <span class="shrink-0 font-mono text-soft tabular">{{ duration(position) }} / {{ duration(length) }}</span>
    </div>
    <div class="flex items-center gap-2.5">
      <LabButton
        :class="loop && 'border-accent! bg-accent/12! text-accent!'"
        :aria-pressed="loop"
        title="Repeat between the sample’s loop points"
        @click="loop = !loop"
      >
        <LabIcon name="loop" :size="13" :stroke="2" />Loop
      </LabButton>
      <div class="flex-1"></div>
      <LabIcon name="volume" :size="15" :stroke="2" class="text-soft" />
      <label class="flex items-center">
        <span class="sr-only">Volume</span>
        <input v-model.number="volume" type="range" min="0" max="1" step="0.05" class="w-[120px] accent-accent" />
      </label>
      <span class="w-9 font-mono text-muted tabular">{{ Math.round(volume * 100) }}%</span>
    </div>
  </div>
</template>
