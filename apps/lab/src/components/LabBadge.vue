<script setup lang="ts">
import type { Confidence } from "../kinds.ts";

defineProps<{ status: Confidence; label?: string }>();

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
  <span
    class="inline-flex h-[18px] items-center gap-[5px] rounded-full border pr-[7px] pl-1.5 text-label leading-none font-semibold tracking-[.02em] whitespace-nowrap"
    :class="STYLES[status].badge"
  >
    <span class="box-border shrink-0" :class="STYLES[status].mark" aria-hidden="true"></span>
    {{ label ?? status }}
  </span>
</template>
