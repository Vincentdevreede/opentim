<script setup lang="ts">
import { CONFIDENCE_TIPS, type Confidence } from "../kinds.ts";
import LabTip from "./LabTip.vue";

/**
 * A status in a small pill: a mark and a label. Under the pointer it lights up and explains itself, in `title` or else
 * in the words for its status.
 */
defineProps<{ status: Confidence; label?: string; title?: string }>();

const STYLES: Record<Confidence, { badge: string; mark: string }> = {
  decoded: { badge: "text-decoded border-decoded/35 bg-decoded/8", mark: "size-[7px] rounded-full bg-current" },
  partial: {
    badge: "text-partial border-partial/35 bg-partial/8",
    mark: "size-[7px] rounded-full border-[1.5px] border-current bg-[linear-gradient(90deg,currentColor_50%,transparent_50%)]",
  },
  hypothesis: {
    badge: "text-hypothesis border-hypothesis/35 bg-hypothesis/8",
    mark: "size-1.5 rotate-45 rounded-[1px] border-[1.5px] border-current",
  },
  unsupported: {
    badge: "text-muted border-muted/30 bg-muted/6",
    mark: "size-[7px] rounded-full border-[1.5px] border-current bg-[linear-gradient(135deg,transparent_40%,currentColor_40%,currentColor_60%,transparent_60%)]",
  },
  error: {
    badge: "text-error border-error/40 bg-error/8",
    mark: "border-x-4 border-b-[7px] border-x-transparent border-b-current",
  },
};
</script>

<template>
  <span class="inline-flex shrink-0">
    <LabTip :text="title ?? CONFIDENCE_TIPS[status]" :focusable="false">
      <span
        class="inline-flex h-[18px] cursor-help items-center gap-1 rounded-full border pr-[7px] pl-1.5 text-label leading-none font-semibold tracking-[.02em] whitespace-nowrap transition-colors hover:bg-current/16"
        :class="STYLES[status].badge"
      >
        <span class="box-border shrink-0" :class="STYLES[status].mark" aria-hidden="true"></span>
        {{ label ?? status }}
      </span>
    </LabTip>
  </span>
</template>
