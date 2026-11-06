<script setup lang="ts">
/** A small outlined word or count in a row, like "2 changes" or "shared ×3", in the colour of its tone. */
withDefaults(defineProps<{ tone?: "accent" | "soft" | "error" | "faint" }>(), { tone: "soft" });

const TONES = { accent: "text-accent", soft: "text-soft", error: "text-error", faint: "text-faint" } as const;
</script>

<template>
  <span
    class="shrink-0 rounded-full border border-current px-1.5 font-sans text-2xs leading-4 font-semibold whitespace-nowrap"
    :class="TONES[tone]"
    ><slot
  /></span>
</template>
