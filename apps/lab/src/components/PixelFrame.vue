<script setup lang="ts">
import { frameToRgba, type Frame } from "@opentim/resources";
import { onBeforeUnmount, onMounted, ref, useTemplateRef, watchEffect } from "vue";

/** Draws a frame at its own size; CSS scales it up with sharp pixels. It is drawn once it scrolls into view. */
const props = withDefaults(defineProps<{ frame: Frame; palette?: Uint8Array; scale?: number; flip?: boolean }>(), {
  palette: undefined,
  scale: 1,
  flip: false,
});

const canvas = useTemplateRef<HTMLCanvasElement>("canvas");
const visible = ref(false);
const observer = new IntersectionObserver(([entry]) => {
  if (entry?.isIntersecting) {
    visible.value = true;
    observer.disconnect();
  }
});

onMounted(() => canvas.value && observer.observe(canvas.value));
onBeforeUnmount(() => observer.disconnect());

watchEffect(() => {
  const el = canvas.value;
  const { frame, palette } = props;
  if (!el || !visible.value) return;
  const context = el.getContext("2d");
  if (!context) return;
  el.width = frame.width;
  el.height = frame.height;
  // Without a palette, the indexes are shown as grey levels.
  const colors = palette ?? Uint8Array.from({ length: 768 }, (_, i) => Math.floor(i / 3));
  context.putImageData(new ImageData(frameToRgba(frame, colors), frame.width, frame.height), 0, 0);
});
</script>

<template>
  <canvas
    ref="canvas"
    class="block shrink-0 [image-rendering:pixelated]"
    :style="{
      width: `${frame.width * scale}px`,
      height: `${frame.height * scale}px`,
      transform: flip ? 'scaleX(-1)' : undefined,
    }"
  ></canvas>
</template>
