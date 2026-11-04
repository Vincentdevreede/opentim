<script setup lang="ts">
import { nextTick, ref, useTemplateRef } from "vue";

/**
 * A tip that shows next to its trigger as soon as the pointer is on it or it has keyboard focus. It is drawn on the
 * page itself, so a scrolling panel doesn't cut it off.
 */
defineProps<{ text: string }>();

const trigger = useTemplateRef<HTMLElement>("trigger");
const tip = useTemplateRef<HTMLElement>("tip");
const shown = ref(false);
const at = ref({ left: 0, top: 0 });

async function show() {
  shown.value = true;
  await nextTick();
  const t = trigger.value?.getBoundingClientRect();
  const box = tip.value?.getBoundingClientRect();
  if (!t || !box) return;
  const left = Math.max(8, Math.min(t.left + t.width / 2 - box.width / 2, innerWidth - box.width - 8));
  const below = t.bottom + 6;
  at.value = { left, top: below + box.height > innerHeight - 8 ? t.top - box.height - 6 : below };
}
</script>

<template>
  <span
    ref="trigger"
    class="inline-flex"
    tabindex="0"
    :aria-label="text"
    @mouseenter="show"
    @mouseleave="shown = false"
    @focus="show"
    @blur="shown = false"
    ><slot
  /></span>
  <Teleport to="body">
    <span
      v-if="shown"
      ref="tip"
      role="tooltip"
      class="pointer-events-none fixed z-50 max-w-[260px] rounded-md border border-line-strong bg-raised px-2.5 py-1.5 text-meta leading-snug whitespace-pre-line text-ink shadow-lg"
      :style="{ left: `${at.left}px`, top: `${at.top}px` }"
      >{{ text }}</span
    >
  </Teleport>
</template>
