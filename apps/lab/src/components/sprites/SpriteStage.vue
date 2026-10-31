<script setup lang="ts">
export type Background = "checker" | "black" | "white";

/** The large view of a sprite, centred on a background, with labels in its corners. */
defineProps<{ background: Background }>();

const CLASSES: Record<Background, string> = { checker: "checker", black: "bg-black", white: "bg-white" };
</script>

<template>
  <div class="relative flex min-h-0 flex-1 overflow-auto" :class="CLASSES[background]">
    <div class="m-auto p-10"><slot /></div>
    <span
      v-if="$slots.topLeft"
      class="absolute top-2 left-2 rounded-[3px] bg-sunken/85 px-1.5 py-px font-mono text-label text-ink"
      ><slot name="topLeft"
    /></span>
    <span
      v-if="$slots.topRight"
      class="absolute top-2 right-2 rounded-[3px] bg-sunken/85 px-1.5 py-px font-mono text-label text-ink"
      ><slot name="topRight"
    /></span>
    <span
      v-if="$slots.bottomLeft"
      class="absolute bottom-2 left-2 flex items-center gap-1.5 rounded-[3px] bg-sunken/90 px-1.5 py-0.5 font-mono text-label text-ink"
      ><slot name="bottomLeft"
    /></span>
  </div>
</template>
