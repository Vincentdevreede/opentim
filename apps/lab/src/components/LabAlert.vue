<script setup lang="ts">
import { computed } from "vue";
import LabIcon from "./LabIcon.vue";

/**
 * A message in a framed box with a warning icon: an error, a warning, or a plain note. The title is optional; the slot
 * holds the text and any buttons below it, and the `action` slot puts a button on the right. `large` is for the one
 * message a page is about.
 */
const props = withDefaults(defineProps<{ tone?: "error" | "warning" | "note"; title?: string; large?: boolean }>(), {
  tone: "error",
  title: undefined,
  large: false,
});

const TONES = {
  error: { box: "border-error/40 bg-error/7", icon: "text-error", title: "text-error" },
  warning: { box: "border-partial/35 bg-partial/8", icon: "text-partial", title: "text-ink" },
  note: { box: "border-line-strong bg-sunken", icon: "text-muted", title: "text-ink" },
} as const;
const tone = computed(() => TONES[props.tone]);
</script>

<template>
  <div
    :role="tone === TONES.error ? 'alert' : 'note'"
    class="flex items-start border"
    :class="[tone.box, large ? 'gap-3 rounded-[10px] p-5' : 'gap-2 rounded-md p-2.5']"
  >
    <LabIcon name="warning" :size="large ? 22 : 14" class="mt-px" :class="tone.icon" />
    <div class="flex min-w-0 flex-1 flex-col" :class="large ? 'gap-2' : 'gap-1'">
      <component
        :is="large ? 'h2' : 'span'"
        v-if="title"
        class="font-semibold"
        :class="[tone.title, large && 'text-heading']"
        >{{ title }}</component
      >
      <slot />
    </div>
    <slot name="action" />
  </div>
</template>
