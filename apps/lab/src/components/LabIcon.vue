<script setup lang="ts">
import { ICONS, type IconName } from "../icons.ts";

/** With `filled` the shape is filled too, like a bookmark that is set. */
withDefaults(defineProps<{ name: IconName; size?: number; stroke?: number; filled?: boolean }>(), {
  size: 14,
  stroke: 2,
  filled: false,
});
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    :fill="filled ? 'currentColor' : 'none'"
    stroke="currentColor"
    :stroke-width="stroke"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    class="shrink-0"
  >
    <path v-for="d in ICONS[name]" :key="d" :d="d" />
  </svg>
</template>
