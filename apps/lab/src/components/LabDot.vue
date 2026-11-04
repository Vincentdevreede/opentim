<script setup lang="ts">
import { CONFIDENCE_TIPS, type Confidence } from "../kinds.ts";
import LabTip from "./LabTip.vue";

/**
 * A small round dot that shows a state at a glance, in the colours of the status badges. `accent` marks something
 * waiting on the user, `none` is an empty ring for nothing yet. Under the pointer it lights up and says what it means,
 * in `title` or else in the words for its state.
 */
defineProps<{ status: Confidence | "accent" | "none"; title?: string }>();

const COLORS: Record<Confidence | "accent" | "none", string> = {
  decoded: "bg-decoded",
  partial: "bg-partial",
  hypothesis: "bg-hypothesis",
  unsupported: "bg-faint",
  error: "bg-error",
  accent: "bg-accent",
  none: "border border-muted",
};
const TIPS: Record<Confidence | "accent" | "none", string> = {
  ...CONFIDENCE_TIPS,
  accent: "Waiting for you.",
  none: "Nothing yet.",
};
</script>

<template>
  <span class="inline-flex shrink-0">
    <LabTip :text="title ?? TIPS[status]" :focusable="false">
      <!-- The hover area is larger than the dot, without taking more room. -->
      <span class="-m-[5px] grid size-4 cursor-help place-items-center rounded-full transition-colors hover:bg-ink/12">
        <span class="inline-block size-1.5 rounded-full" :class="COLORS[status]" aria-hidden="true"></span>
      </span>
    </LabTip>
    <span class="sr-only">{{ status }}</span>
  </span>
</template>
