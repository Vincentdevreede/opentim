<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, useTemplateRef, watchEffect } from "vue";
import type { Composition } from "../parts.ts";
import { compositionCanvas } from "./pixels.ts";

/** Draws a frame of a part at its own size; CSS scales it up with sharp pixels. It is drawn once it scrolls into view. */
const props = withDefaults(
  defineProps<{
    composition: Composition;
    palette?: Uint8Array;
    scale?: number;
    flipX?: boolean;
    flipY?: boolean;
  }>(),
  { palette: undefined, scale: 1, flipX: false, flipY: false },
);

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
  const { composition, palette } = props;
  if (!el || !visible.value) return;
  const context = el.getContext("2d");
  if (!context) return;
  const picture = compositionCanvas(composition, palette);
  el.width = picture.width;
  el.height = picture.height;
  context.drawImage(picture, 0, 0);
});
</script>

<template>
  <canvas
    ref="canvas"
    class="block shrink-0 [image-rendering:pixelated]"
    :style="{
      width: `${composition.bounds.width * scale}px`,
      height: `${composition.bounds.height * scale}px`,
      transform: flipX || flipY ? `scale(${flipX ? -1 : 1}, ${flipY ? -1 : 1})` : undefined,
    }"
  ></canvas>
</template>
