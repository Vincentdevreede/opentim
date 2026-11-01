<script setup lang="ts">
import type { Confidence } from "../kinds.ts";

/**
 * A small round dot that shows a state at a glance, in the colours of the status badges. `accent` marks something
 * waiting on the user, `none` is an empty ring for nothing yet.
 */
defineProps<{ status: Confidence | "accent" | "none" }>();

const COLORS: Record<Confidence | "accent" | "none", string> = {
  decoded: "bg-decoded",
  partial: "bg-partial",
  hypothesis: "bg-hypothesis",
  unsupported: "bg-faint",
  error: "bg-error",
  accent: "bg-accent",
  none: "border border-muted",
};
</script>

<template>
  <span class="inline-block size-1.5 shrink-0 rounded-full" :class="COLORS[status]" aria-hidden="true"></span>
</template>
